import { describe, expect, it } from "vitest";
import {
  erf,
  normalCdf,
  normalInv,
  lognormalCdf,
  lognormalPdf,
  lognormalQuantile,
  lognormalPartialExpectation,
  fitLognormalBand,
  scaleDistribution,
} from "./stats";
import { measure } from "./perf-profile";

describe("distribution limits and point masses (@spec §4.2)", () => {
  it("pins normal symmetry and the infinite limits", () => {
    expect(erf(Infinity)).toBe(1);
    expect(erf(-Infinity)).toBe(-1);
    expect(erf(NaN)).toBeNaN();
    expect(normalCdf(-Infinity)).toBe(0);
    expect(normalCdf(Infinity)).toBe(1);
    expect(normalCdf(NaN)).toBeNaN();
    expect(normalCdf(0)).toBe(0.5);
    // Published standard-normal quantiles, independent of the implementation.
    expect(normalInv(0.001)).toBeCloseTo(-3.090232306167813, 10);
    expect(normalInv(0.999)).toBeCloseTo(3.090232306167813, 10);
    expect(normalInv(0.5)).toBe(0);
    expect(normalCdf(-2)).toBeCloseTo(0.0227501319481792, 12);
  });

  it.each([0, 1, -0.1, 1.1, NaN, Infinity])("rejects normal quantile probability %s", (p) => {
    expect(() => normalInv(p)).toThrow(RangeError);
  });

  it("uses a point mass at exp(mu), including the open-left expectation boundary", () => {
    const d = { mu: Math.log(4), sigma: 0 };
    expect(lognormalCdf(3, d)).toBe(0);
    expect(lognormalCdf(4, d)).toBe(1);
    expect(lognormalCdf(Infinity, d)).toBe(1);
    expect(lognormalCdf(0, d)).toBe(0);
    expect(lognormalPdf(4, d)).toBe(0);
    expect(lognormalPdf(-1, { mu: 0, sigma: 1 })).toBe(0);
    expect(lognormalPartialExpectation(3, 4, d)).toBe(4);
    expect(lognormalPartialExpectation(4, 5, d)).toBe(0);
    expect(lognormalPartialExpectation(0, 3, d)).toBe(0);
    expect(lognormalQuantile(0, d)).toBe(0);
    expect(lognormalQuantile(1, d)).toBe(Infinity);
    // E[e^Z] = e^(1/2), and the density at x=1 is 1/sqrt(2 pi).
    expect(lognormalPartialExpectation(0, Infinity, { mu: 0, sigma: 1 })).toBeCloseTo(
      Math.exp(0.5),
      12,
    );
    expect(lognormalPdf(1, { mu: 0, sigma: 1 })).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 12);
    expect(fitLognormalBand(4, 4)).toEqual(d);
  });

  it.each([
    { mu: Infinity, sigma: 1 },
    { mu: 0, sigma: -1 },
    { mu: 0, sigma: NaN },
  ])("rejects malformed distribution %j", (d) => {
    for (const run of [
      () => lognormalCdf(1, d),
      () => lognormalPdf(1, d),
      () => lognormalQuantile(0.5, d),
      () => lognormalPartialExpectation(0, 1, d),
    ])
      expect(run).toThrow(RangeError);
  });

  it.each([-1, 2, NaN])("rejects lognormal quantile probability %s", (p) => {
    expect(() => lognormalQuantile(p, { mu: 0, sigma: 1 })).toThrow(RangeError);
  });

  it.each([
    [-1, 1],
    [Infinity, Infinity],
    [2, 1],
    [0, NaN],
  ])("rejects expectation interval [%s, %s]", (lower, upper) => {
    expect(() => lognormalPartialExpectation(lower, upper, { mu: 0, sigma: 1 })).toThrow(
      RangeError,
    );
  });

  it.each([
    [0, 1],
    [2, 1],
    [1, Infinity],
    [NaN, 1],
  ])("rejects P10/P90 [%s, %s]", (low, high) => {
    expect(() => fitLognormalBand(low, high)).toThrow(RangeError);
  });

  it.each([-1, NaN, Infinity])("rejects scale sigma %s", (sigma) => {
    expect(() => scaleDistribution(sigma)).toThrow(RangeError);
  });

  it("reports an empty profiler honestly while still executing the warmup", () => {
    let calls = 0;
    const result = measure("empty", 0, () => {
      calls += 1;
    });
    expect(calls).toBe(1);
    expect(result.samples).toEqual([]);
    expect(result.medianMs).toBeNaN();
    expect(result.p95Ms).toBeNaN();
    expect(result.worstMs).toBeUndefined();
  });
});
