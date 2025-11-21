import { simulateEconomics } from "@/lib/engine/economics";
import { expandOffers } from "@/lib/engine/offers";
import type { EconomicsInput, EconomicsReadout } from "@/lib/engine/types";

import type { Scenario } from "./schemas";

type ScenarioDesign = Scenario["designs"][number];

/**
 * Adapts durable scenario data to the pure pricing-engine contract. Keeping
 * this boundary in state prevents engine modules from depending on Zod data.
 */
export function economicsInputForDesign(
  scenario: Scenario,
  design: ScenarioDesign,
): EconomicsInput | null {
  if (scenario.model.segments.length === 0) return null;

  return {
    segments: scenario.model.segments.map((segment) => ({
      id: segment.id,
      prospectCount: segment.prospectBand.p50,
      fullCatalogValue: segment.wtpBand.p50,
      sigma: segment.withinSegmentSigma,
      offers: expandOffers({
        seatCount: segment.seatCount,
        featureValues: Object.fromEntries(
          scenario.model.features.map((feature) => [
            feature.id,
            segment.wtpBand.p50 * segment.featureAllocation[feature.id],
          ]),
        ),
        tiers: design.tiers,
        addOns: design.addOns,
        competitors: scenario.competitors.map((competitor) => ({
          id: competitor.id,
          name: competitor.name,
          price: competitor.price,
          priceMetric: competitor.priceMetric,
          value: competitor.valueBySegment[segment.id],
        })),
        includeCompetitors: scenario.competitors.length > 0,
      }),
    })),
  };
}

export function simulateScenarioDesign(
  scenario: Scenario,
  design: ScenarioDesign,
): EconomicsReadout | null {
  const input = economicsInputForDesign(scenario, design);
  return input ? simulateEconomics(input) : null;
}
