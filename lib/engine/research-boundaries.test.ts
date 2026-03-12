import { describe, expect, it } from "vitest";
import {
  conjointDerivatives,
  conjointDesignVector,
  conjointLayoutFor,
  conjointWtpContrast,
  estimateConjoint,
  generateConjointDesign,
  generateDEfficientConjointDesign,
  type ConjointStudy,
} from "./conjoint";
import { estimateHbConjoint } from "./hb-conjoint";
import { estimateMaxDiffMnl, generateMaxDiffDesign, scoreMaxDiff } from "./maxdiff";
import { analyzeVanWestendorp } from "./vanwest";

// A binary effects-coded task has x=+1/-1. One choice of each gives
// L(0)=-2 ln(2), average gradient=0 and average Hessian=-1, so beta=0,
// Var(beta)=1/2. These values are derived directly from the Bernoulli likelihood.
const balanced: ConjointStudy = {
  attributes: [{ id: "a", name: "A", levels: ["low", "high"] }],
  numericPrice: false,
  tasks: [
    {
      id: "t",
      alternatives: [
        { id: "l", levels: { a: "low" } },
        { id: "h", levels: { a: "high" } },
      ],
    },
  ],
  observations: [
    { respondentId: "one", taskId: "t", chosenAlternativeId: "l" },
    { respondentId: "two", taskId: "t", chosenAlternativeId: "h" },
  ],
};

describe("hand-derived binary conjoint likelihood (@spec §4.10)", () => {
  it("has the analytic optimum, curvature and effects-coded covariance", () => {
    expect(conjointDerivatives(balanced, [0])).toEqual({
      logLikelihood: -Math.log(2),
      gradient: [0],
      hessian: [[-1]],
    });
    const estimate = estimateConjoint(balanced);
    expect(estimate).toMatchObject({
      status: "ok",
      iterations: 0,
      hitRate: 0.5,
      bridgeEnabled: false,
      covariance: [[0.5]],
    });
    expect(estimate.partWorths?.map((entry) => entry.estimate)).toEqual([0, 0]);
    expect(estimate.partWorths?.map((entry) => entry.standardError)).toEqual([
      Math.SQRT1_2,
      Math.SQRT1_2,
    ]);
    expect(estimate.priceCoefficient).toBeUndefined();
    expect(estimate.noneCoefficient).toBeUndefined();
  });
  it.each([{ beta: [] }, { beta: [0, 0] }, { beta: [NaN] }, { beta: [Infinity] }])(
    "rejects coefficient vector %j",
    ({ beta }) => {
      expect(() => conjointDerivatives(balanced, beta)).toThrow(/finite coefficients/);
    },
  );
  it("rejects empty data, too few alternatives, duplicates and unknown observations", () => {
    const task = balanced.tasks[0];
    for (const patch of [
      { tasks: [] },
      { observations: [] },
      { tasks: [task, task] },
      { tasks: [{ ...task, id: "" }] },
      { tasks: [{ ...task, alternatives: [task.alternatives[0]] }] },
      { tasks: [{ ...task, alternatives: [task.alternatives[0], task.alternatives[0]] }] },
      {
        tasks: [
          {
            ...task,
            alternatives: [task.alternatives[0], { ...task.alternatives[0], id: "other" }],
          },
        ],
      },
    ])
      expect(() => estimateConjoint({ ...balanced, ...patch })).toThrow(RangeError);
    for (const patch of [{ taskId: "unknown" }, { chosenAlternativeId: "unknown" }])
      expect(() =>
        estimateConjoint({
          ...balanced,
          observations: [{ ...balanced.observations[0], ...patch }],
        }),
      ).toThrow(/unknown/);
  });
  it("rejects invalid attributes, levels and numeric prices", () => {
    const attribute = balanced.attributes[0];
    for (const attributes of [
      [],
      Array.from({ length: 6 }, (_, index) => ({ ...attribute, id: String(index) })),
      [attribute, attribute],
      [{ ...attribute, id: "" }],
      [{ ...attribute, levels: ["one"] }],
      [{ ...attribute, levels: ["a", "b", "c", "d", "e"] }],
      [{ ...attribute, levels: ["same", "same"] }],
      [{ ...attribute, levels: ["", "b"] }],
    ])
      expect(() => conjointLayoutFor({ ...balanced, attributes })).toThrow(RangeError);
    const layout = conjointLayoutFor(balanced);
    expect(() => conjointDesignVector(balanced, layout, { id: "missing" })).toThrow(/valid/);
    expect(() =>
      conjointDesignVector(balanced, layout, { id: "unknown", levels: { a: "other" } }),
    ).toThrow(/valid/);
    expect(() => conjointDesignVector(balanced, layout, { id: "none", none: true })).toThrow(
      /None coefficient/,
    );
    expect(() =>
      conjointDesignVector(
        balanced,
        { ...layout, attributeOffsets: new Map() },
        balanced.tasks[0].alternatives[0],
      ),
    ).toThrow(/Unknown conjoint attribute/);
    const priced = { ...balanced, numericPrice: true };
    for (const price of [undefined, -1, NaN, Infinity])
      expect(() =>
        conjointDesignVector(priced, conjointLayoutFor(priced), {
          id: "l",
          levels: { a: "low" },
          price,
        }),
      ).toThrow(/price/);
  });
  it("pins the WTP contrast algebra and refuses an unknown level", () => {
    // Deliberately supplied estimate: delta utility 2, beta_price=-0.5,
    // so the contrast is -2/-0.5=4 account-month currency units.
    const estimate = {
      status: "ok" as const,
      iterations: 0,
      logLikelihoodHistory: [],
      respondentCount: 2,
      observationCount: 2,
      bridgeEnabled: true,
      bridgeReason: "negative price",
      priceCoefficient: {
        id: "price",
        estimate: -0.5,
        standardError: 0.1,
        ci90: [-0.6645, -0.3355] as const,
      },
      partWorths: [
        {
          attributeId: "a",
          level: "low",
          estimate: -1,
          standardError: 0.1,
          ci90: [-1.1645, -0.8355] as const,
        },
        {
          attributeId: "a",
          level: "high",
          estimate: 1,
          standardError: 0.1,
          ci90: [0.8355, 1.1645] as const,
        },
      ],
    };
    expect(conjointWtpContrast(estimate, "a", "high", "low").deltaWtp).toBe(4);
    expect(conjointWtpContrast(estimate, "a", "absent", "low").enabled).toBe(false);
    expect(conjointWtpContrast(estimate, "a", "high", "absent").enabled).toBe(false);
    expect(
      conjointWtpContrast({ ...estimate, status: "nonIdentifiable" }, "a", "high", "low").enabled,
    ).toBe(false);
    expect(
      conjointWtpContrast({ ...estimate, priceCoefficient: undefined }, "a", "high", "low").enabled,
    ).toBe(false);
  });
  it("validates design counts and impossible dimensions", () => {
    const options = {
      attributes: balanced.attributes,
      taskCount: 2,
      alternativesPerTask: 2,
      seed: 1,
    };
    for (const taskCount of [0, 0.5])
      expect(() => generateConjointDesign({ ...options, taskCount })).toThrow(/Task count/);
    for (const alternativesPerTask of [1, 6, 2.5])
      expect(() => generateConjointDesign({ ...options, alternativesPerTask })).toThrow(/concepts/);
    for (const priceLevels of [[], [-1], [NaN]])
      expect(() => generateConjointDesign({ ...options, priceLevels })).toThrow(/price levels/);
    expect(() => generateConjointDesign({ ...options, alternativesPerTask: 3 })).toThrow(
      /Could not generate/,
    );
    expect(() => generateDEfficientConjointDesign({ ...options, starts: 0 })).toThrow(/start/);
    expect(() => generateDEfficientConjointDesign({ ...options, maxSwaps: -1 })).toThrow(
      /maxSwaps/,
    );
    // With two binary alternatives per task, every task is already maximally
    // informative at beta=0. No balance-preserving swap can improve it.
    const result = generateDEfficientConjointDesign({ ...options, starts: 1, maxSwaps: 0 });
    expect(result.status).toBe("unimprovable");
    expect(result.logDeterminant).toBeCloseTo(Math.log(2), 12);
    expect(result.swapCount).toBe(0);
  });
  it("HB rejects impossible sample counts and missing task/choice references", () => {
    expect(() => estimateHbConjoint(balanced, { warmup: -1 })).toThrow(/warmup/);
    expect(() => estimateHbConjoint(balanced, { samples: 0 })).toThrow(/sample count/);
    for (const patch of [{ taskId: "missing" }, { chosenAlternativeId: "missing" }])
      expect(() =>
        estimateHbConjoint({
          ...balanced,
          observations: [{ ...balanced.observations[0], ...patch }, balanced.observations[1]],
        }),
      ).toThrow(/unknown/);
  });
});

const task = { id: "t", itemIds: ["a", "b"] };
const response = { respondentId: "r", taskId: "t", bestItemId: "a", worstItemId: "b" };

describe("MaxDiff domain and balanced likelihood (@spec §4.11)", () => {
  it("balanced best/worst pairs have zero utility, equal share and known variance", () => {
    const responses = [
      response,
      { ...response, respondentId: "s", bestItemId: "b", worstItemId: "a" },
    ];
    const result = estimateMaxDiffMnl(["a", "b"], [task], responses);
    // Each best/worst pair contributes two logistic observations. At zero,
    // four observations each have information 1: Var(beta_a)=1/4.
    expect(result.status).toBe("ok");
    expect(result.logLikelihoodHistory).toEqual([-4 * Math.log(2)]);
    expect(result.utilities?.map((entry) => entry.utility)).toEqual([0, -0]);
    expect(result.utilities?.map((entry) => entry.standardError)).toEqual([0.5, 0.5]);
    expect(result.normalizedShares).toEqual([
      { itemId: "a", share: 0.5 },
      { itemId: "b", share: 0.5 },
    ]);
    const scores = scoreMaxDiff(["a", "b"], [task], responses);
    expect(scores).toEqual({
      ok: true,
      scores: ["a", "b"].map((itemId) => ({
        itemId,
        appearances: 2,
        bestCount: 1,
        worstCount: 1,
        rawScore: 0,
        normalizedScore: 50,
      })),
    });
  });
  it.each([{ items: ["a"] }, { items: ["", "b"] }, { items: ["a", "a"] }])(
    "rejects invalid item list %j",
    ({ items }) => {
      expect(() => scoreMaxDiff(items, [], [])).toThrow(RangeError);
      expect(() => estimateMaxDiffMnl(items, [], [])).toThrow(RangeError);
    },
  );
  it("rejects malformed tasks", () => {
    for (const tasks of [
      [{ ...task, id: "" }],
      [task, task],
      [{ ...task, itemIds: ["a"] }],
      [{ ...task, itemIds: ["a", "missing"] }],
    ]) {
      expect(() => scoreMaxDiff(["a", "b"], tasks, [])).toThrow(RangeError);
      expect(() => estimateMaxDiffMnl(["a", "b"], tasks, [])).toThrow(RangeError);
    }
    expect(() => scoreMaxDiff(["a", "b"], [{ ...task, itemIds: ["a", "a"] }], [])).toThrow(
      RangeError,
    );
  });
  it("invalid responses and unobserved items never receive invented estimates", () => {
    for (const patch of [
      { taskId: "missing" },
      { worstItemId: "a" },
      { bestItemId: "missing" },
      { worstItemId: "missing" },
    ]) {
      expect(scoreMaxDiff(["a", "b"], [task], [{ ...response, ...patch }])).toMatchObject({
        ok: false,
        status: "invalidResponse",
      });
      expect(estimateMaxDiffMnl(["a", "b"], [task], [{ ...response, ...patch }])).toMatchObject({
        status: "nonIdentifiable",
      });
    }
    expect(scoreMaxDiff(["a", "b"], [task], [])).toMatchObject({
      ok: false,
      status: "unseenItems",
      unseenItemIds: ["a", "b"],
    });
    expect(estimateMaxDiffMnl(["a", "b"], [task], [])).toMatchObject({ status: "nonIdentifiable" });
    // c never appears, so its relative utility is not identified.
    expect(estimateMaxDiffMnl(["a", "b", "c"], [task], [response])).toMatchObject({
      status: "nonIdentifiable",
    });
  });
  it("validates balanced design dimensions and exposure", () => {
    for (const itemsPerTask of [2, 6])
      expect(() => generateMaxDiffDesign(["a", "b", "c"], 1, itemsPerTask, 1)).toThrow(RangeError);
    for (const count of [0, 0.5])
      expect(() => generateMaxDiffDesign(["a", "b", "c"], count, 3, 1)).toThrow(RangeError);
    expect(() => generateMaxDiffDesign(["a", "b", "c", "d"], 1, 3, 1)).toThrow(/expose/);
    for (const items of [
      ["a", "a", "c"],
      ["", "b", "c"],
    ])
      expect(() => generateMaxDiffDesign(items, 1, 3, 1)).toThrow(/unique/);
  });
});

describe("PSM invalid-response boundaries (@spec §4.7)", () => {
  it("excludes every broken adjacent ordering and all invalid prices", () => {
    const responses = [
      { tooCheap: 2, cheap: 1, expensive: 3, tooExpensive: 4 },
      { tooCheap: 0, cheap: 3, expensive: 2, tooExpensive: 4 },
      { tooCheap: 0, cheap: 1, expensive: 4, tooExpensive: 3 },
      { tooCheap: -1, cheap: 1, expensive: 2, tooExpensive: 3 },
      { tooCheap: 0, cheap: 1, expensive: 2, tooExpensive: Infinity },
    ];
    const result = analyzeVanWestendorp(responses);
    expect(result.validResponses).toEqual([]);
    expect(result.violations.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.curves).toEqual([]);
    expect(result.acceptableRange).toBeUndefined();
    expect(Object.values(result.points).every((point) => point.price === undefined)).toBe(true);
  });
});
