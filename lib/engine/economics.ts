import { selectOffers } from "./envelope";
import { expandOffers } from "./offers";
import { lognormalPartialExpectation, scaleDistribution } from "./stats";
import type {
  EconomicsInput,
  EconomicsReadout,
  ExpandedOffer,
  PriceSweepPoint,
  PriceSweepSegmentInput,
  RemoveOfferCounterfactual,
  SegmentEconomicsInput,
  SegmentEconomicsReadout,
  TierDefinition,
  TierPriceSweep,
  TierPriceSweepInput,
} from "./types";

const BASE_SWEEP_POINT_COUNT = 400;
const MAX_SWEEP_EXPANSIONS = 8;

function assertFiniteNonNegative(value: number, label: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${label} must be a finite, non-negative number.`);
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function intervalScaleMoment(lower: number, upper: number, share: number, sigma: number): number {
  // With a point-mass distribution the direct selector decides all ties. Its
  // selected interval may begin at exactly ε = 1, whereas the mathematical
  // interval notation is open on the left. The selected share is therefore
  // the reliable indicator for the σ = 0 branch.
  if (sigma === 0) return share;
  if (upper <= 0) return 0;
  const clippedLower = Math.max(0, lower);
  if (upper <= clippedLower) return 0;
  return lognormalPartialExpectation(clippedLower, upper, scaleDistribution(sigma));
}

function validateSegment(input: SegmentEconomicsInput): void {
  if (!input.id) throw new RangeError("Every economics segment needs a non-empty ID.");
  assertFiniteNonNegative(input.prospectCount, `Segment “${input.id}” prospect count`);
  assertFiniteNonNegative(input.fullCatalogValue, `Segment “${input.id}” full catalog value`);
  assertFiniteNonNegative(input.sigma, `Segment “${input.id}” sigma`);
}

/**
 * Computes a segment's five-term value waterfall from one already-expanded
 * offer menu. It deliberately treats competitor utility as a loss of the
 * own-catalog potential, never as own buyer surplus.
 */
export function simulateSegmentEconomics(input: SegmentEconomicsInput): SegmentEconomicsReadout {
  validateSegment(input);
  const selection = selectOffers(input.offers, input.sigma, input.selectionOptions);
  const distribution = scaleDistribution(input.sigma);
  let revenue = 0;
  let ownBuyerSurplus = 0;
  let fencingGap = 0;
  let unserved = 0;
  let competitorLoss = 0;
  let ownPaidBuyers = 0;
  let ownBuyers = 0;
  let competitorBuyers = 0;

  const selectedPointOffer =
    input.sigma === 0
      ? selection.offers.find((offer) => offer.id === selection.selectedAtMedianId)
      : undefined;
  const selectedIntervals = selectedPointOffer
    ? [{ offer: selectedPointOffer, share: 1, moment: 1 }]
    : selection.active
        .filter((interval) => interval.share !== 0)
        .map((interval) => ({
          offer: interval.offer,
          share: interval.share,
          moment: intervalScaleMoment(interval.lower, interval.upper, interval.share, input.sigma),
        }));

  for (const interval of selectedIntervals) {
    const { offer, moment } = interval;
    const buyers = input.prospectCount * interval.share;

    if (offer.owner === "own") {
      revenue += buyers * offer.effectivePrice;
      ownBuyerSurplus +=
        input.prospectCount * (offer.value * moment - offer.effectivePrice * interval.share);
      fencingGap += input.prospectCount * (input.fullCatalogValue - offer.value) * moment;
      ownBuyers += buyers;
      if (offer.effectivePrice > 0) ownPaidBuyers += buyers;
    } else if (offer.owner === "outside") {
      unserved += input.prospectCount * input.fullCatalogValue * moment;
    } else {
      competitorLoss += input.prospectCount * input.fullCatalogValue * moment;
      competitorBuyers += buyers;
    }
  }

  const potential =
    input.prospectCount * lognormalPartialExpectation(0, Number.POSITIVE_INFINITY, distribution);
  const catalogPotential = potential * input.fullCatalogValue;
  const conservationResidual =
    catalogPotential - (revenue + ownBuyerSurplus + fencingGap + unserved + competitorLoss);

  return {
    id: input.id,
    prospectCount: input.prospectCount,
    fullCatalogValue: input.fullCatalogValue,
    sigma: input.sigma,
    selection,
    revenue,
    ownBuyerSurplus,
    fencingGap,
    unserved,
    competitorLoss,
    potential: catalogPotential,
    conservationResidual,
    ownPaidBuyers,
    ownBuyers,
    competitorBuyers,
  };
}

/** Computes scenario-level KPIs by aggregating independently simulated segments. */
export function simulateEconomics(input: EconomicsInput): EconomicsReadout {
  if (input.segments.length === 0) {
    throw new RangeError("Economics simulation requires at least one segment.");
  }
  const segments = input.segments.map(simulateSegmentEconomics);
  const revenue = sum(segments.map((segment) => segment.revenue));
  const ownBuyerSurplus = sum(segments.map((segment) => segment.ownBuyerSurplus));
  const fencingGap = sum(segments.map((segment) => segment.fencingGap));
  const unserved = sum(segments.map((segment) => segment.unserved));
  const competitorLoss = sum(segments.map((segment) => segment.competitorLoss));
  const potential = sum(segments.map((segment) => segment.potential));
  const totalProspects = sum(segments.map((segment) => segment.prospectCount));
  const paidBuyers = sum(segments.map((segment) => segment.ownPaidBuyers));
  const ownBuyers = sum(segments.map((segment) => segment.ownBuyers));
  const competitorBuyers = sum(segments.map((segment) => segment.competitorBuyers));
  const hasCompetitors = segments.some((segment) =>
    segment.selection.offers.some((offer) => offer.owner === "competitor"),
  );

  return {
    segments,
    mrr: revenue,
    revenue,
    ownBuyerSurplus,
    fencingGap,
    unserved,
    competitorLoss,
    potential,
    conservationResidual:
      potential - (revenue + ownBuyerSurplus + fencingGap + unserved + competitorLoss),
    totalProspects,
    paidBuyers,
    ownBuyers,
    competitorBuyers,
    paidConversion: totalProspects === 0 ? 0 : paidBuyers / totalProspects,
    arpa: paidBuyers === 0 ? 0 : revenue / paidBuyers,
    captureRate: potential === 0 ? 0 : revenue / potential,
    ...(hasCompetitors
      ? { competitorLossShare: potential === 0 ? 0 : competitorLoss / potential }
      : {}),
  };
}

/** Re-simulates a menu without one offer and reports both useful MRR directions. */
export function removeOfferCounterfactual(
  input: EconomicsInput,
  offerId: string,
): RemoveOfferCounterfactual {
  if (!offerId || offerId === "outside") {
    throw new RangeError("Counterfactual removal requires a non-outside offer ID.");
  }
  const baseline = simulateEconomics(input);
  const withoutOffer = simulateEconomics({
    segments: input.segments.map((segment) => ({
      ...segment,
      offers: segment.offers.filter((offer) => offer.id !== offerId),
    })),
  });
  const mrrChangeWhenRemoved = withoutOffer.mrr - baseline.mrr;
  return {
    offerId,
    baseline,
    withoutOffer,
    mrrChangeWhenRemoved,
    removedOfferContribution: -mrrChangeWhenRemoved,
  };
}

function catalogValue(input: PriceSweepSegmentInput): number {
  const derived = sum(Object.values(input.offerExpansion.featureValues));
  const value = input.fullCatalogValue ?? derived;
  assertFiniteNonNegative(value, `Segment “${input.id}” full catalog value`);
  return value;
}

function tierForSweep(input: TierPriceSweepInput): TierDefinition {
  if (input.segments.length === 0) {
    throw new RangeError("A price sweep requires at least one segment.");
  }
  let sourceTier: TierDefinition | undefined;
  for (const segment of input.segments) {
    const tier = segment.offerExpansion.tiers.find((candidate) => candidate.id === input.tierId);
    if (!tier) {
      throw new RangeError(`Tier “${input.tierId}” is missing from segment “${segment.id}”.`);
    }
    if (
      sourceTier &&
      (sourceTier.price !== tier.price || sourceTier.priceMetric !== tier.priceMetric)
    ) {
      throw new RangeError(
        `Tier “${input.tierId}” must have the same list price and metric in every sweep segment.`,
      );
    }
    sourceTier = tier;
  }
  if (!sourceTier) {
    throw new RangeError(`Tier “${input.tierId}” could not be resolved for this sweep.`);
  }
  return sourceTier;
}

function replaceTierPrice(
  segment: PriceSweepSegmentInput,
  tierId: string,
  price: number,
): readonly ExpandedOffer[] {
  return expandOffers({
    ...segment.offerExpansion,
    tiers: segment.offerExpansion.tiers.map((tier) =>
      tier.id === tierId ? { ...tier, price } : tier,
    ),
  });
}

function scenarioAtTierPrice(input: TierPriceSweepInput, price: number): EconomicsReadout {
  return simulateEconomics({
    segments: input.segments.map((segment) => ({
      id: segment.id,
      prospectCount: segment.prospectCount,
      fullCatalogValue: catalogValue(segment),
      sigma: segment.sigma,
      offers: replaceTierPrice(segment, input.tierId, price),
      selectionOptions: segment.selectionOptions,
    })),
  });
}

function tierReadoutAtPrice(input: TierPriceSweepInput, price: number): PriceSweepPoint {
  const simulation = scenarioAtTierPrice(input, price);
  let demand = 0;
  let revenue = 0;

  for (const segment of simulation.segments) {
    for (const offer of segment.selection.offers) {
      if (offer.owner !== "own" || offer.tierId !== input.tierId) continue;
      const share = segment.selection.shares[offer.id] ?? 0;
      demand += segment.prospectCount * share;
      revenue += segment.prospectCount * share * offer.effectivePrice;
    }
  }
  return { price, demand, revenue, totalMrr: simulation.mrr };
}

function baseGrid(upperBound: number, currentPrice: number): number[] {
  if (upperBound === 0) return [0];
  const prices = Array.from(
    { length: BASE_SWEEP_POINT_COUNT },
    (_, index) => (upperBound * index) / (BASE_SWEEP_POINT_COUNT - 1),
  );
  prices.push(currentPrice);
  return [...new Set(prices)].sort((left, right) => left - right);
}

function bestSweepPoint(points: readonly PriceSweepPoint[]): PriceSweepPoint {
  return points.reduce((best, point) => (point.revenue > best.revenue ? point : best));
}

function requiresExpansion(
  points: readonly PriceSweepPoint[],
  bestPoint: PriceSweepPoint,
  upperBound: number,
): boolean {
  if (upperBound === 0 || points.length < 2) return false;
  const upperPoint = points.find((point) => point.price === upperBound);
  const nextToUpper = points[points.length - 2];
  const risesAtBoundary =
    upperPoint !== undefined &&
    nextToUpper !== undefined &&
    upperPoint.revenue > nextToUpper.revenue;
  const bestInTopFivePercent = bestPoint.price >= upperBound * 0.95;
  return risesAtBoundary || bestInTopFivePercent;
}

/**
 * Sweeps a tier's list-price units while holding the rest of the menu fixed.
 * Each point re-expands the tier, so add-on composites move by the same price
 * change and demand/revenue include those composites.
 */
export function sweepTierPrice(input: TierPriceSweepInput): TierPriceSweep {
  if (!input.tierId) throw new RangeError("A price sweep requires a non-empty tier ID.");
  const tier = tierForSweep(input);
  const fullValueBound = Math.max(
    ...input.segments.map((segment) => {
      const value = catalogValue(segment);
      if (tier.priceMetric === "flat") return value;
      if (!(
        Number.isFinite(segment.offerExpansion.seatCount) && segment.offerExpansion.seatCount > 0
      )) {
        throw new RangeError(`Per-seat sweep segment “${segment.id}” must have at least one seat.`);
      }
      return value / segment.offerExpansion.seatCount;
    }),
  );
  let upperBound = Math.max(tier.price, 1.5 * fullValueBound);
  let expansionCount = 0;
  let points: PriceSweepPoint[] = [];
  let bestPoint: PriceSweepPoint | undefined;
  let needsExpansion = false;

  do {
    points = baseGrid(upperBound, tier.price).map((price) => tierReadoutAtPrice(input, price));
    bestPoint = bestSweepPoint(points);
    needsExpansion = requiresExpansion(points, bestPoint, upperBound);
    if (!needsExpansion || expansionCount === MAX_SWEEP_EXPANSIONS) break;
    upperBound *= 2;
    expansionCount += 1;
  } while (true);

  return {
    tierId: input.tierId,
    priceMetric: tier.priceMetric,
    currentPrice: tier.price,
    points,
    bestPoint,
    searchedUpperBound: upperBound,
    expansionCount,
    bestInSearchedRange: needsExpansion && expansionCount === MAX_SWEEP_EXPANSIONS,
  };
}
