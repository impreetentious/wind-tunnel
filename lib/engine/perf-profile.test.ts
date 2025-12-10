import { describe, expect, it } from "vitest";
import { simulateEconomics } from "./economics";
import { expandOffers } from "./offers";
import { measure } from "./perf-profile";

/**
 * Worst-case-ish scenario: 6 segments × 5 tiers × 3 add-ons (2³ = 8 subsets)
 * × 6 competitors. This is what the §4.2 offer expansion caps out at.
 */
function buildWorstCaseInput() {
  const featureIds = Array.from({ length: 12 }, (_, index) => `f-${index}`);
  const tiers = Array.from({ length: 5 }, (_, index) => ({
    id: `tier-${index}`,
    name: `Tier ${index}`,
    price: 50 + index * 40,
    priceMetric: "flat" as const,
    featureIds: featureIds.slice(0, 3 + index * 2),
  }));
  const addOns = Array.from({ length: 3 }, (_, index) => ({
    id: `addon-${index}`,
    name: `AddOn ${index}`,
    price: 15 + index * 10,
    priceMetric: "flat" as const,
    featureIds: featureIds.slice(9 + index, 12),
  }));
  const featureValues = Object.fromEntries(featureIds.map((id) => [id, 15]));
  const competitors = Array.from({ length: 6 }, (_, index) => ({
    id: `c-${index}`,
    name: `C-${index}`,
    price: 80 + index * 20,
    priceMetric: "flat" as const,
    value: 200 + index * 30,
  }));
  const offers = expandOffers({
    seatCount: 5,
    featureValues,
    tiers,
    addOns,
    competitors,
    includeCompetitors: true,
  });
  return {
    segments: Array.from({ length: 6 }, (_, index) => ({
      id: `s-${index}`,
      prospectCount: 500,
      fullCatalogValue: 12 * 15,
      sigma: 0.35 + index * 0.03,
      offers,
    })),
  };
}

describe("engine perf profile (@spec §15 M-16)", () => {
  it("worst-case scenario simulation stays inside a generous local budget", () => {
    const input = buildWorstCaseInput();
    const profile = measure("worst-case-sim", 50, () => {
      simulateEconomics(input);
    });
    // 12 ms P95 is a very generous local budget (§3.5 target is < 16 ms
    // for edit → re-simulate → repaint including React reconciliation).
    // Machines vary; keep the gate lenient enough to run in every CI runner
    // but strict enough to flag a real regression.
    expect(profile.p95Ms).toBeLessThan(12);
    expect(profile.medianMs).toBeLessThan(6);
  });
});
