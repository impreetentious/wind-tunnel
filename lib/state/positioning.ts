import { buildPositioningMap, type PositioningMap } from "@/lib/engine/competitive";
import type { CompetitorDefinition } from "@/lib/engine/types";

import { activeDesign } from "./design-editing";
import type { Scenario } from "./schemas";

type ScenarioCompetitor = Scenario["competitors"][number];
type ScenarioSegment = Scenario["model"]["segments"][number];

const MAX_COMPETITORS = 6;

function identifierBase(name: string, fallback: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function nextId(existingIds: readonly string[], base: string) {
  if (!existingIds.includes(base)) return base;
  let suffix = 2;
  while (existingIds.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function defaultCompetitorValueForSegment(segment: ScenarioSegment) {
  // The Model already knows a plausible whole-catalog value for this segment.
  // Using the P50 WTP as the default keeps the map calibrated to owner input
  // rather than an arbitrary constant.
  return segment.wtpBand.p50;
}

/** Builds the per-segment value map used as the "overall" default (P50 WTP). */
function defaultValueBySegment(scenario: Scenario): Record<string, number> {
  return Object.fromEntries(
    scenario.model.segments.map((segment) => [
      segment.id,
      defaultCompetitorValueForSegment(segment),
    ]),
  );
}

export function canAddCompetitor(scenario: Scenario) {
  return scenario.competitors.length < MAX_COMPETITORS;
}

/**
 * Adds a competitor sized against every current segment. Callers can then
 * refine per-segment values from the positioning surface.
 */
export function addCompetitor(scenario: Scenario, name = "New competitor"): Scenario {
  if (!canAddCompetitor(scenario)) return scenario;
  const normalizedName = name.trim() || "New competitor";
  const id = nextId(
    scenario.competitors.map((competitor) => competitor.id),
    identifierBase(normalizedName, "competitor"),
  );
  return {
    ...scenario,
    competitors: [
      ...scenario.competitors,
      {
        id,
        name: normalizedName,
        price: 0,
        priceMetric: "flat",
        valueBySegment: defaultValueBySegment(scenario),
      },
    ],
  };
}

export function renameCompetitor(scenario: Scenario, competitorId: string, name: string): Scenario {
  const normalized = name.trim();
  if (!normalized) return scenario;
  return {
    ...scenario,
    competitors: scenario.competitors.map((competitor) =>
      competitor.id === competitorId ? { ...competitor, name: normalized } : competitor,
    ),
  };
}

export function setCompetitorPrice(
  scenario: Scenario,
  competitorId: string,
  price: number,
): Scenario {
  if (!(Number.isFinite(price) && price >= 0)) return scenario;
  return {
    ...scenario,
    competitors: scenario.competitors.map((competitor) =>
      competitor.id === competitorId ? { ...competitor, price } : competitor,
    ),
  };
}

export function setCompetitorPriceMetric(
  scenario: Scenario,
  competitorId: string,
  priceMetric: ScenarioCompetitor["priceMetric"],
): Scenario {
  return {
    ...scenario,
    competitors: scenario.competitors.map((competitor) =>
      competitor.id === competitorId ? { ...competitor, priceMetric } : competitor,
    ),
  };
}

export function setCompetitorValueForSegment(
  scenario: Scenario,
  competitorId: string,
  segmentId: string,
  value: number,
): Scenario {
  if (!(Number.isFinite(value) && value >= 0)) return scenario;
  if (!scenario.model.segments.some((segment) => segment.id === segmentId)) return scenario;
  return {
    ...scenario,
    competitors: scenario.competitors.map((competitor) => {
      if (competitor.id !== competitorId) return competitor;
      return {
        ...competitor,
        valueBySegment: { ...competitor.valueBySegment, [segmentId]: value },
      };
    }),
  };
}

/**
 * Applies one value to every segment — the "overall" convenience action. The
 * per-segment cell edits above stay authoritative; this action is a one-shot
 * spread, not a linked shortcut.
 */
export function setCompetitorOverallValue(
  scenario: Scenario,
  competitorId: string,
  value: number,
): Scenario {
  if (!(Number.isFinite(value) && value >= 0)) return scenario;
  return {
    ...scenario,
    competitors: scenario.competitors.map((competitor) => {
      if (competitor.id !== competitorId) return competitor;
      const valueBySegment = Object.fromEntries(
        scenario.model.segments.map((segment) => [segment.id, value]),
      );
      return { ...competitor, valueBySegment };
    }),
  };
}

export function removeCompetitor(scenario: Scenario, competitorId: string): Scenario {
  return {
    ...scenario,
    competitors: scenario.competitors.filter((competitor) => competitor.id !== competitorId),
  };
}

function scenarioSegment(scenario: Scenario, segmentId: string): ScenarioSegment {
  const segment = scenario.model.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) throw new RangeError(`Segment “${segmentId}” is missing from the scenario.`);
  return segment;
}

function tierAccountValueForSegment(
  scenario: Scenario,
  segment: ScenarioSegment,
  tier: Scenario["designs"][number]["tiers"][number],
) {
  const perFeatureValue = Object.fromEntries(
    scenario.model.features.map((feature) => [
      feature.id,
      segment.wtpBand.p50 * segment.featureAllocation[feature.id],
    ]),
  );
  return tier.featureIds.reduce((total, featureId) => total + (perFeatureValue[featureId] ?? 0), 0);
}

/**
 * Builds the pure-engine positioning input for one segment. The tier value is
 * the sum of the segment's account-level per-feature values for included
 * features — the same calculation the envelope engine uses in §4.2.
 */
export function positioningMapForSegment(
  scenario: Scenario,
  segmentId: string,
): PositioningMap | null {
  if (scenario.model.segments.length === 0) return null;
  const segment = scenarioSegment(scenario, segmentId);
  const design = activeDesign(scenario);

  const competitors: readonly CompetitorDefinition[] = scenario.competitors.map((competitor) => ({
    id: competitor.id,
    name: competitor.name,
    price: competitor.price,
    priceMetric: competitor.priceMetric,
    value: competitor.valueBySegment[segment.id] ?? 0,
  }));

  return buildPositioningMap({
    segmentId: segment.id,
    seatCount: segment.seatCount,
    sigma: segment.withinSegmentSigma,
    competitors,
    tiers: design.tiers.map((tier) => ({
      id: tier.id,
      name: tier.name,
      price: tier.price,
      priceMetric: tier.priceMetric,
      value: tierAccountValueForSegment(scenario, segment, tier),
    })),
  });
}
