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

  it("T-TIME-02 a paid-trial delay zeroes revenue until conversion", () => {
    const result = projectTimeDynamics({
      segments: [{ ...baseSegment, trialLength: 3, trialConversion: 0.5 }],
      periods: 5,
    });
    expect(result.points.map((p) => p.mrr)).toEqual([0, 0, 0, 1_000, 1_000, 1_000]);
    expect(result.segments[0].points[3].activeBuyers).toBeCloseTo(5, 12);
    expect(result.cumulativeRevenue).toBeCloseTo(3 * 1_000, 12);
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
