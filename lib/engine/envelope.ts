import { lognormalCdf, scaleDistribution } from "./stats";
import {
  TIE_TOLERANCE,
  type EnvelopeInterval,
  type ExpandedOffer,
  type OfferSelection,
  type SelectOffersOptions,
  type TieMode,
} from "./types";

interface ActiveLine {
  offer: ExpandedOffer;
  entry: number;
}

function assertValidOffer(offer: ExpandedOffer): void {
  if (!offer.id) throw new RangeError("Every offer needs a non-empty ID.");
  if (!(Number.isFinite(offer.value) && offer.value >= 0)) {
    throw new RangeError(`Offer “${offer.id}” value must be finite and non-negative.`);
  }
  if (!(Number.isFinite(offer.effectivePrice) && offer.effectivePrice >= 0)) {
    throw new RangeError(`Offer “${offer.id}” effective price must be finite and non-negative.`);
  }
}

function outsideOption(): ExpandedOffer {
  return {
    id: "outside",
    name: "Outside option",
    owner: "outside",
    kind: "outside",
    value: 0,
    effectivePrice: 0,
    featureIds: [],
  };
}

function normalizeOffers(offers: readonly ExpandedOffer[]): ExpandedOffer[] {
  const ids = new Set<string>();
  let providedOutside: ExpandedOffer | undefined;

  for (const offer of offers) {
    assertValidOffer(offer);
    if (ids.has(offer.id))
      throw new RangeError(`Offer IDs must be unique; “${offer.id}” appears more than once.`);
    ids.add(offer.id);
    if (offer.id === "outside") {
      if (
        offer.owner !== "outside" ||
        offer.kind !== "outside" ||
        offer.value !== 0 ||
        offer.effectivePrice !== 0
      ) {
        throw new RangeError(
          "The outside offer must be owner=outside, kind=outside, value=0, price=0.",
        );
      }
      providedOutside = offer;
    }
  }

  return providedOutside ? [...offers] : [outsideOption(), ...offers];
}

function utility(offer: ExpandedOffer, scale: number): number {
  return scale * offer.value - offer.effectivePrice;
}

function resolveCoordinateTie(
  left: ExpandedOffer,
  right: ExpandedOffer,
  tieMode: TieMode,
): ExpandedOffer {
  const isOwnCompetitorTie =
    (left.owner === "own" && right.owner === "competitor") ||
    (left.owner === "competitor" && right.owner === "own");
  if (isOwnCompetitorTie) return left.owner === "competitor" ? left : right;

  const leftIsOutside = left.owner === "outside";
  const rightIsOutside = right.owner === "outside";
  if (leftIsOutside !== rightIsOutside) {
    if (tieMode === "conservative") return leftIsOutside ? left : right;
    return leftIsOutside ? right : left;
  }
  return left.id.localeCompare(right.id) <= 0 ? left : right;
}

function resolveUtilityTie(
  left: ExpandedOffer,
  right: ExpandedOffer,
  tieMode: TieMode,
  tolerance: number,
): ExpandedOffer {
  const priceDelta = left.effectivePrice - right.effectivePrice;
  if (Math.abs(priceDelta) > tolerance) {
    const wantsLowerPrice = tieMode === "conservative";
    return priceDelta < 0 === wantsLowerPrice ? left : right;
  }

  const valueDelta = left.value - right.value;
  if (Math.abs(valueDelta) > tolerance) {
    const wantsLowerValue = tieMode === "conservative";
    return valueDelta < 0 === wantsLowerValue ? left : right;
  }
  return resolveCoordinateTie(left, right, tieMode);
}

/** Resolves the specified buyer scale by direct utility maximization. */
export function selectOfferAtScale(
  offers: readonly ExpandedOffer[],
  scale: number,
  options: SelectOffersOptions = {},
): ExpandedOffer {
  if (!(Number.isFinite(scale) && scale >= 0)) {
    throw new RangeError("Buyer scale ε must be finite and non-negative.");
  }
  const tieMode = options.tieMode ?? "conservative";
  const tolerance = options.tieTolerance ?? TIE_TOLERANCE;
  if (!(Number.isFinite(tolerance) && tolerance >= 0)) {
    throw new RangeError("Tie tolerance must be finite and non-negative.");
  }

  return normalizeOffers(offers).reduce((winner, candidate) => {
    const utilityDelta = utility(candidate, scale) - utility(winner, scale);
    if (utilityDelta > tolerance) return candidate;
    if (utilityDelta < -tolerance) return winner;
    return resolveUtilityTie(winner, candidate, tieMode, tolerance);
  });
}

function dedupeEqualValueOffers(
  offers: readonly ExpandedOffer[],
  tieMode: TieMode,
): ExpandedOffer[] {
  const sorted = [...offers].sort(
    (left, right) =>
      left.value - right.value ||
      left.effectivePrice - right.effectivePrice ||
      left.id.localeCompare(right.id),
  );
  const result: ExpandedOffer[] = [];

  for (let index = 0; index < sorted.length;) {
    const groupValue = sorted[index].value;
    const group: ExpandedOffer[] = [];
    while (index < sorted.length && sorted[index].value === groupValue) {
      group.push(sorted[index]);
      index += 1;
    }

    const minimumPrice = Math.min(...group.map((offer) => offer.effectivePrice));
    const cheapest = group.filter((offer) => offer.effectivePrice === minimumPrice);
    result.push(
      cheapest.reduce((winner, candidate) => resolveCoordinateTie(winner, candidate, tieMode)),
    );
  }
  return result;
}

function buildActiveLines(
  offers: readonly ExpandedOffer[],
  tieMode: TieMode,
  tolerance: number,
): ActiveLine[] {
  const uniqueByValue = dedupeEqualValueOffers(offers, tieMode);
  const active: ActiveLine[] = [];

  for (const offer of uniqueByValue) {
    let entry = Number.NEGATIVE_INFINITY;
    while (active.length > 0) {
      const previous = active[active.length - 1];
      entry =
        (offer.effectivePrice - previous.offer.effectivePrice) /
        (offer.value - previous.offer.value);
      if (entry <= previous.entry + tolerance) {
        active.pop();
      } else {
        break;
      }
    }
    if (active.length > 0) {
      const previous = active[active.length - 1];
      entry =
        (offer.effectivePrice - previous.offer.effectivePrice) /
        (offer.value - previous.offer.value);
    }
    active.push({ offer, entry });
  }
  return active;
}

function sharesForPositiveSigma(
  active: readonly ActiveLine[],
  allOffers: readonly ExpandedOffer[],
  sigma: number,
): { intervals: EnvelopeInterval[]; shares: Record<string, number> } {
  const shares = Object.fromEntries(allOffers.map((offer) => [offer.id, 0])) as Record<
    string,
    number
  >;
  const distribution = scaleDistribution(sigma);
  const intervals = active.map((line, index) => {
    const upper = active[index + 1]?.entry ?? Number.POSITIVE_INFINITY;
    const share = lognormalCdf(upper, distribution) - lognormalCdf(line.entry, distribution);
    shares[line.offer.id] = share;
    return { offer: line.offer, lower: line.entry, upper, share };
  });
  return { intervals, shares };
}

/**
 * Builds the utility upper envelope and per-offer lognormal choice shares.
 * The default mode deliberately reports the conservative simulator outcome.
 */
export function selectOffers(
  offers: readonly ExpandedOffer[],
  sigma: number,
  options: SelectOffersOptions = {},
): OfferSelection {
  if (!(Number.isFinite(sigma) && sigma >= 0)) {
    throw new RangeError("Within-segment sigma must be finite and non-negative.");
  }
  const tieMode = options.tieMode ?? "conservative";
  const tolerance = options.tieTolerance ?? TIE_TOLERANCE;
  if (!(Number.isFinite(tolerance) && tolerance >= 0)) {
    throw new RangeError("Tie tolerance must be finite and non-negative.");
  }

  const normalized = normalizeOffers(offers);
  const active = buildActiveLines(normalized, tieMode, tolerance);
  if (sigma === 0) {
    const selected = selectOfferAtScale(normalized, 1, { tieMode, tieTolerance: tolerance });
    const shares = Object.fromEntries(
      normalized.map((offer) => [offer.id, offer.id === selected.id ? 1 : 0]),
    ) as Record<string, number>;
    return {
      offers: normalized,
      active: active.map((line, index) => ({
        offer: line.offer,
        lower: line.entry,
        upper: active[index + 1]?.entry ?? Number.POSITIVE_INFINITY,
        share: shares[line.offer.id],
      })),
      shares,
      selectedAtMedianId: selected.id,
      tieMode,
    };
  }

  const { intervals, shares } = sharesForPositiveSigma(active, normalized, sigma);
  return { offers: normalized, active: intervals, shares, tieMode };
}
