import { describe, expect, it } from "vitest";

import { fitLognormalBand } from "./stats";
import {
  compareDesigns,
  empiricalPercentile,
  MAX_MONTE_CARLO_DRAWS,
  MIN_MONTE_CARLO_DRAWS,
  mulberry32,
  runMonteCarlo,
} from "./montecarlo";
import type { MonteCarloInput } from "./types";

function fixture(overrides: Partial<MonteCarloInput> = {}): MonteCarloInput {
  return {
    seed: 240715,
    drawCount: 1_000,
    parameters: [
      {
        id: "prospects",
        label: "Prospects",
        band: { p10: 50, p50: 100, p90: 200 },
      },
      {
        id: "wtp",
        label: "WTP",
        band: { p10: 50, p50: 100, p90: 200 },
      },
    ],
    designs: [
      { id: "base", label: "Base" },
      { id: "challenger", label: "Challenger" },
    ],
    referenceDesignId: "base",
    evaluate: (designId, values) =>
      values.prospects * values.wtp * (designId === "challenger" ? 1.1 : 1),
    ...overrides,
  };
}

describe("seeded Monte Carlo uncertainty", () => {
  // T-MC-01 @spec §4.8
  // @spec §4.12 — engine randomness flows only through the injected seeded PRNG
  it("returns byte-identical draws and percentile summaries for a fixed seed", () => {
    const first = runMonteCarlo(fixture());
    const second = runMonteCarlo(fixture());

    expect(second).toEqual(first);
    expect(first.draws.slice(0, 5)).toEqual([
      {
        index: 0,
        parameterValues: { prospects: 52.019992930952846, wtp: 166.16401223817047 },
        mrrByDesign: { base: 8643.85074200839, challenger: 9508.23581620923 },
      },
      {
        index: 1,
        parameterValues: { prospects: 84.12208352112721, wtp: 85.62829302296609 },
        mrrByDesign: { base: 7203.2304174495075, challenger: 7923.553459194459 },
      },
      {
        index: 2,
        parameterValues: { prospects: 85.45318246020632, wtp: 67.69946932434328 },
        mrrByDesign: { base: 5785.135104632247, challenger: 6363.648615095472 },
      },
      {
        index: 3,
        parameterValues: { prospects: 78.34074327392908, wtp: 204.95263712188256 },
        mrrByDesign: { base: 16056.141928080147, challenger: 17661.756120888163 },
      },
      {
        index: 4,
        parameterValues: { prospects: 262.23043924230024, wtp: 141.5118157099754 },
        mrrByDesign: { base: 37108.70559160229, challenger: 40819.57615076252 },
      },
    ]);
    expect(first.distributions.map((distribution) => distribution.percentiles)).toEqual([
      {
        p10: 3826.7234313968006,
        p50: 9741.02086130207,
        p90: 26522.77211915779,
        mean: 13402.702959241986,
      },
      {
        p10: 4209.395774536481,
        p50: 10715.122947432277,
        p90: 29175.049331073573,
        mean: 14742.973255166215,
      },
    ]);
  });

  // T-MC-02 @spec §4.8
  it("collapses zero-width bands to the analytic MRR exactly", () => {
    const result = runMonteCarlo(
      fixture({
        drawCount: 200,
        parameters: [
          { id: "prospects", label: "Prospects", band: { p10: 100, p50: 100, p90: 100 } },
          { id: "wtp", label: "WTP", band: { p10: 50, p50: 50, p90: 50 } },
        ],
        designs: [{ id: "base", label: "Base" }],
        evaluate: (_designId, values) => values.prospects * values.wtp,
      }),
    );

    expect(result.distributions[0].percentiles).toEqual({
      p10: 5_000,
      p50: 5_000,
      p90: 5_000,
      mean: 5_000,
    });
  });

  // T-MC-03 @spec §4.8
  it("has a Monte Carlo mean within three standard errors of a lognormal analytic mean", () => {
    const band = { p10: 50, p50: 100, p90: 200 };
    const result = runMonteCarlo(
      fixture({
        seed: 7,
        parameters: [{ id: "scale", label: "Scale", band }],
        designs: [{ id: "base", label: "Base" }],
        evaluate: (_designId, values) => values.scale,
      }),
    );
    const distribution = fitLognormalBand(band.p10, band.p90);
    const analyticMean = Math.exp(distribution.mu + (distribution.sigma * distribution.sigma) / 2);
    const analyticVariance =
      (Math.exp(distribution.sigma * distribution.sigma) - 1) *
      Math.exp(2 * distribution.mu + distribution.sigma * distribution.sigma);
    const standardError = Math.sqrt(analyticVariance / result.drawCount);

    expect(Math.abs(result.distributions[0].percentiles.mean - analyticMean)).toBeLessThan(
      3 * standardError,
    );
  });

  // T-MC-04 @spec §4.8
  it("keeps a zero-width tornado driver at zero length", () => {
    const result = runMonteCarlo(
      fixture({
        parameters: [
          { id: "fixed", label: "Fixed", band: { p10: 100, p50: 100, p90: 100 } },
          { id: "variable", label: "Variable", band: { p10: 50, p50: 100, p90: 200 } },
        ],
        designs: [{ id: "base", label: "Base" }],
        evaluate: (_designId, values) => values.fixed * values.variable,
      }),
    );
    const fixed = result.tornado.find((driver) => driver.parameterId === "fixed");

    expect(fixed).toMatchObject({ lowDelta: 0, highDelta: 0, maximumAbsoluteDelta: 0 });
  });

  // T-MC-05 @spec §4.8
  it("uses common random numbers so identical designs produce only ties", () => {
    const result = runMonteCarlo(
      fixture({
        evaluate: (_designId, values) => values.prospects * values.wtp,
      }),
    );

    expect(result.comparisons).toEqual([
      {
        referenceDesignId: "base",
        challengerDesignId: "challenger",
        referenceWins: 0,
        challengerWins: 0,
        ties: 1_000,
        challengerWinRate: 0,
        meanDelta: 0,
        p10Delta: 0,
        p50Delta: 0,
        p90Delta: 0,
        expectedDownside: 0,
      },
    ]);
  });
});

// §4.8's validation contract is the part that decides whether a bad scenario is
// rejected or silently simulated. Each case below pins one refusal, plus the
// two degenerate paths (a collapsed band and an injected PRNG) that a seeded
// happy-path fixture never reaches.
describe("Monte Carlo input validation and degenerate paths", () => {
  // T-MC-06 @spec §4.8
  it("rejects a seed that is not a uint32", () => {
    for (const seed of [-1, 1.5, 4_294_967_296, Number.NaN]) {
      expect(() => runMonteCarlo(fixture({ seed }))).toThrow(RangeError);
    }
  });

  // T-MC-07 @spec §4.8
  it("rejects draw counts outside the documented bounds", () => {
    for (const drawCount of [
      MIN_MONTE_CARLO_DRAWS - 1,
      MAX_MONTE_CARLO_DRAWS + 1,
      1_000.5,
      Number.NaN,
    ]) {
      expect(() => runMonteCarlo(fixture({ drawCount }))).toThrow(RangeError);
    }
    // The bounds themselves are inclusive.
    expect(() => runMonteCarlo(fixture({ drawCount: MIN_MONTE_CARLO_DRAWS }))).not.toThrow();
  });

  // T-MC-08 @spec §4.8
  it("rejects empty, duplicated, or unnamed parameter and design lists", () => {
    expect(() => runMonteCarlo(fixture({ parameters: [] }))).toThrow(RangeError);
    expect(() => runMonteCarlo(fixture({ designs: [] }))).toThrow(RangeError);

    const band = { p10: 50, p50: 100, p90: 200 };
    expect(() =>
      runMonteCarlo(
        fixture({
          parameters: [
            { id: "dup", label: "A", band },
            { id: "dup", label: "B", band },
          ],
        }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      runMonteCarlo(fixture({ parameters: [{ id: "", label: "Blank", band }] })),
    ).toThrow(RangeError);

    expect(() =>
      runMonteCarlo(
        fixture({
          designs: [
            { id: "dup", label: "A" },
            { id: "dup", label: "B" },
          ],
          referenceDesignId: "dup",
        }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      runMonteCarlo(fixture({ designs: [{ id: "", label: "Blank" }], referenceDesignId: "" })),
    ).toThrow(RangeError);
  });

  // T-MC-09 @spec §4.8
  it("requires the reference design to be one of the designs", () => {
    expect(() => runMonteCarlo(fixture({ referenceDesignId: "absent" }))).toThrow(RangeError);
  });

  // T-MC-10 @spec §4.8
  it("rejects bands that are unordered, non-positive, or not geometrically centred", () => {
    const cases = [
      { p10: 200, p50: 100, p90: 50 },
      { p10: 0, p50: 0, p90: 200 },
      { p10: 50, p50: Number.POSITIVE_INFINITY, p90: 200 },
      // Ordered and positive, but P50 is not sqrt(P10·P90).
      { p10: 50, p50: 120, p90: 200 },
    ];
    for (const band of cases) {
      expect(() => runMonteCarlo(fixture({ parameters: [{ id: "p", label: "P", band }] }))).toThrow(
        RangeError,
      );
    }
  });

  // T-MC-11 @spec §4.8 — a collapsed band is a constant, not a degenerate draw.
  it("holds a zero-width band at its P50 across every draw", () => {
    const result = runMonteCarlo(
      fixture({
        parameters: [
          { id: "fixed", label: "Fixed", band: { p10: 100, p50: 100, p90: 100 } },
          { id: "wtp", label: "WTP", band: { p10: 50, p50: 100, p90: 200 } },
        ],
        evaluate: (_designId, values) => values.fixed * values.wtp,
      }),
    );
    expect(result.draws.every((draw) => draw.parameterValues.fixed === 100)).toBe(true);
  });

  // T-MC-12 @spec §4.8
  it("rejects an evaluator that returns a negative or non-finite MRR", () => {
    expect(() => runMonteCarlo(fixture({ evaluate: () => -1 }))).toThrow(RangeError);
    expect(() => runMonteCarlo(fixture({ evaluate: () => Number.NaN }))).toThrow(RangeError);
  });

  // T-MC-13 @spec §4.1
  it("interpolates percentiles and refuses an empty or out-of-range request", () => {
    const values = [10, 20, 30, 40];
    expect(empiricalPercentile(values, 0)).toBe(10);
    expect(empiricalPercentile(values, 1)).toBe(40);
    // Rank 0.5 × 3 = 1.5 → midway between 20 and 30.
    expect(empiricalPercentile(values, 0.5)).toBeCloseTo(25, 12);

    expect(() => empiricalPercentile([], 0.5)).toThrow(RangeError);
    expect(() => empiricalPercentile(values, -0.1)).toThrow(RangeError);
    expect(() => empiricalPercentile(values, 1.1)).toThrow(RangeError);
  });

  // T-MC-14b @spec §4.12 — an injected PRNG is still held to the [0, 1) contract.
  it("rejects an injected PRNG that leaves the unit interval", () => {
    for (const bad of [1, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => runMonteCarlo(fixture({ randomFactory: () => () => bad }))).toThrow(RangeError);
    }
    // The open upper bound is exclusive; exactly 0 is accepted and clamped.
    expect(() => runMonteCarlo(fixture({ randomFactory: () => () => 0 }))).not.toThrow();
  });

  // T-MC-14c @spec §4.8 — an unlabelled parameter falls back to its id in errors.
  it("names an unlabelled parameter by its id when its band is malformed", () => {
    expect(() =>
      runMonteCarlo(
        fixture({
          parameters: [{ id: "bare", label: "", band: { p10: 200, p50: 100, p90: 50 } }],
        }),
      ),
    ).toThrow(/bare/);
  });

  // T-MC-14 @spec §4.12 — mulberry32 is the only randomness source in the engine.
  it("produces a deterministic uint32-seeded stream in [0, 1)", () => {
    const stream = Array.from({ length: 64 }, mulberry32(7));
    expect(stream.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(Array.from({ length: 64 }, mulberry32(7))).toEqual(stream);
    expect(Array.from({ length: 64 }, mulberry32(8))).not.toEqual(stream);
  });
});

it("paired revenue difference goldens preserve signs, ties and empirical percentiles", () => {
  const draws = [80, 100, 120, 140].map((value, index) => ({
    index,
    parameterValues: {},
    mrrByDesign: { reference: 100, challenger: value },
  }));
  const result = compareDesigns("reference", "challenger", draws);
  expect(result).toMatchObject({
    meanDelta: 10,
    p10Delta: -14,
    p50Delta: 10,
    p90Delta: 34,
    expectedDownside: 5,
    challengerWins: 2,
    referenceWins: 1,
    ties: 1,
  });
  const reversed = compareDesigns("challenger", "reference", draws);
  expect(reversed).toMatchObject({
    meanDelta: -10,
    p10Delta: -34,
    p50Delta: -10,
    expectedDownside: 15,
  });
  expect(reversed.p90Delta).toBeCloseTo(14, 12);
  expect(compareDesigns("reference", "challenger", [draws[0]!])).toMatchObject({
    meanDelta: -20,
    p10Delta: -20,
    p90Delta: -20,
    expectedDownside: 20,
  });
  expect(() => compareDesigns("reference", "challenger", [])).toThrow();
  expect(() => compareDesigns("reference", "challenger", [{ ...draws[0]!, index: 1 }])).toThrow(
    /indices/,
  );
  expect(() => compareDesigns("missing", "challenger", draws)).toThrow();
});
