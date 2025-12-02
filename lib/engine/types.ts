/** Shared, UI-independent contracts for the deterministic pricing engine. */

export const TIE_TOLERANCE = 1e-9;

export type PriceMetric = "flat" | "per-seat";
export type OfferOwner = "outside" | "own" | "competitor";
export type OfferKind = "outside" | "tier" | "tier-add-on" | "competitor";

export interface TierDefinition {
  id: string;
  name: string;
  price: number;
  priceMetric: PriceMetric;
  featureIds: readonly string[];
}

export interface AddOnDefinition {
  id: string;
  name: string;
  price: number;
  priceMetric: PriceMetric;
  featureIds: readonly string[];
}

/** A competitor is already valued for the segment being simulated. */
export interface CompetitorDefinition {
  id: string;
  name: string;
  price: number;
  priceMetric: PriceMetric;
  value: number;
}

/**
 * A non-additive value adjustment for an unordered feature pair (§4.1.1). The
 * `value` is an account-level increment applied once when BOTH features are
 * present in an offer's feature set: positive for complements (the pair is
 * worth more than the sum of its parts), negative for substitutes. It never
 * applies to an offer that contains only one of the two features.
 */
export interface FeatureInteraction {
  featureIds: readonly [string, string];
  value: number;
}

export interface OfferExpansionInput {
  seatCount: number;
  featureValues: Readonly<Record<string, number>>;
  tiers: readonly TierDefinition[];
  addOns?: readonly AddOnDefinition[];
  competitors?: readonly CompetitorDefinition[];
  includeCompetitors?: boolean;
  /** Optional complement/substitute adjustments; additive model when omitted. */
  interactions?: readonly FeatureInteraction[];
}

/**
 * A single alternative expressed in account-level value and price for one
 * segment. These are the lines used by the utility upper envelope.
 */
export interface ExpandedOffer {
  id: string;
  name: string;
  owner: OfferOwner;
  kind: OfferKind;
  value: number;
  effectivePrice: number;
  featureIds: readonly string[];
  tierId?: string;
  addOnIds?: readonly string[];
  competitorId?: string;
}

export type TieMode = "conservative" | "seller-favorable";

export interface SelectOffersOptions {
  tieMode?: TieMode;
  tieTolerance?: number;
}

export interface EnvelopeInterval {
  offer: ExpandedOffer;
  /** The interval is (lower, upper] in the buyer's scale factor ε. */
  lower: number;
  upper: number;
  share: number;
}

export interface OfferSelection {
  offers: readonly ExpandedOffer[];
  active: readonly EnvelopeInterval[];
  shares: Readonly<Record<string, number>>;
  selectedAtMedianId?: string;
  tieMode: TieMode;
}

/** Inputs needed to calculate economics for one independently valued segment. */
export interface SegmentEconomicsInput {
  id: string;
  prospectCount: number;
  /** Account-level value of the complete own feature catalog. */
  fullCatalogValue: number;
  sigma: number;
  offers: readonly ExpandedOffer[];
  selectionOptions?: SelectOffersOptions;
}

export interface SegmentEconomicsReadout {
  id: string;
  prospectCount: number;
  fullCatalogValue: number;
  sigma: number;
  selection: OfferSelection;
  revenue: number;
  ownBuyerSurplus: number;
  fencingGap: number;
  unserved: number;
  competitorLoss: number;
  potential: number;
  /** Potential minus the five waterfall terms; near zero within binary64 error. */
  conservationResidual: number;
  ownPaidBuyers: number;
  ownBuyers: number;
  competitorBuyers: number;
}

export interface EconomicsInput {
  segments: readonly SegmentEconomicsInput[];
}

export interface EconomicsReadout {
  segments: readonly SegmentEconomicsReadout[];
  mrr: number;
  revenue: number;
  ownBuyerSurplus: number;
  fencingGap: number;
  unserved: number;
  competitorLoss: number;
  potential: number;
  conservationResidual: number;
  totalProspects: number;
  paidBuyers: number;
  ownBuyers: number;
  competitorBuyers: number;
  paidConversion: number;
  arpa: number;
  captureRate: number;
  /** Undefined until the scenario includes at least one competitor alternative. */
  competitorLossShare?: number;
}

export interface RemoveOfferCounterfactual {
  offerId: string;
  baseline: EconomicsReadout;
  withoutOffer: EconomicsReadout;
  /** Counterfactual MRR minus baseline MRR after the offer is removed. */
  mrrChangeWhenRemoved: number;
  /** Baseline MRR minus counterfactual MRR; positive means the offer contributed revenue. */
  removedOfferContribution: number;
}

/** A segment's menu source for a tier price sweep. */
export interface PriceSweepSegmentInput {
  id: string;
  prospectCount: number;
  sigma: number;
  offerExpansion: OfferExpansionInput;
  /** Defaults to the sum of the segment's catalog feature values. */
  fullCatalogValue?: number;
  selectionOptions?: SelectOffersOptions;
}

export interface TierPriceSweepInput {
  tierId: string;
  segments: readonly PriceSweepSegmentInput[];
}

export interface PriceSweepPoint {
  /** Tier list-price units: account-month for flat, seat-month for per-seat. */
  price: number;
  /** Buyers selecting the swept tier or one of its add-on composites. */
  demand: number;
  /** Revenue from the swept tier and its add-on composites. */
  revenue: number;
  /** Total scenario MRR at this price, including the rest of the menu. */
  totalMrr: number;
}

export interface TierPriceSweep {
  tierId: string;
  priceMetric: PriceMetric;
  currentPrice: number;
  points: readonly PriceSweepPoint[];
  bestPoint: PriceSweepPoint;
  searchedUpperBound: number;
  expansionCount: number;
  /** True when the expansion cap left the best result at the search boundary. */
  bestInSearchedRange: boolean;
}

/** One P10/P50/P90 assumption band sampled by the uncertainty engine. */
export interface MonteCarloBand {
  p10: number;
  p50: number;
  p90: number;
}

export interface MonteCarloParameter {
  id: string;
  label: string;
  band: MonteCarloBand;
}

export interface MonteCarloDesign {
  id: string;
  label: string;
}

/** A deterministic random-number generator injected into the pure engine. */
export type SeededRandom = () => number;
export type SeededRandomFactory = (seed: number) => SeededRandom;

/**
 * The state layer provides this bridge so Monte Carlo remains independent of
 * persisted scenario data while still evaluating the closed-form simulator.
 */
export type MonteCarloEvaluator = (
  designId: string,
  parameterValues: Readonly<Record<string, number>>,
) => number;

export interface MonteCarloInput {
  seed: number;
  drawCount: number;
  parameters: readonly MonteCarloParameter[];
  designs: readonly MonteCarloDesign[];
  /** The design used for one-at-a-time tornado sensitivity analysis. */
  referenceDesignId: string;
  evaluate: MonteCarloEvaluator;
  randomFactory?: SeededRandomFactory;
}

export interface MonteCarloDraw {
  index: number;
  parameterValues: Readonly<Record<string, number>>;
  mrrByDesign: Readonly<Record<string, number>>;
}

export interface MonteCarloPercentiles {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
}

export interface MonteCarloDistribution {
  designId: string;
  label: string;
  mrr: readonly number[];
  percentiles: MonteCarloPercentiles;
}

export interface MonteCarloComparison {
  referenceDesignId: string;
  challengerDesignId: string;
  referenceWins: number;
  challengerWins: number;
  ties: number;
  /** Challenger wins divided by all paired draws; ties are not wins. */
  challengerWinRate: number;
}

export interface MonteCarloTornadoDriver {
  parameterId: string;
  label: string;
  baseMrr: number;
  lowMrr: number;
  highMrr: number;
  lowDelta: number;
  highDelta: number;
  /** The bar sort key: max(|low delta|, |high delta|). */
  maximumAbsoluteDelta: number;
}

export interface MonteCarloResult {
  seed: number;
  drawCount: number;
  draws: readonly MonteCarloDraw[];
  distributions: readonly MonteCarloDistribution[];
  comparisons: readonly MonteCarloComparison[];
  tornado: readonly MonteCarloTornadoDriver[];
}
