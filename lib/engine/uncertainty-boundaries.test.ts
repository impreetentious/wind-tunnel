import { describe, expect, it } from "vitest";
import { empiricalPercentile, runMonteCarlo } from "./montecarlo";
import { projectTimeDynamics } from "./time-dynamics";
import type { MonteCarloInput } from "./types";

const input: MonteCarloInput = {
  seed: 0,
  drawCount: 200,
  referenceDesignId: "r",
  designs: [
    { id: "r", label: "Reference" },
    { id: "c", label: "Challenger" },
  ],
  parameters: [{ id: "x", label: "", band: { p10: 1, p50: 2, p90: 4 } }],
  randomFactory: () => () => 0.5,
  evaluate: (id, values) => values.x + (id === "c" ? 1 : 0),
};

describe("uncertainty input boundaries (@spec §4.8)", () => {
  it.each([-1, 0.5, 4_294_967_296, NaN])("rejects seed %s", (seed) => {
    expect(() => runMonteCarlo({ ...input, seed })).toThrow(/seed/);
  });
  it.each([199, 5001, 200.5, NaN])("rejects draw count %s", (drawCount) => {
    expect(() => runMonteCarlo({ ...input, drawCount })).toThrow(/draw count/);
  });
  it("requires parameters, designs, unique nonempty IDs and an included reference", () => {
    expect(() => runMonteCarlo({ ...input, parameters: [] })).toThrow(/parameter/);
    expect(() => runMonteCarlo({ ...input, designs: [] })).toThrow(/design/);
    expect(() => runMonteCarlo({ ...input, referenceDesignId: "absent" })).toThrow(/reference/);
    for (const id of ["", "x"])
      expect(() =>
        runMonteCarlo({
          ...input,
          parameters: [input.parameters[0], { ...input.parameters[0], id }],
        }),
      ).toThrow(/IDs/);
    for (const id of ["", "r"])
      expect(() =>
        runMonteCarlo({ ...input, designs: [input.designs[0], { ...input.designs[0], id }] }),
      ).toThrow(/IDs/);
  });
  it.each([
    { p10: 0, p50: 2, p90: 4 },
    { p10: 1, p50: NaN, p90: 4 },
    { p10: 3, p50: 2, p90: 4 },
    { p10: 1, p50: 5, p90: 4 },
    { p10: 1, p50: 3, p90: 4 },
  ])("rejects invalid uncertainty band %j", (band) => {
    expect(() =>
      runMonteCarlo({ ...input, parameters: [{ ...input.parameters[0], band }] }),
    ).toThrow(RangeError);
  });
  it.each([-1, 1, NaN, Infinity])("rejects injected probability %s", (p) => {
    expect(() => runMonteCarlo({ ...input, randomFactory: () => () => p })).toThrow(/PRNG/);
  });
  it.each([-1, Infinity, NaN])("rejects evaluated MRR %s", (value) => {
    expect(() => runMonteCarlo({ ...input, evaluate: () => value })).toThrow(/invalid MRR/);
  });
  it("median draws give known revenues and all three paired comparison outcomes", () => {
    for (const delta of [-1, 0, 1]) {
      const result = runMonteCarlo({
        ...input,
        evaluate: (id, values) => values.x + (id === "c" ? delta : 0),
      });
      expect(result.distributions[0].percentiles).toEqual({ p10: 2, p50: 2, p90: 2, mean: 2 });
      expect(result.comparisons[0]).toMatchObject({
        referenceWins: delta < 0 ? 200 : 0,
        ties: delta === 0 ? 200 : 0,
        challengerWins: delta > 0 ? 200 : 0,
        challengerWinRate: delta > 0 ? 1 : 0,
      });
      expect(result.tornado[0]).toMatchObject({
        baseMrr: 2,
        lowMrr: 1,
        highMrr: 4,
        lowDelta: -1,
        highDelta: 2,
      });
    }
  });
  it("orders equal tornado drivers by ID without inventing a different magnitude", () => {
    const parameter = input.parameters[0];
    const result = runMonteCarlo({
      ...input,
      parameters: [
        { ...parameter, id: "z" },
        { ...parameter, id: "a" },
        { ...parameter, id: "m" },
      ],
      evaluate: (_id, values) => values.z + values.a + values.m,
    });
    expect(result.tornado.map((driver) => driver.parameterId)).toEqual(["a", "m", "z"]);
    expect(result.tornado.every((driver) => driver.maximumAbsoluteDelta === 2)).toBe(true);
  });
  it("accepts zero from an injected PRNG while retaining positive lognormal draws", () => {
    const result = runMonteCarlo({ ...input, randomFactory: () => () => 0 });
    expect(
      result.draws.every(
        (draw) => draw.parameterValues.x > 0 && Number.isFinite(draw.parameterValues.x),
      ),
    ).toBe(true);
  });
  it("interpolates percentiles by rank rather than rounding or input order", () => {
    expect(empiricalPercentile([30, 0, 10, 20], 0.25)).toBe(7.5);
    expect(empiricalPercentile([30, 0, 10, 20], 0.75)).toBe(22.5);
    expect(empiricalPercentile([7], 0.5)).toBe(7);
    expect(() => empiricalPercentile([], 0.5)).toThrow(RangeError);
    for (const p of [-1, 2, NaN]) expect(() => empiricalPercentile([1], p)).toThrow(RangeError);
  });
});

const segment = {
  id: "s",
  trialLength: 0,
  trialConversion: 1,
  monthlyRetention: 1,
  contractTerm: "monthly" as const,
  monthlyMrr: 20,
  arpa: 10,
  paidSelectors: 2,
};

describe("zero buyers and retention boundaries (@spec §4.16)", () => {
  it.each([{ trialConversion: 0 }, { paidSelectors: 0 }, { monthlyRetention: 0 }])(
    "projects zero boundary %j",
    (patch) => {
      const result = projectTimeDynamics({ periods: 2, segments: [{ ...segment, ...patch }] });
      const acquired = patch.trialConversion === 0 || patch.paidSelectors === 0 ? 0 : 2;
      expect(result.points).toEqual([
        { period: 0, mrr: acquired ? 20 : 0, activeBuyers: acquired },
        { period: 1, mrr: 0, activeBuyers: 0 },
        { period: 2, mrr: 0, activeBuyers: 0 },
      ]);
      expect(result.cumulativeRevenue).toBe(acquired ? 20 : 0);
      expect(result.segments[0].ltvPerAcquired).toBe(acquired ? 10 : 0);
    },
  );
  it("annual retention waits for the anniversary after the trial", () => {
    const result = projectTimeDynamics({
      periods: 14,
      segments: [{ ...segment, contractTerm: "annual", trialLength: 2, monthlyRetention: 0.5 }],
    });
    expect(result.points[1]).toEqual({ period: 1, mrr: 0, activeBuyers: 2 });
    expect(result.points[2]).toEqual({ period: 2, mrr: 20, activeBuyers: 2 });
    expect(result.points[13]).toEqual({ period: 13, mrr: 20, activeBuyers: 2 });
    expect(result.points[14]).toEqual({ period: 14, mrr: 10, activeBuyers: 1 });
    expect(result.cumulativeRevenue).toBe(250);
  });
  it.each([-1, 0.5, Infinity])("rejects fractional or negative month count %s", (value) => {
    expect(() => projectTimeDynamics({ periods: value, segments: [segment] })).toThrow(RangeError);
    expect(() =>
      projectTimeDynamics({ periods: 1, segments: [{ ...segment, trialLength: value }] }),
    ).toThrow(RangeError);
  });
  it("rejects rates outside [0,1] and invalid financial quantities", () => {
    for (const key of ["trialConversion", "monthlyRetention"] as const)
      for (const value of [-1, 2, NaN])
        expect(() =>
          projectTimeDynamics({ periods: 1, segments: [{ ...segment, [key]: value }] }),
        ).toThrow(RangeError);
    for (const key of ["monthlyMrr", "arpa", "paidSelectors"] as const)
      for (const value of [-1, Infinity])
        expect(() =>
          projectTimeDynamics({ periods: 1, segments: [{ ...segment, [key]: value }] }),
        ).toThrow(RangeError);
  });
});
