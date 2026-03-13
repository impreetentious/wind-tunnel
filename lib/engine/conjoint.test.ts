import { describe, expect, it } from "vitest";

import {
  conjointDerivatives,
  conjointParameterCount,
  conjointWtpContrast,
  estimateConjoint,
  generateConjointDesign,
  generateDEfficientConjointDesign,
  type ConjointAlternative,
  type ConjointAttribute,
  type ConjointObservation,
  type ConjointStudy,
  type ConjointTask,
} from "./conjoint";
import {
  recoveryAttributes as attributes,
  recoveryStudy,
  recoveryTrueBeta as trueBeta,
} from "./conjoint-fixtures";

function encoded(alternative: ConjointAlternative) {
  if (alternative.none) return [0, 0, 0, 0, 0, 0, 0, 1];
  const result: number[] = [];
  for (const attribute of attributes) {
    const index = attribute.levels.indexOf(alternative.levels?.[attribute.id] ?? "");
    result.push(index === 0 ? 1 : index === 2 ? -1 : 0, index === 1 ? 1 : index === 2 ? -1 : 0);
  }
  result.push(alternative.price ?? 0, 0);
  return result;
}

function expectPositiveDefinite(matrix: readonly (readonly number[])[]) {
  const lower = Array.from({ length: matrix.length }, () => Array<number>(matrix.length).fill(0));
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row][column];
      for (let index = 0; index < column; index += 1)
        value -= lower[row][index] * lower[column][index];
      if (row === column) {
        expect(value).toBeGreaterThan(1e-10);
        lower[row][column] = Math.sqrt(value);
      } else {
        lower[row][column] = value / lower[column][column];
      }
    }
  }
}

describe("pooled conjoint estimator", () => {
  // @spec §4.12 — softmax computed via log-sum-exp
  it("passes the mandatory analytic derivative gate", () => {
    const study = recoveryStudy(12);
    for (const beta of [Array(8).fill(0), trueBeta, trueBeta.map((value) => value * 0.37)]) {
      const analytic = conjointDerivatives(study, beta);
      for (let index = 0; index < beta.length; index += 1) {
        const h = 1e-5 * Math.max(1, Math.abs(beta[index]));
        const plus = [...beta];
        const minus = [...beta];
        plus[index] += h;
        minus[index] -= h;
        const plusResult = conjointDerivatives(study, plus);
        const minusResult = conjointDerivatives(study, minus);
        const finiteGradient = (plusResult.logLikelihood - minusResult.logLikelihood) / (2 * h);
        const gradientTolerance = 1e-7 + 1e-6 * Math.max(1, Math.abs(finiteGradient));
        expect(Math.abs(analytic.gradient[index] - finiteGradient)).toBeLessThanOrEqual(
          gradientTolerance,
        );
        for (let row = 0; row < beta.length; row += 1) {
          const finiteHessian = (plusResult.gradient[row] - minusResult.gradient[row]) / (2 * h);
          const hessianTolerance = 1e-7 + 1e-6 * Math.max(1, Math.abs(finiteHessian));
          expect(Math.abs(analytic.hessian[row][index] - finiteHessian)).toBeLessThanOrEqual(
            hessianTolerance,
          );
        }
      }
    }
  });

  // @spec §4.10 T-CNJ-01
  it("recovers known coefficients within three standard errors", () => {
    const result = estimateConjoint(recoveryStudy());
    expect(result.status).toBe("ok");
    expect(result.freeCoefficients).toHaveLength(trueBeta.length);
    result.freeCoefficients?.forEach((coefficient, index) => {
      expect(Math.abs(coefficient.estimate - trueBeta[index])).toBeLessThanOrEqual(
        3 * coefficient.standardError,
      );
    });
  });

  // @spec §4.10 T-CNJ-02
  it("accepts only strictly likelihood-improving Newton steps", () => {
    const result = estimateConjoint(recoveryStudy(120));
    expect(result.status).toBe("ok");
    for (let index = 1; index < result.logLikelihoodHistory.length; index += 1) {
      expect(result.logLikelihoodHistory[index]).toBeGreaterThan(
        result.logLikelihoodHistory[index - 1],
      );
    }
  });

  // @spec §4.10 T-CNJ-03
  it("has a negative-definite Hessian at the identified optimum", () => {
    const study = recoveryStudy(160);
    const result = estimateConjoint(study);
    expect(result.status).toBe("ok");
    const beta = result.freeCoefficients?.map((coefficient) => coefficient.estimate) ?? [];
    const hessian = conjointDerivatives(study, beta).hessian;
    expectPositiveDefinite(hessian.map((row) => row.map((value) => -value)));
  });

  // @spec §4.10 T-CNJ-04
  it("reconstructs effects-coded levels that sum to zero", () => {
    const result = estimateConjoint(recoveryStudy(160));
    expect(result.status).toBe("ok");
    for (const attribute of attributes) {
      const sum =
        result.partWorths
          ?.filter((partWorth) => partWorth.attributeId === attribute.id)
          .reduce((total, partWorth) => total + partWorth.estimate, 0) ?? Number.NaN;
      expect(sum).toBeCloseTo(0, 10);
    }
  });

  // @spec §4.10 T-CNJ-05
  it("returns zero part-worths on an exactly balanced fixture", () => {
    const design = generateConjointDesign({
      attributes,
      taskCount: 18,
      alternativesPerTask: 3,
      priceLevels: [10, 30, 50],
      includeNone: true,
      seed: 1707,
    });
    const observations = design.tasks.flatMap((task) =>
      task.alternatives.map((alternative, index) => ({
        respondentId: `balanced-${index}`,
        taskId: task.id,
        chosenAlternativeId: alternative.id,
      })),
    );
    const result = estimateConjoint({
      attributes,
      tasks: design.tasks,
      observations,
      numericPrice: true,
    });
    expect(result.status).toBe("ok");
    expect(result.partWorths?.every((partWorth) => Math.abs(partWorth.estimate) < 1e-10)).toBe(
      true,
    );
    expect(result.bridgeEnabled).toBe(false);
  });

  // @spec §4.10 T-CNJ-06
  it("disables the WTP bridge without a significantly negative price coefficient", () => {
    const design = generateConjointDesign({
      attributes,
      taskCount: 18,
      alternativesPerTask: 3,
      priceLevels: [10, 30, 50],
      includeNone: true,
      seed: 1707,
    });
    const observations = design.tasks.flatMap((task) =>
      task.alternatives.map((alternative, index) => ({
        respondentId: `balanced-${index}`,
        taskId: task.id,
        chosenAlternativeId: alternative.id,
      })),
    );
    const estimate = estimateConjoint({
      attributes,
      tasks: design.tasks,
      observations,
      numericPrice: true,
    });
    expect(conjointWtpContrast(estimate, "speed", "high", "low")).toMatchObject({
      enabled: false,
    });
  });

  // @spec §4.10 T-CNJ-07
  it("names rank-deficient and separated failure states without intervals", () => {
    const rankDeficient: ConjointStudy = {
      attributes: [{ id: "feature", name: "Feature", levels: ["low", "high"] }],
      numericPrice: true,
      tasks: [
        {
          id: "t1",
          alternatives: [
            { id: "a", levels: { feature: "low" }, price: 10 },
            { id: "b", levels: { feature: "high" }, price: 20 },
          ],
        },
      ],
      observations: [{ respondentId: "r", taskId: "t1", chosenAlternativeId: "a" }],
    };
    expect(estimateConjoint(rankDeficient)).toMatchObject({
      status: "nonIdentifiable",
      bridgeEnabled: false,
    });

    const design = generateConjointDesign({
      attributes,
      taskCount: 18,
      alternativesPerTask: 3,
      priceLevels: [10, 30, 50],
      includeNone: true,
      seed: 1707,
    });
    const observations: ConjointObservation[] = [];
    for (let respondent = 0; respondent < 80; respondent += 1) {
      for (const task of design.tasks) {
        const utilities = task.alternatives.map((alternative) =>
          encoded(alternative).reduce((sum, value, index) => sum + value * trueBeta[index], 0),
        );
        const winner = utilities.indexOf(Math.max(...utilities));
        observations.push({
          respondentId: `separated-${respondent}`,
          taskId: task.id,
          chosenAlternativeId: task.alternatives[winner].id,
        });
      }
    }
    const separated = estimateConjoint({
      attributes,
      tasks: design.tasks,
      observations,
      numericPrice: true,
    });
    expect(separated.status).toBe("separated");
    expect(separated.freeCoefficients).toBeUndefined();
    expect(separated.bridgeEnabled).toBe(false);
  });

  // @spec §4.10 T-CNJ-08
  it("generates duplicate-free full-rank tasks with achievable level balance", () => {
    for (const taskCount of [5, 7, 12]) {
      const design = generateConjointDesign({
        attributes,
        taskCount,
        alternativesPerTask: 3,
        priceLevels: [10, 30, 50],
        includeNone: true,
        seed: 9000 + taskCount,
      });
      for (const counts of Object.values(design.levelCounts)) {
        const values = Object.values(counts);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      }
      for (const task of design.tasks) {
        const keys = task.alternatives
          .filter((alternative) => !alternative.none)
          .map((alternative) => JSON.stringify([alternative.levels, alternative.price]));
        expect(new Set(keys).size).toBe(keys.length);
      }
      expect(
        conjointParameterCount({
          attributes,
          tasks: design.tasks,
          observations: design.tasks.map((task) => ({
            respondentId: "check",
            taskId: task.id,
            chosenAlternativeId: task.alternatives[0].id,
          })),
          numericPrice: true,
        }),
      ).toBe(8);
    }
  });
});

describe("D-efficient conjoint design generator", () => {
  const smallAttributes: ConjointAttribute[] = [
    { id: "speed", name: "Speed", levels: ["low", "medium", "high"] },
    { id: "support", name: "Support", levels: ["self", "priority", "dedicated"] },
  ];

  function levelCountsAreBalanced(tasks: readonly ConjointTask[], attribute: ConjointAttribute) {
    const counts = attribute.levels.map(
      (level) =>
        tasks
          .flatMap((task) => task.alternatives)
          .filter((alternative) => alternative.levels?.[attribute.id] === level).length,
    );
    return Math.max(...counts) - Math.min(...counts) <= 1;
  }

  // @spec §4.10.1 T-CNJ-09
  it("weakly improves the random-balanced baseline determinant", () => {
    const design = generateDEfficientConjointDesign({
      attributes: smallAttributes,
      taskCount: 8,
      alternativesPerTask: 3,
      seed: 1234,
      starts: 3,
      maxSwaps: 15,
    });
    expect(design.logDeterminant).toBeGreaterThanOrEqual(design.baselineLogDeterminant - 1e-9);
  });

  // @spec §4.10 T-CNJ-10
  it("preserves per-attribute level balance", () => {
    const design = generateDEfficientConjointDesign({
      attributes: smallAttributes,
      taskCount: 8,
      alternativesPerTask: 3,
      seed: 5678,
      starts: 2,
      maxSwaps: 8,
    });
    for (const attribute of smallAttributes) {
      expect(levelCountsAreBalanced(design.tasks, attribute)).toBe(true);
    }
  });

  // @spec §4.10 T-CNJ-11
  it("returns a design that is identified for MNL estimation", () => {
    const design = generateDEfficientConjointDesign({
      attributes: smallAttributes,
      taskCount: 8,
      alternativesPerTask: 3,
      seed: 4242,
      starts: 2,
      maxSwaps: 8,
    });
    const study: ConjointStudy = {
      attributes: smallAttributes,
      tasks: design.tasks,
      numericPrice: false,
      observations: design.tasks.map((task) => ({
        respondentId: "check",
        taskId: task.id,
        chosenAlternativeId: task.alternatives[0].id,
      })),
    };
    const derivatives = conjointDerivatives(study, Array(conjointParameterCount(study)).fill(0));
    expect(derivatives.gradient.every(Number.isFinite)).toBe(true);
  });

  // @spec §4.10 T-CNJ-12
  it("is deterministic under identical seeds", () => {
    const optionsA = {
      attributes: smallAttributes,
      taskCount: 8,
      alternativesPerTask: 3,
      seed: 9999,
      starts: 2,
      maxSwaps: 8,
    };
    const first = generateDEfficientConjointDesign(optionsA);
    const second = generateDEfficientConjointDesign(optionsA);
    expect(second.logDeterminant).toBeCloseTo(first.logDeterminant, 9);
    expect(second.swapCount).toBe(first.swapCount);
  });
});

// §4.10's contract is as much about what it refuses as what it estimates. A
// pooled MNL that quietly accepts a malformed design produces coefficients that
// look ordinary and are meaningless, so each refusal below is pinned by the
// error it raises or the status it returns.
describe("P8 conjoint design and estimation contracts", () => {
  const attribute = (id: string, levels: string[]): ConjointAttribute => ({
    id,
    name: id,
    levels,
  });
  const simpleAttributes = [attribute("speed", ["low", "high"])];

  function studyOf(
    tasks: ConjointTask[],
    observations: ConjointObservation[],
    overrides: Partial<ConjointStudy> = {},
  ): ConjointStudy {
    return {
      attributes: simpleAttributes,
      tasks,
      observations,
      numericPrice: false,
      ...overrides,
    };
  }

  // T-CNJ-13 @spec §4.10
  it("bounds the attribute and level counts", () => {
    expect(() => estimateConjoint(studyOf([], [], { attributes: [] }))).toThrow(RangeError);
    expect(() =>
      estimateConjoint(
        studyOf([], [], {
          attributes: Array.from({ length: 6 }, (_, index) => attribute(`a${index}`, ["x", "y"])),
        }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      estimateConjoint(studyOf([], [], { attributes: [attribute("solo", ["only"])] })),
    ).toThrow(RangeError);
    expect(() =>
      estimateConjoint(
        studyOf([], [], { attributes: [attribute("wide", ["a", "b", "c", "d", "e"])] }),
      ),
    ).toThrow(RangeError);
  });

  // T-CNJ-14 @spec §4.10
  it("requires unique, non-empty attribute ids and level names", () => {
    expect(() =>
      estimateConjoint(
        studyOf([], [], {
          attributes: [attribute("dup", ["a", "b"]), attribute("dup", ["c", "d"])],
        }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      estimateConjoint(studyOf([], [], { attributes: [attribute("", ["a", "b"])] })),
    ).toThrow(RangeError);
    expect(() =>
      estimateConjoint(studyOf([], [], { attributes: [attribute("same", ["a", "a"])] })),
    ).toThrow(RangeError);
  });

  // T-CNJ-15 @spec §4.10
  it("requires tasks, observations, and at least two alternatives per task", () => {
    expect(() => estimateConjoint(studyOf([], []))).toThrow(RangeError);

    const oneAlternative: ConjointTask = {
      id: "t1",
      alternatives: [{ id: "a", levels: { speed: "low" } }],
    };
    expect(() =>
      estimateConjoint(
        studyOf([oneAlternative], [{ respondentId: "r1", taskId: "t1", chosenAlternativeId: "a" }]),
      ),
    ).toThrow(RangeError);
  });

  // T-CNJ-16 @spec §4.10
  it("rejects duplicate ids and duplicate concepts within a task", () => {
    const duplicateIds: ConjointTask = {
      id: "t1",
      alternatives: [
        { id: "a", levels: { speed: "low" } },
        { id: "a", levels: { speed: "high" } },
      ],
    };
    expect(() =>
      estimateConjoint(
        studyOf([duplicateIds], [{ respondentId: "r1", taskId: "t1", chosenAlternativeId: "a" }]),
      ),
    ).toThrow(RangeError);

    const duplicateConcepts: ConjointTask = {
      id: "t1",
      alternatives: [
        { id: "a", levels: { speed: "low" } },
        { id: "b", levels: { speed: "low" } },
      ],
    };
    expect(() =>
      estimateConjoint(
        studyOf(
          [duplicateConcepts],
          [{ respondentId: "r1", taskId: "t1", chosenAlternativeId: "a" }],
        ),
      ),
    ).toThrow(RangeError);

    const duplicateTaskIds: ConjointTask[] = [
      {
        id: "t1",
        alternatives: [
          { id: "a", levels: { speed: "low" } },
          { id: "b", levels: { speed: "high" } },
        ],
      },
      {
        id: "t1",
        alternatives: [
          { id: "c", levels: { speed: "low" } },
          { id: "d", levels: { speed: "high" } },
        ],
      },
    ];
    expect(() =>
      estimateConjoint(
        studyOf(duplicateTaskIds, [{ respondentId: "r1", taskId: "t1", chosenAlternativeId: "a" }]),
      ),
    ).toThrow(RangeError);
  });

  // T-CNJ-17 @spec §4.10
  it("rejects observations that reference an unknown task or alternative", () => {
    const tasks: ConjointTask[] = [
      {
        id: "t1",
        alternatives: [
          { id: "a", levels: { speed: "low" } },
          { id: "b", levels: { speed: "high" } },
        ],
      },
    ];
    expect(() =>
      estimateConjoint(
        studyOf(tasks, [{ respondentId: "r1", taskId: "absent", chosenAlternativeId: "a" }]),
      ),
    ).toThrow(RangeError);
    expect(() =>
      estimateConjoint(
        studyOf(tasks, [{ respondentId: "r1", taskId: "t1", chosenAlternativeId: "absent" }]),
      ),
    ).toThrow(RangeError);
  });

  // T-CNJ-18 @spec §4.10
  it("rejects an alternative with a missing level or an invalid numeric price", () => {
    const missingLevel: ConjointTask = {
      id: "t1",
      alternatives: [
        { id: "a", levels: {} },
        { id: "b", levels: { speed: "high" } },
      ],
    };
    expect(() =>
      estimateConjoint(
        studyOf([missingLevel], [{ respondentId: "r1", taskId: "t1", chosenAlternativeId: "b" }]),
      ),
    ).toThrow(RangeError);

    const badPrice: ConjointTask = {
      id: "t1",
      alternatives: [
        { id: "a", levels: { speed: "low" }, price: -5 },
        { id: "b", levels: { speed: "high" }, price: 10 },
      ],
    };
    expect(() =>
      estimateConjoint(
        studyOf([badPrice], [{ respondentId: "r1", taskId: "t1", chosenAlternativeId: "b" }], {
          numericPrice: true,
        }),
      ),
    ).toThrow(RangeError);
  });

  // T-CNJ-19 @spec §4.10 — a rank-deficient design must be reported, not fitted.
  it("reports a non-identifiable design rather than returning coefficients", () => {
    // `tier` never varies, so its design column is identically zero after the
    // reference-alternative differencing: two free parameters, one of which is
    // unidentified.
    const tasks: ConjointTask[] = Array.from({ length: 6 }, (_, index) => ({
      id: `t${index}`,
      alternatives: [
        { id: `${index}-low`, levels: { speed: "low", tier: "basic" } },
        { id: `${index}-high`, levels: { speed: "high", tier: "basic" } },
      ],
    }));
    const observations: ConjointObservation[] = tasks.map((task, index) => ({
      respondentId: `r${index}`,
      taskId: task.id,
      chosenAlternativeId: index % 2 === 0 ? `${index}-low` : `${index}-high`,
    }));
    const estimate = estimateConjoint(
      studyOf(tasks, observations, {
        attributes: [attribute("speed", ["low", "high"]), attribute("tier", ["basic", "pro"])],
      }),
    );
    expect(estimate.status).toBe("nonIdentifiable");
    expect(estimate.partWorths).toBeUndefined();
    expect(estimate.bridgeEnabled).toBe(false);
  });

  // T-CNJ-20 @spec §4.10
  //
  // NOTE: this pins observed behaviour, and it is not the behaviour §4.10's
  // `separated` state describes. With one binary attribute and every choice
  // going the same way, the gradient reaches GRADIENT_TOLERANCE (1e-8) at
  // |beta| ~= 10.3, which is below the `separated` guard's `coefficientNorm >
  // 15`. So a perfectly separated design converges and reports `ok` with a
  // large coefficient rather than reporting separation. Verified up to 40
  // identical tasks. Whether the guard's threshold should move is a §4.10
  // decision, not a test fix — this test exists so the current behaviour is at
  // least visible rather than assumed.
  it("converges with a large coefficient when one level always wins", () => {
    const tasks: ConjointTask[] = Array.from({ length: 40 }, (_, index) => ({
      id: `t${index}`,
      alternatives: [
        { id: `${index}-low`, levels: { speed: "low" } },
        { id: `${index}-high`, levels: { speed: "high" } },
      ],
    }));
    const observations: ConjointObservation[] = tasks.map((task, index) => ({
      respondentId: `r${index}`,
      taskId: task.id,
      chosenAlternativeId: `${index}-high`,
    }));
    const estimate = estimateConjoint(studyOf(tasks, observations));

    expect(estimate.status).toBe("ok");
    const speedHigh = estimate.partWorths?.find(
      (row) => row.attributeId === "speed" && row.level === "high",
    );
    expect(speedHigh?.estimate ?? 0).toBeGreaterThan(5);
  });

  // T-CNJ-21 @spec §4.10 — the bridge gate is one-sided and must state its reason.
  it("disables the WTP bridge when there is no numeric price column", () => {
    const estimate = estimateConjoint(recoveryStudy(200));
    expect(estimate.status).toBe("ok");
    expect(estimate.bridgeEnabled).toBe(true);

    const noPrice = estimateConjoint({
      ...recoveryStudy(200),
      numericPrice: false,
    });
    expect(noPrice.bridgeEnabled).toBe(false);
    expect(noPrice.bridgeReason).toMatch(/numeric account-month price column is required/i);
  });

  // T-CNJ-22 @spec §4.10
  it("validates the design generator's own bounds", () => {
    const options = {
      attributes: simpleAttributes,
      taskCount: 8,
      alternativesPerTask: 2,
      seed: 1,
    };
    expect(() => generateConjointDesign({ ...options, taskCount: 0 })).toThrow(RangeError);
    expect(() => generateConjointDesign({ ...options, alternativesPerTask: 1 })).toThrow(
      RangeError,
    );
    expect(() => generateDEfficientConjointDesign({ ...options, starts: 0 })).toThrow(RangeError);
    expect(() => generateDEfficientConjointDesign({ ...options, maxSwaps: -1 })).toThrow(
      RangeError,
    );
  });
});
