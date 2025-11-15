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

export interface OfferExpansionInput {
  seatCount: number;
  featureValues: Readonly<Record<string, number>>;
  tiers: readonly TierDefinition[];
  addOns?: readonly AddOnDefinition[];
  competitors?: readonly CompetitorDefinition[];
  includeCompetitors?: boolean;
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
