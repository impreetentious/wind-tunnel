import { describe, expect, it } from "vitest";

import {
  erf,
  fitLognormalBand,
  lognormalCdf,
  lognormalPartialExpectation,
  lognormalPdf,
  lognormalQuantile,
  normalCdf,
  normalInv,
  scaleDistribution,
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

// The blocks below cover the guard and limit branches of §4.1 — the ones a
// happy-path fixture never reaches. They are the branches that decide what the
// engine does with a degenerate band, an infinite bound, or a probability at
// the very edge of its domain, so they are worth pinning by behaviour rather
// than leaving to a coverage report.
describe("stats — domain guards and limits", () => {
  // T-STAT-05 @spec §4.1
  it("returns exact limits at ±Infinity and NaN for undefined input", () => {
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(Number.isNaN(normalCdf(Number.NaN))).toBe(true);

    expect(erf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(erf(Number.NEGATIVE_INFINITY)).toBe(-1);
    expect(Number.isNaN(erf(Number.NaN))).toBe(true);
  });

  // T-STAT-06 @spec §4.1
  it("keeps erf odd and normalCdf symmetric across the sign branch", () => {
    for (const value of [0.25, 1, 2.5, 6]) {
      expect(erf(-value)).toBeCloseTo(-erf(value), 12);
      expect(normalCdf(-value)).toBeCloseTo(1 - normalCdf(value), 12);
    }
  });

  // T-STAT-07 @spec §4.1
  it("rejects probabilities outside the open unit interval", () => {
    for (const probability of [0, 1, -0.1, 1.1, Number.NaN]) {
      expect(() => normalInv(probability)).toThrow(RangeError);
    }
  });

  // T-STAT-08 @spec §4.1 — exercises both Acklam tail branches, not just the centre.
  it("inverts the normal CDF in both tails and the central region", () => {
    for (const probability of [1e-8, 0.001, 0.02, 0.3, 0.5, 0.7, 0.98, 0.999]) {
      expect(normalCdf(normalInv(probability))).toBeCloseTo(probability, 9);
    }
  });

  // T-STAT-09 @spec §4.1
  it("rejects malformed distributions and bands", () => {
    expect(() => lognormalQuantile(0.5, { mu: Number.NaN, sigma: 1 })).toThrow(RangeError);
    expect(() => lognormalQuantile(0.5, { mu: 0, sigma: -1 })).toThrow(RangeError);
    expect(() => lognormalQuantile(1.5, { mu: 0, sigma: 1 })).toThrow(RangeError);

    expect(() => fitLognormalBand(0, 10)).toThrow(RangeError);
    expect(() => fitLognormalBand(10, 1)).toThrow(RangeError);
    expect(() => fitLognormalBand(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  // T-STAT-10 @spec §4.1
  it("treats a zero-sigma distribution as a point mass", () => {
    const point: LognormalDistribution = { mu: Math.log(40), sigma: 0 };

    expect(lognormalPdf(40, point)).toBe(0);
    expect(lognormalCdf(39, point)).toBe(0);
    expect(lognormalCdf(40, point)).toBe(1);
    // The mass is inside (lower, upper] — and only there.
    expect(lognormalPartialExpectation(0, 40, point)).toBeCloseTo(40, 12);
    expect(lognormalPartialExpectation(40, 100, point)).toBe(0);
  });

  // T-STAT-11 @spec §4.1
  it("pins the closed-form endpoints of the lognormal family", () => {
    const distribution: LognormalDistribution = { mu: 0, sigma: 0.4 };

    expect(lognormalPdf(0, distribution)).toBe(0);
    expect(lognormalPdf(-5, distribution)).toBe(0);
    expect(lognormalCdf(0, distribution)).toBe(0);
    expect(lognormalCdf(Number.POSITIVE_INFINITY, distribution)).toBe(1);
    expect(lognormalQuantile(0, distribution)).toBe(0);
    expect(lognormalQuantile(1, distribution)).toBe(Number.POSITIVE_INFINITY);

    // The unbounded partial expectation is the whole mean.
    const mean = Math.exp(distribution.mu + (distribution.sigma * distribution.sigma) / 2);
    expect(lognormalPartialExpectation(0, Number.POSITIVE_INFINITY, distribution)).toBeCloseTo(
      mean,
      10,
    );
  });

  // T-STAT-12 @spec §4.1
  it("rejects partial-expectation bounds that are not ordered and finite", () => {
    const distribution: LognormalDistribution = { mu: 0, sigma: 0.4 };
    expect(() => lognormalPartialExpectation(-1, 10, distribution)).toThrow(RangeError);
    expect(() => lognormalPartialExpectation(Number.POSITIVE_INFINITY, 10, distribution)).toThrow(
      RangeError,
    );
    expect(() => lognormalPartialExpectation(10, 1, distribution)).toThrow(RangeError);
    expect(() => lognormalPartialExpectation(1, Number.NaN, distribution)).toThrow(RangeError);
  });

  // T-STAT-13 @spec §4.1
  it("builds a median-one scale distribution and rejects a negative sigma", () => {
    const scale = scaleDistribution(0.3);
    expect(lognormalQuantile(0.5, scale)).toBeCloseTo(1, 12);
    expect(() => scaleDistribution(-0.1)).toThrow(RangeError);
  });
});

// erf(0) is the one input that short-circuits the incomplete-gamma series
// before it starts; pinning it keeps the identity exact rather than
// approximately zero.
describe("stats — exact zero", () => {
  // T-STAT-14 @spec §4.1
  it("returns exactly zero at the origin", () => {
    expect(erf(0)).toBe(0);
    expect(normalCdf(0)).toBeCloseTo(0.5, 15);
    expect(normalInv(0.5)).toBeCloseTo(0, 12);
  });
});
