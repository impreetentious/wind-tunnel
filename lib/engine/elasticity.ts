import { selectOffers } from "./envelope";
import { lognormalPdf, scaleDistribution } from "./stats";
import type { ExpandedOffer, OfferSelection, SelectOffersOptions } from "./types";

export interface OfferElasticity {
  offerId: string;
  effectiveValue: number;
  effectivePrice: number;
  share: number;
  /** ∂share_k / ∂P_k (always ≤ 0); undefined for σ = 0 boundaries. */
  ownShareDerivative: number;
  /** (P_k / share_k) · ∂share_k / ∂P_k; undefined when share = 0 or price = 0. */
  ownPriceDemandElasticity: number | undefined;
  /** 1 + own-price demand elasticity; the sign tells whether a small price rise raises revenue. */
  ownPriceRevenueElasticity: number | undefined;
}

export interface SubstitutionEntry {
  /** The offer whose price is perturbed. */
  fromOfferId: string;
  /** The offer whose share responds. */
  toOfferId: string;
  /** ∂share_to / ∂P_from at the current menu (positive means to gains when from raises price). */
  shareDerivative: number;
  /** (P_from / share_to) · ∂share_to / ∂P_from; undefined at zero-share or zero-price receivers. */
  crossPriceDemandElasticity: number | undefined;
}

export interface SegmentElasticityReadout {
  segmentId: string;
  sigma: number;
  /** The active-offer selection this readout was derived from. */
  selection: OfferSelection;
  activeOfferElasticities: readonly OfferElasticity[];
  substitution: readonly SubstitutionEntry[];
  /** True at σ = 0: point-mass demand makes local derivatives Dirac. */
  degenerate: boolean;
  /**
   * These derivatives are valid only while the current envelope structure
   * holds. A price change large enough to move an offer on or off the envelope
   * changes the regime and invalidates them.
   */
  regimeLocal: true;
}

export interface SegmentElasticityInput {
  segmentId: string;
  sigma: number;
  offers: readonly ExpandedOffer[];
  selectionOptions?: SelectOffersOptions;
}

const STANDARD = { mu: 0 };

function assertFiniteNonNegative(value: number, label: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${label} must be a finite, non-negative number.`);
  }
}

/**
 * Analytic own- and cross-price derivatives of the §4.2 envelope shares in
 * one segment. The active offers are ordered by ascending effective value on
 * the envelope; only immediately-adjacent envelope neighbors can respond to a
 * given price change, so the substitution matrix is tridiagonal in that order.
 *
 * At σ = 0 the segment collapses to a point mass and the local derivatives are
 * Dirac; the readout is returned with `degenerate: true`, elasticity fields
 * absent, and an empty substitution matrix. Use price sweeps (§4.4) for the
 * finite-difference view a σ = 0 segment supports.
 */
export function computeSegmentElasticity(input: SegmentElasticityInput): SegmentElasticityReadout {
  if (!input.segmentId) throw new RangeError("Segment ID must be non-empty.");
  assertFiniteNonNegative(input.sigma, `Segment “${input.segmentId}” sigma`);

  const selection = selectOffers(input.offers, input.sigma, input.selectionOptions);

  if (input.sigma === 0) {
    return {
      segmentId: input.segmentId,
      sigma: 0,
      selection,
      activeOfferElasticities: [],
      substitution: [],
      degenerate: true,
      regimeLocal: true,
    };
  }

  const distribution = { ...STANDARD, ...scaleDistribution(input.sigma) };
  const active = selection.active.filter((interval) => interval.upper > interval.lower);

  const activeOfferElasticities: OfferElasticity[] = [];
  const substitution: SubstitutionEntry[] = [];

  for (let index = 0; index < active.length; index += 1) {
    const current = active[index];
    // The outside option has no perturbable price, so it is excluded from the
    // "perturbed offer" role. It stays a legitimate receiver of the neighboring
    // paid offer's price change, captured from that neighbor's iteration.
    if (current.offer.owner === "outside") continue;
    const previous = active[index - 1];
    const next = active[index + 1];

    // g(x) = d/dx Φ(ln(x)/σ) is the lognormal density with (μ=0, σ) at x.
    // At ε = 0 or ε = +∞ the density is 0, which correctly zeros the boundary term.
    const lowerDensity =
      current.lower > 0 && Number.isFinite(current.lower)
        ? lognormalPdf(current.lower, distribution)
        : 0;
    const upperDensity =
      current.upper > 0 && Number.isFinite(current.upper)
        ? lognormalPdf(current.upper, distribution)
        : 0;

    const lowerGapValue = previous
      ? current.offer.value - previous.offer.value
      : current.offer.value;
    const upperGapValue = next ? next.offer.value - current.offer.value : 0;

    // ∂a_k / ∂P_k = 1 / (V_k − V_{k-1})   (own contribution to lower breakpoint)
    // ∂b_k / ∂P_k = −1 / (V_{k+1} − V_k)  (own contribution to upper breakpoint)
    // For the top active offer, b_k = +∞ and its upperDensity is 0; the −∞ gap
    // is guarded by that factor rather than dividing by zero. Same for the
    // outside → lowest paid transition where lowerGapValue = V_k − 0.
    const ownLowerTerm = lowerGapValue > 0 ? lowerDensity / lowerGapValue : 0;
    const ownUpperTerm = upperGapValue > 0 ? upperDensity / upperGapValue : 0;
    const ownShareDerivative = -ownLowerTerm - ownUpperTerm;

    const share = current.share;
    const price = current.offer.effectivePrice;
    const shareIsPositive = share > 0;
    const priceIsPositive = price > 0;

    const ownPriceDemandElasticity =
      shareIsPositive && priceIsPositive ? (price / share) * ownShareDerivative : undefined;
    const ownPriceRevenueElasticity =
      ownPriceDemandElasticity === undefined ? undefined : 1 + ownPriceDemandElasticity;

    activeOfferElasticities.push({
      offerId: current.offer.id,
      effectiveValue: current.offer.value,
      effectivePrice: current.offer.effectivePrice,
      share,
      ownShareDerivative,
      ownPriceDemandElasticity,
      ownPriceRevenueElasticity,
    });

    // Cross-price entries in the tridiagonal structure of §4.13. The price of
    // offer k perturbs share_{k-1} through the (k-1,k) breakpoint and share_{k+1}
    // through the (k,k+1) breakpoint; both flow away from k with the same
    // absolute magnitudes that own-price gains.
    if (previous && lowerGapValue > 0) {
      const derivative = lowerDensity / lowerGapValue;
      const receiverShare = previous.share;
      substitution.push({
        fromOfferId: current.offer.id,
        toOfferId: previous.offer.id,
        shareDerivative: derivative,
        crossPriceDemandElasticity:
          receiverShare > 0 && priceIsPositive ? (price / receiverShare) * derivative : undefined,
      });
    }
    if (next && upperGapValue > 0) {
      const derivative = upperDensity / upperGapValue;
      const receiverShare = next.share;
      substitution.push({
        fromOfferId: current.offer.id,
        toOfferId: next.offer.id,
        shareDerivative: derivative,
        crossPriceDemandElasticity:
          receiverShare > 0 && priceIsPositive ? (price / receiverShare) * derivative : undefined,
      });
    }
  }

  return {
    segmentId: input.segmentId,
    sigma: input.sigma,
    selection,
    activeOfferElasticities,
    substitution,
    degenerate: false,
    regimeLocal: true,
  };
}
