import { describe, expect, it } from "vitest";

import {
  conjointDerivatives,
  conjointParameterCount,
  conjointWtpContrast,
  estimateConjoint,
  generateConjointDesign,
  type ConjointAlternative,
  type ConjointAttribute,
  type ConjointObservation,
  type ConjointStudy,
  type ConjointTask,
} from "./conjoint";
import { mulberry32 } from "./montecarlo";

const attributes: ConjointAttribute[] = [
  { id: "speed", name: "Speed", levels: ["low", "medium", "high"] },
  { id: "support", name: "Support", levels: ["self", "priority", "dedicated"] },
  { id: "security", name: "Security", levels: ["basic", "sso", "audit"] },
];
const trueBeta = [0.4, 0.1, 0.3, -0.2, -0.1, 0.25, -0.03, -0.5];

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

function sampleChoice(task: ConjointTask, beta: readonly number[], random: () => number) {
  const utilities = task.alternatives.map((alternative) =>
    encoded(alternative).reduce((sum, value, index) => sum + value * beta[index], 0),
  );
  const max = Math.max(...utilities);
  const weights = utilities.map((utility) => Math.exp(utility - max));
  const target = random() * weights.reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index];
    if (target <= cumulative) return task.alternatives[index].id;
  }
  return task.alternatives.at(-1)?.id ?? "none";
}

function recoveryStudy(respondents = 500) {
  const design = generateConjointDesign({
    attributes,
    taskCount: 18,
    alternativesPerTask: 3,
    priceLevels: [10, 30, 50],
    includeNone: true,
    seed: 1708,
  });
  const random = mulberry32(987654321);
  const observations: ConjointObservation[] = [];
  for (let respondent = 0; respondent < respondents; respondent += 1) {
    for (const task of design.tasks) {
      observations.push({
        respondentId: `r${respondent}`,
        taskId: task.id,
        chosenAlternativeId: sampleChoice(task, trueBeta, random),
      });
    }
  }
  return {
    attributes,
    tasks: design.tasks,
    observations,
    numericPrice: true,
  } satisfies ConjointStudy;
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
