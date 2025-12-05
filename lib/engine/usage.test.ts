import { describe, expect, it } from "vitest";
import { expectedUsageCost, summarizeUsageCost } from "./usage";

describe("usage cost (@spec §4.15)", () => {
  it("T-USG-01 charges billed volume above the included allowance", () => {
    const cost = expectedUsageCost({
      usagePricing: { metricId: "calls", perUnitPrice: 0.002, includedUnits: 10_000 },
      band: { p10: 15_000, p50: 20_000, p90: 30_000 },
    });
    expect(cost).toBeCloseTo((20_000 - 10_000) * 0.002, 12);
  });

  it("T-USG-01 returns zero when P50 usage stays inside the included allowance", () => {
    const cost = expectedUsageCost({
      usagePricing: { metricId: "gb", perUnitPrice: 5, includedUnits: 100 },
      band: { p10: 20, p50: 40, p90: 80 },
    });
    expect(cost).toBe(0);
  });

  it("T-USG-02 sums surcharges across multiple lines", () => {
    const total = summarizeUsageCost({
      usagePricing: [
        { metricId: "calls", perUnitPrice: 0.001, includedUnits: 0 },
        { metricId: "gb", perUnitPrice: 4, includedUnits: 10 },
      ],
      usageBands: {
        calls: { p10: 500, p50: 1_000, p90: 2_000 },
        gb: { p10: 20, p50: 30, p90: 60 },
      },
    });
    expect(total).toBeCloseTo(1_000 * 0.001 + (30 - 10) * 4, 12);
  });

  it("T-USG-02 treats a missing metric band as inert (no surcharge, no throw)", () => {
    const total = summarizeUsageCost({
      usagePricing: [{ metricId: "ghost", perUnitPrice: 5, includedUnits: 0 }],
      usageBands: { other: { p10: 10, p50: 20, p90: 40 } },
    });
    expect(total).toBe(0);
  });

  it("T-USG-03 omitting all usage lines is byte-identical to zero surcharge", () => {
    const zero = summarizeUsageCost({ usageBands: {} });
    expect(zero).toBe(0);
    const emptyList = summarizeUsageCost({ usagePricing: [], usageBands: {} });
    expect(emptyList).toBe(0);
  });

  it("T-USG-04 rejects malformed inputs with an actionable error", () => {
    expect(() =>
      expectedUsageCost({
        usagePricing: { metricId: "calls", perUnitPrice: Number.NaN },
        band: { p10: 1, p50: 2, p90: 3 },
      }),
    ).toThrow(/finite, non-negative/);
    expect(() =>
      expectedUsageCost({
        usagePricing: { metricId: "calls", perUnitPrice: 1, includedUnits: -5 },
        band: { p10: 1, p50: 2, p90: 3 },
      }),
    ).toThrow(/Included units/);
    expect(() =>
      expectedUsageCost({
        usagePricing: { metricId: "calls", perUnitPrice: 1 },
        band: { p10: 5, p50: 3, p90: 4 },
      }),
    ).toThrow(/P10 ≤ P50 ≤ P90/);
  });
});
