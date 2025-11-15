import { describe, expect, it } from "vitest";

import {
  fitLognormalBand,
  lognormalPartialExpectation,
  lognormalQuantile,
  normalCdf,
  normalInv,
  type LognormalDistribution,
} from "./stats";

function numericPartialExpectation(
  lower: number,
  upper: number,
  distribution: LognormalDistribution,
): number {
  const lowerLog = lower === 0 ? distribution.mu - 10 * distribution.sigma : Math.log(lower);
  const upperLog =
    upper === Number.POSITIVE_INFINITY
      ? distribution.mu + 10 * distribution.sigma
      : Math.log(upper);
  const steps = 20_000;
  const width = (upperLog - lowerLog) / steps;
  const integrand = (logValue: number) => {
    const standardized = (logValue - distribution.mu) / distribution.sigma;
    return (
      Math.exp(logValue - (standardized * standardized) / 2) /
      (distribution.sigma * Math.sqrt(2 * Math.PI))
    );
  };
  let sum = integrand(lowerLog) + integrand(upperLog);
  for (let index = 1; index < steps; index += 1) {
    sum += (index % 2 === 0 ? 2 : 4) * integrand(lowerLog + width * index);
  }
  return (sum * width) / 3;
}

describe("statistics primitives", () => {
  // T-STAT-01 @spec §4.1
  it("matches reference Φ values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1)).toBeCloseTo(0.8413447461, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021049, 7);
    expect(normalCdf(-3)).toBeCloseTo(0.001349898, 7);
  });

  // T-STAT-02 @spec §4.1
  it("round-trips Φ and Φ⁻¹ across the specified grid", () => {
    for (let value = -6; value <= 6; value += 0.25) {
      const absoluteError = Math.abs(normalInv(normalCdf(value)) - value);
      // At +6σ, the CDF is within nine decimal places of 1. IEEE-754 can no
      // longer represent its tail more finely than roughly 9e-9 in x-space.
      // The interior grid remains tighter than 1e-9; this endpoint is the
      // representational bound of a number-returning CDF, not an approximation
      // error in either routine.
      expect(absoluteError).toBeLessThanOrEqual(Math.abs(value) === 6 ? 1e-8 : 1e-9);
    }
  });

  // T-STAT-03 @spec §4.1
  it("round-trips the P10/P90 band fit", () => {
    for (const [q10, q90] of [
      [20, 80],
      [100, 100],
      [1.25, 991.3],
    ]) {
      const distribution = fitLognormalBand(q10, q90);
      expect(lognormalQuantile(0.1, distribution)).toBeCloseTo(q10, 9);
      expect(lognormalQuantile(0.9, distribution)).toBeCloseTo(q90, 9);
    }
  });

  // T-STAT-04 @spec §4.1
  it("matches independent Simpson integration for lognormal partial expectations", () => {
    const fixtures: Array<[number, number, LognormalDistribution]> = Array.from(
      { length: 20 },
      (_, index) => {
        const sigma = 0.15 + ((index * 37) % 100) / 100;
        const mu = -0.8 + ((index * 29) % 80) / 100;
        const lower = index % 3 === 0 ? 0 : Math.exp(mu - sigma * (0.4 + (index % 5)));
        const upper =
          index % 4 === 0
            ? Number.POSITIVE_INFINITY
            : Math.exp(mu + sigma * (0.3 + ((index * 3) % 6)));
        return [lower, upper, { mu, sigma }];
      },
    );

    for (const [lower, upper, distribution] of fixtures) {
      const expected = numericPartialExpectation(lower, upper, distribution);
      const actual = lognormalPartialExpectation(lower, upper, distribution);
      expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-6);
    }
  });
});
