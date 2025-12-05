import { simulateEconomics } from "@/lib/engine/economics";
import { runMonteCarlo } from "@/lib/engine/montecarlo";
import { expandOffers } from "@/lib/engine/offers";
import type {
  EconomicsInput,
  EconomicsReadout,
  MonteCarloBand,
  MonteCarloResult,
  OfferExpansionInput,
  PriceSweepSegmentInput,
  TierPriceSweepInput,
} from "@/lib/engine/types";

import type { Scenario } from "./schemas";

type ScenarioDesign = Scenario["designs"][number];
type ScenarioSegment = Scenario["model"]["segments"][number];

export interface ScenarioUncertaintyParameter {
  id: string;
  label: string;
  dimension: "prospect-count" | "willingness-to-pay";
  segmentId: string;
  band: MonteCarloBand;
  provenance: ScenarioSegment["provenance"]["prospectCount"];
}

function uncertaintyParameterId(
  segmentId: string,
  dimension: ScenarioUncertaintyParameter["dimension"],
) {
  return `${segmentId}:${dimension}`;
}

function constantBand(value: number) {
  return { p10: value, p50: value, p90: value };
}

/**
 * Builds the pure-engine offer expansion for one segment under one design.
 * Exported so every downstream state adapter (economics, sweeps, elasticity,
 * the joint optimizer) derives offers from exactly one place — a change to
 * how features become account value can never drift between surfaces.
 */
export function offerExpansionForSegment(
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
    // §4.1.1: durable interactions are stored as a fraction of the segment's
    // P50 WTP so they scale per segment like the additive allocation shares.
    // The engine works in absolute account value, so resolve them here.
    interactions: scenario.model.interactions.map((interaction) => ({
      featureIds: interaction.featureIds,
      value: interaction.valueFraction * segment.wtpBand.p50,
    })),
    // §4.15: pass the segment's expected-usage bands so any tier/add-on usage
    // line summarizes to a per-segment surcharge inside `expandOffers`.
    usageBands: segment.usageBands,
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

/** Maps durable model bands to the uncertainty engine without leaking Zod types into it. */
export function uncertaintyParametersForScenario(
  scenario: Scenario,
): readonly ScenarioUncertaintyParameter[] {
  return scenario.model.segments.flatMap((segment) => [
    {
      id: uncertaintyParameterId(segment.id, "prospect-count"),
      label: `${segment.name} prospects`,
      dimension: "prospect-count" as const,
      segmentId: segment.id,
      band: segment.prospectBand,
      provenance: segment.provenance.prospectCount,
    },
    {
      id: uncertaintyParameterId(segment.id, "willingness-to-pay"),
      label: `${segment.name} WTP`,
      dimension: "willingness-to-pay" as const,
      segmentId: segment.id,
      band: segment.wtpBand,
      provenance: segment.provenance.willingnessToPay,
    },
  ]);
}

function scenarioWithSampledAssumptions(
  scenario: Scenario,
  parameterValues: Readonly<Record<string, number>>,
): Scenario {
  return {
    ...scenario,
    model: {
      ...scenario.model,
      segments: scenario.model.segments.map((segment) => {
        const prospectCount =
          parameterValues[uncertaintyParameterId(segment.id, "prospect-count")] ??
          segment.prospectBand.p50;
        const willingnessToPay =
          parameterValues[uncertaintyParameterId(segment.id, "willingness-to-pay")] ??
          segment.wtpBand.p50;
        return {
          ...segment,
          prospectBand: constantBand(prospectCount),
          wtpBand: constantBand(willingnessToPay),
        };
      }),
    },
  };
}

/**
 * Runs the pure seeded uncertainty engine through the existing state-to-engine
 * adapter. Each design sees the exact same indexed assumption draws.
 */
export function runScenarioMonteCarlo(
  scenario: Scenario,
  drawCount: number,
): MonteCarloResult | null {
  if (scenario.model.segments.length === 0) return null;
  const parameters = uncertaintyParametersForScenario(scenario);
  let previousValues: Readonly<Record<string, number>> | undefined;
  let sampledScenario = scenario;

  return runMonteCarlo({
    seed: scenario.settings.seed,
    drawCount,
    parameters,
    designs: scenario.designs.map((design) => ({ id: design.id, label: design.name })),
    referenceDesignId: scenario.activeDesignId,
    evaluate: (designId, parameterValues) => {
      if (parameterValues !== previousValues) {
        sampledScenario = scenarioWithSampledAssumptions(scenario, parameterValues);
        previousValues = parameterValues;
      }
      const design = sampledScenario.designs.find((candidate) => candidate.id === designId);
      if (!design) throw new RangeError(`Unknown scenario design “${designId}”.`);
      return simulateScenarioDesign(sampledScenario, design)?.mrr ?? 0;
    },
  });
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
