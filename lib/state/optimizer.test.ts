import { describe, expect, it } from "vitest";

import { activeDesign } from "./design-editing";
import { applyOptimizedPrices, optimizeScenarioPrices } from "./optimizer";
import { scenarioSchema } from "./schemas";
import { createBlankScenario } from "./scenario-store";
import { plgCollaborationTemplate } from "./templates";

/**
 * @spec §4.14 — the state adapter over the joint price optimizer. It must carry
 * the local-search disclosure, weakly improve on the current design, stay
 * deterministic, and apply results back onto only the active design's tier
 * prices without mutating fences or metrics.
 */
describe("joint optimizer state adapter", () => {
  it("weakly improves scenario MRR and carries the honesty disclosure", () => {
    const result = optimizeScenarioPrices(plgCollaborationTemplate);
    expect(result).not.toBeNull();
    expect(result!.disclosure).toMatch(/not a global/i);
    expect(result!.bestMrr).toBeGreaterThanOrEqual(result!.baselineMrr - 1e-6);
    if (result!.status === "localOptimum") {
      expect(result!.mrrLift).toBeGreaterThan(0);
    }
  });

  it("is deterministic for a fixed scenario and seed", () => {
    const a = optimizeScenarioPrices(plgCollaborationTemplate);
    const b = optimizeScenarioPrices(plgCollaborationTemplate);
    expect(b!.bestMrr).toBe(a!.bestMrr);
    expect(b!.bestPrices).toEqual(a!.bestPrices);
  });

  it("applies proposed prices to only the active design's tier prices", () => {
    const result = optimizeScenarioPrices(plgCollaborationTemplate)!;
    const before = activeDesign(plgCollaborationTemplate);
    const applied = applyOptimizedPrices(plgCollaborationTemplate, result.bestPrices);
    const after = activeDesign(applied);

    expect(scenarioSchema.safeParse(applied).success).toBe(true);
    const priceByTier = new Map(result.bestPrices.map((entry) => [entry.tierId, entry.price]));
    for (let index = 0; index < after.tiers.length; index += 1) {
      const tier = after.tiers[index];
      const expectedPrice = priceByTier.get(tier.id);
      if (expectedPrice !== undefined) expect(tier.price).toBeCloseTo(expectedPrice, 9);
      // Everything except the price is preserved verbatim.
      expect(tier.featureIds).toEqual(before.tiers[index].featureIds);
      expect(tier.priceMetric).toBe(before.tiers[index].priceMetric);
    }
    // Add-ons are untouched.
    expect(after.addOns).toEqual(before.addOns);
  });

  it("leaves the scenario unchanged when no proposed tier exists", () => {
    const unchanged = applyOptimizedPrices(plgCollaborationTemplate, [
      { tierId: "does-not-exist", price: 5 },
    ]);
    expect(unchanged).toBe(plgCollaborationTemplate);
  });

  it("returns null when there are no segments or tiers to search", () => {
    expect(optimizeScenarioPrices(createBlankScenario())).toBeNull();
  });
});
