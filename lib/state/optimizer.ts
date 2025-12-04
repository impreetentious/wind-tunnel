import {
  optimizeJointPrices,
  type JointOptimizerResult,
  type OptimizerTierPrice,
} from "@/lib/engine/optimizer";
import type { PriceSweepSegmentInput } from "@/lib/engine/types";

import { activeDesign } from "./design-editing";
import { offerExpansionForSegment } from "./scenario-economics";
import type { Scenario } from "./schemas";

/**
 * Adapts the active design to the §4.14 joint optimizer. The optimizer is a
 * local coordinate-descent search seeded from the current prices; it never
 * mutates the scenario. The caller applies the returned prices explicitly
 * (see {@link applyOptimizedPrices}), which is the honesty contract: the tool
 * proposes, the owner decides.
 */
export function optimizeScenarioPrices(scenario: Scenario): JointOptimizerResult | null {
  if (scenario.model.segments.length === 0) return null;
  const design = activeDesign(scenario);
  if (design.tiers.length === 0) return null;

  const segments: PriceSweepSegmentInput[] = scenario.model.segments.map((segment) => ({
    id: segment.id,
    prospectCount: segment.prospectBand.p50,
    sigma: segment.withinSegmentSigma,
    fullCatalogValue: segment.wtpBand.p50,
    offerExpansion: offerExpansionForSegment(scenario, design, segment),
  }));

  return optimizeJointPrices({
    segments,
    tiers: design.tiers.map((tier) => ({
      tierId: tier.id,
      currentPrice: tier.price,
      priceMetric: tier.priceMetric,
    })),
    seed: scenario.settings.seed,
  });
}

/**
 * Writes an optimizer price vector back onto the active design's tiers. Only
 * tiers named in the vector are touched; metrics, fences, and add-ons are left
 * exactly as they were. Returns the scenario unchanged if the active design has
 * no matching tier, so a stale proposal can never blank out a menu.
 */
export function applyOptimizedPrices(
  scenario: Scenario,
  prices: readonly OptimizerTierPrice[],
): Scenario {
  const priceByTier = new Map(prices.map((entry) => [entry.tierId, entry.price]));
  const design = activeDesign(scenario);
  if (!design.tiers.some((tier) => priceByTier.has(tier.id))) return scenario;

  return {
    ...scenario,
    designs: scenario.designs.map((candidate) =>
      candidate.id !== design.id
        ? candidate
        : {
            ...candidate,
            tiers: candidate.tiers.map((tier) => {
              const price = priceByTier.get(tier.id);
              return price === undefined || !(Number.isFinite(price) && price >= 0)
                ? tier
                : { ...tier, price };
            }),
          },
    ),
  };
}
