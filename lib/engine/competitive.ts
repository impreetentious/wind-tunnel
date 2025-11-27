import { lognormalQuantile, scaleDistribution } from "./stats";
import type { CompetitorDefinition, PriceMetric } from "./types";

/**
 * A competitor as it enters the positioning map for one specific segment. The
 * effective price is already normalized to the segment's account-month unit so
 * the map and the envelope engine (§4.2) consume the same numbers.
 */
export interface CompetitorPoint {
  id: string;
  name: string;
  value: number;
  effectivePrice: number;
}

export interface PositioningTierPoint {
  id: string;
  name: string;
  value: number;
  effectivePrice: number;
}

export type DominanceVerdict = "directly-dominated" | "not-directly-dominated";

export interface DirectDominanceReadout {
  tierId: string;
  verdict: DominanceVerdict;
  /** Populated only when a competitor directly dominates the tier. */
  dominatingCompetitorId?: string;
}

export interface BreakEvenRay {
  label: "p10" | "p50" | "p90";
  /** Slope in price/value units — the buyer's ε for this quantile. */
  slope: number;
}

export interface PositioningMap {
  segmentId: string;
  sigma: number;
  frontier: readonly CompetitorPoint[];
  tiers: readonly PositioningTierPoint[];
  rays: readonly BreakEvenRay[];
  dominance: readonly DirectDominanceReadout[];
}

export interface PositioningTierInput {
  id: string;
  name: string;
  price: number;
  priceMetric: PriceMetric;
  /** Account-level value of the tier's included features for this segment. */
  value: number;
}

export interface PositioningInput {
  segmentId: string;
  seatCount: number;
  sigma: number;
  competitors: readonly CompetitorDefinition[];
  tiers: readonly PositioningTierInput[];
}

function assertValidCompetitor(competitor: CompetitorDefinition): void {
  if (!competitor.id) throw new RangeError("Every competitor needs a non-empty ID.");
  if (!competitor.name) throw new RangeError(`Competitor “${competitor.id}” needs a name.`);
  if (!(Number.isFinite(competitor.value) && competitor.value >= 0)) {
    throw new RangeError(`Competitor “${competitor.id}” value must be finite and non-negative.`);
  }
  if (!(Number.isFinite(competitor.price) && competitor.price >= 0)) {
    throw new RangeError(`Competitor “${competitor.id}” price must be finite and non-negative.`);
  }
}

function effectiveAccountPrice(price: number, metric: PriceMetric, seatCount: number): number {
  return metric === "per-seat" ? price * seatCount : price;
}

function competitorAccountPoint(
  competitor: CompetitorDefinition,
  seatCount: number,
): CompetitorPoint {
  assertValidCompetitor(competitor);
  return {
    id: competitor.id,
    name: competitor.name,
    value: competitor.value,
    effectivePrice: effectiveAccountPrice(competitor.price, competitor.priceMetric, seatCount),
  };
}

/**
 * Discrete Pareto min-price-at-value staircase (D-21). Competitors are not
 * mixable, so the frontier is a set of survivors — never an interpolated hull.
 */
export function paretoFrontier(points: readonly CompetitorPoint[]): CompetitorPoint[] {
  // Deduplicate exact (value, price) doubles so a repeated competitor cannot
  // appear twice on the frontier.
  const uniqueByCoordinate = new Map<string, CompetitorPoint>();
  for (const point of points) {
    const key = `${point.value.toFixed(12)}|${point.effectivePrice.toFixed(12)}`;
    if (!uniqueByCoordinate.has(key)) uniqueByCoordinate.set(key, point);
  }
  const survivors: CompetitorPoint[] = [];
  for (const candidate of uniqueByCoordinate.values()) {
    const dominated = [...uniqueByCoordinate.values()].some(
      (other) =>
        other !== candidate &&
        other.value >= candidate.value &&
        other.effectivePrice <= candidate.effectivePrice &&
        (other.value > candidate.value || other.effectivePrice < candidate.effectivePrice),
    );
    if (!dominated) survivors.push(candidate);
  }
  return survivors.sort(
    (left, right) =>
      left.value - right.value ||
      left.effectivePrice - right.effectivePrice ||
      left.id.localeCompare(right.id),
  );
}

/**
 * Break-even rays for the selected segment. A ray has slope ε — the buyer's
 * scale factor at that quantile of the within-segment lognormal — so a
 * buyer with ε ≥ slope prefers a strictly higher-value alternative at that
 * price.
 */
export function breakEvenRays(sigma: number): BreakEvenRay[] {
  if (!(Number.isFinite(sigma) && sigma >= 0)) {
    throw new RangeError("Segment sigma must be finite and non-negative.");
  }
  if (sigma === 0) {
    return [
      { label: "p10", slope: 1 },
      { label: "p50", slope: 1 },
      { label: "p90", slope: 1 },
    ];
  }
  const distribution = scaleDistribution(sigma);
  return [
    { label: "p10", slope: lognormalQuantile(0.1, distribution) },
    { label: "p50", slope: lognormalQuantile(0.5, distribution) },
    { label: "p90", slope: lognormalQuantile(0.9, distribution) },
  ];
}

/**
 * A tier is directly dominated only when a competitor is at least as good on
 * value AND at least as cheap, with a strict advantage on one axis (D-21).
 * There is no interpolation across the frontier.
 */
export function directDominanceVerdict(
  tier: PositioningTierPoint,
  competitors: readonly CompetitorPoint[],
): DirectDominanceReadout {
  for (const competitor of competitors) {
    const notWorseOnValue = competitor.value >= tier.value;
    const notWorseOnPrice = competitor.effectivePrice <= tier.effectivePrice;
    const strictlyBetterOnOne =
      competitor.value > tier.value || competitor.effectivePrice < tier.effectivePrice;
    if (notWorseOnValue && notWorseOnPrice && strictlyBetterOnOne) {
      return {
        tierId: tier.id,
        verdict: "directly-dominated",
        dominatingCompetitorId: competitor.id,
      };
    }
  }
  return { tierId: tier.id, verdict: "not-directly-dominated" };
}

/**
 * Builds the segment-scoped positioning map: Pareto competitor points, tier
 * points at the same account-month unit, break-even rays for that segment's ε,
 * and per-tier direct-dominance verdicts.
 */
export function buildPositioningMap(input: PositioningInput): PositioningMap {
  if (!input.segmentId) throw new RangeError("A positioning map requires a segment ID.");
  if (!(Number.isFinite(input.seatCount) && input.seatCount >= 1)) {
    throw new RangeError("Segment seat count must be at least 1.");
  }

  const tiers = input.tiers.map<PositioningTierPoint>((tier) => ({
    id: tier.id,
    name: tier.name,
    value: tier.value,
    effectivePrice: effectiveAccountPrice(tier.price, tier.priceMetric, input.seatCount),
  }));
  const competitorPoints = input.competitors.map((competitor) =>
    competitorAccountPoint(competitor, input.seatCount),
  );
  const frontier = paretoFrontier(competitorPoints);
  const dominance = tiers.map((tier) => directDominanceVerdict(tier, frontier));

  return {
    segmentId: input.segmentId,
    sigma: input.sigma,
    frontier,
    tiers,
    rays: breakEvenRays(input.sigma),
    dominance,
  };
}
