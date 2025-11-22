import { describe, expect, it } from "vitest";

import { fitLognormalBand } from "./stats";
import { runMonteCarlo } from "./montecarlo";
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

describe("P7a seeded Monte Carlo uncertainty", () => {
  // T-MC-01 @spec §4.8
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
      },
    ]);
  });
});
