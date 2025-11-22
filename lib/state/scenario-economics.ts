import { simulateEconomics } from "@/lib/engine/economics";
import { expandOffers } from "@/lib/engine/offers";
import type {
  EconomicsInput,
  EconomicsReadout,
  OfferExpansionInput,
  PriceSweepSegmentInput,
  TierPriceSweepInput,
} from "@/lib/engine/types";

import type { Scenario } from "./schemas";

type ScenarioDesign = Scenario["designs"][number];

function offerExpansionForSegment(
  scenario: Scenario,
  design: ScenarioDesign,
  segment: Scenario["model"]["segments"][number],
): OfferExpansionInput {
  return {
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
  };
}

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
      offers: expandOffers(offerExpansionForSegment(scenario, design, segment)),
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

/**
 * Builds the state-to-engine adapter for one live tier price sweep. The
 * rendered charts consume this input directly so the simulator remains the
 * only source of displayed demand and revenue values.
 */
export function priceSweepInputForDesign(
  scenario: Scenario,
  design: ScenarioDesign,
  tierId: string,
): TierPriceSweepInput | null {
  if (scenario.model.segments.length === 0 || !design.tiers.some((tier) => tier.id === tierId)) {
    return null;
  }

  const segments: PriceSweepSegmentInput[] = scenario.model.segments.map((segment) => ({
    id: segment.id,
    prospectCount: segment.prospectBand.p50,
    sigma: segment.withinSegmentSigma,
    fullCatalogValue: segment.wtpBand.p50,
    offerExpansion: offerExpansionForSegment(scenario, design, segment),
  }));

  return { tierId, segments };
}
