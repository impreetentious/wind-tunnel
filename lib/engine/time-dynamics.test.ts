import { describe, expect, it } from "vitest";
import { projectTimeDynamics } from "./time-dynamics";

const baseSegment = {
  id: "s1",
  trialLength: 0,
  trialConversion: 1,
  monthlyRetention: 1,
  contractTerm: "monthly" as const,
  monthlyMrr: 1_000,
  arpa: 100,
  paidSelectors: 10,
};

describe("time dynamics (@spec §4.16)", () => {
  it("T-TIME-01 zero defaults collapse to the single-period §4.3 readout at t=0", () => {
    const result = projectTimeDynamics({ segments: [baseSegment], periods: 0 });
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toEqual({ period: 0, mrr: 1_000, activeBuyers: 10 });
    expect(result.cumulativeRevenue).toBe(1_000);
    expect(result.segments[0].ltvPerAcquired).toBeCloseTo(100, 12);
  });

  it("T-TIME-02 a paid-trial delay zeroes revenue until conversion, then scales it by the rate", () => {
    const result = projectTimeDynamics({
      segments: [{ ...baseSegment, trialLength: 3, trialConversion: 0.5 }],
      periods: 5,
    });
    // §4.16: `mrr_s(t ≥ trialLength) = trialConversion_s · M_s`. Half the cohort converts, so
    // half the §4.3 MRR arrives — the rate has to move revenue and buyers by the same factor,
    // or ARPA silently doubles at trial end.
    expect(result.points.map((p) => p.mrr)).toEqual([0, 0, 0, 500, 500, 500]);
    expect(result.segments[0].points[3].activeBuyers).toBeCloseTo(5, 12);
    expect(result.cumulativeRevenue).toBeCloseTo(3 * 500, 12);
    // ARPA is invariant across trial end: 500 / 5 converted = the pre-trial 1000 / 10 selectors.
    const paid = result.segments[0].points[3];
    expect(paid.mrr / paid.activeBuyers).toBeCloseTo(baseSegment.monthlyMrr / 10, 12);
    // §4.16 LTV per *acquired* selector: trialConversion · ARPA · Σ retention^k, retention = 1.
    expect(result.segments[0].ltvPerAcquired).toBeCloseTo(0.5 * 100 * 3, 12);
  });

  it("T-TIME-03 retention < 1 shrinks MRR geometrically each month", () => {
    const result = projectTimeDynamics({
      segments: [{ ...baseSegment, monthlyRetention: 0.8 }],
      periods: 3,
    });
    const mrrs = result.points.map((p) => p.mrr);
    expect(mrrs[0]).toBeCloseTo(1_000, 12);
    expect(mrrs[1]).toBeCloseTo(1_000 * 0.8, 12);
    expect(mrrs[2]).toBeCloseTo(1_000 * 0.8 * 0.8, 12);
    expect(mrrs[3]).toBeCloseTo(1_000 * 0.8 ** 3, 12);
  });

  it("T-TIME-04 LTV equals the closed-form geometric sum truncated to the horizon", () => {
    const retention = 0.9;
    const periods = 12;
    const result = projectTimeDynamics({
      segments: [{ ...baseSegment, monthlyRetention: retention }],
      periods,
    });
    const expected = Array.from({ length: periods + 1 }, (_, k) => retention ** k).reduce(
      (a, b) => a + b,
      0,
    );
    // paidSelectors=10, converted=10; per-acquired LTV = cumulativeRevenue / 10.
    // MRR per period t = 1000 · retention^t.
    expect(result.cumulativeRevenue).toBeCloseTo(1_000 * expected, 8);
    expect(result.segments[0].ltvPerAcquired).toBeCloseTo(100 * expected, 8);
  });

  it("T-TIME-05 annual contract keeps MRR flat within a year and drops at the anniversary", () => {
    const result = projectTimeDynamics({
      segments: [
        {
          ...baseSegment,
          contractTerm: "annual",
          monthlyRetention: 0.9,
        },
      ],
      periods: 24,
    });
    const mrrs = result.points.map((p) => p.mrr);
    // Months 0–11 flat at 1000; month 12 drops to 900; months 12–23 flat; month 24 drops to 810.
    for (let k = 0; k < 12; k += 1) expect(mrrs[k]).toBeCloseTo(1_000, 12);
    for (let k = 12; k < 24; k += 1) expect(mrrs[k]).toBeCloseTo(900, 12);
    expect(mrrs[24]).toBeCloseTo(810, 12);
  });

  it("rejects malformed inputs with actionable errors", () => {
    expect(() =>
      projectTimeDynamics({
        segments: [{ ...baseSegment, monthlyRetention: 1.5 }],
        periods: 3,
      }),
    ).toThrow(/monthlyRetention/);
    expect(() =>
      projectTimeDynamics({
        segments: [{ ...baseSegment, trialLength: 2.5 }],
        periods: 3,
      }),
    ).toThrow(/trialLength/);
    expect(() => projectTimeDynamics({ segments: [baseSegment], periods: -1 })).toThrow(/periods/);
  });
});

// §4.16's projection takes user-entered rates, so its unit-interval and
// integer guards are the boundary that stops a 150% retention or a fractional
// month producing a plausible-looking curve. The zero-buyer and zero-retention
// paths are separate arithmetic branches, not just extreme values.
describe("time dynamics guards and degenerate paths", () => {
  // T-TIME-G1 @spec §4.16
  it("rejects rates outside [0, 1]", () => {
    for (const field of ["trialConversion", "monthlyRetention"] as const) {
      for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          projectTimeDynamics({ segments: [{ ...baseSegment, [field]: bad }], periods: 3 }),
        ).toThrow(RangeError);
      }
    }
  });

  // T-TIME-G2 @spec §4.16
  it("rejects non-integer or negative period and term counts", () => {
    expect(() => projectTimeDynamics({ segments: [baseSegment], periods: -1 })).toThrow(RangeError);
    expect(() => projectTimeDynamics({ segments: [baseSegment], periods: 2.5 })).toThrow(
      RangeError,
    );
    expect(() =>
      projectTimeDynamics({ segments: [{ ...baseSegment, trialLength: -1 }], periods: 3 }),
    ).toThrow(RangeError);
    expect(() =>
      projectTimeDynamics({ segments: [{ ...baseSegment, trialLength: 1.5 }], periods: 3 }),
    ).toThrow(RangeError);
  });

  // T-TIME-G3 @spec §4.16
  it("rejects a malformed MRR or selector count", () => {
    for (const field of ["monthlyMrr", "paidSelectors"] as const) {
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          projectTimeDynamics({ segments: [{ ...baseSegment, [field]: bad }], periods: 3 }),
        ).toThrow(RangeError);
      }
    }
  });

  // T-TIME-G4 @spec §4.16 — nobody converts, so there is no revenue to retain.
  it("produces a flat zero curve when conversion is zero", () => {
    const result = projectTimeDynamics({
      segments: [{ ...baseSegment, trialLength: 2, trialConversion: 0 }],
      periods: 4,
    });
    expect(result.points.every((point) => point.mrr === 0)).toBe(true);
    expect(result.cumulativeRevenue).toBe(0);
    expect(result.segments[0].ltvPerAcquired).toBe(0);
  });

  // T-TIME-G5 @spec §4.16 — total churn after the first paid month.
  it("drops to zero revenue when retention is zero", () => {
    const result = projectTimeDynamics({
      segments: [{ ...baseSegment, monthlyRetention: 0 }],
      periods: 3,
    });
    expect(result.points[0].mrr).toBe(1_000);
    expect(result.points.slice(1).every((point) => point.mrr === 0)).toBe(true);
  });

  // T-TIME-G6 @spec §4.16 — no acquired buyers means LTV is undefined, not NaN.
  it("reports zero LTV rather than dividing by zero selectors", () => {
    const result = projectTimeDynamics({
      segments: [{ ...baseSegment, paidSelectors: 0 }],
      periods: 3,
    });
    expect(result.segments[0].ltvPerAcquired).toBe(0);
    expect(Number.isNaN(result.cumulativeRevenue)).toBe(false);
  });
});
