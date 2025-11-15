import type {
  AddOnDefinition,
  CompetitorDefinition,
  ExpandedOffer,
  OfferExpansionInput,
  PriceMetric,
  TierDefinition,
} from "./types";

const MAX_TIERS = 5;
const MAX_ADD_ONS = 3;
const MAX_COMPETITORS = 6;

function assertFiniteNonNegative(value: number, name: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
}

function assertUniqueIds(items: readonly { id: string }[], collectionName: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id))
      throw new RangeError(`${collectionName} must have unique, non-empty IDs.`);
    ids.add(item.id);
  }
}

function effectivePrice(price: number, metric: PriceMetric, seatCount: number): number {
  assertFiniteNonNegative(price, "Offer price");
  return metric === "per-seat" ? price * seatCount : price;
}

function valueForFeatures(
  featureIds: readonly string[],
  featureValues: Readonly<Record<string, number>>,
): number {
  return featureIds.reduce((total, featureId) => {
    const value = featureValues[featureId];
    if (value === undefined) throw new RangeError(`Missing value for feature “${featureId}”.`);
    assertFiniteNonNegative(value, `Value for feature “${featureId}”`);
    return total + value;
  }, 0);
}

function uniqueFeatureIds(featureIds: readonly string[]): string[] {
  return [...new Set(featureIds)];
}

function addOnSubsets(addOns: readonly AddOnDefinition[]): AddOnDefinition[][] {
  return Array.from({ length: 1 << addOns.length }, (_, mask) =>
    addOns.filter((_, index) => (mask & (1 << index)) !== 0),
  );
}

function validateInput(input: OfferExpansionInput): void {
  assertFiniteNonNegative(input.seatCount, "Seat count");
  if (input.tiers.length > MAX_TIERS)
    throw new RangeError(`At most ${MAX_TIERS} tiers are supported.`);
  if ((input.addOns?.length ?? 0) > MAX_ADD_ONS)
    throw new RangeError(`At most ${MAX_ADD_ONS} add-ons are supported.`);
  if ((input.competitors?.length ?? 0) > MAX_COMPETITORS) {
    throw new RangeError(`At most ${MAX_COMPETITORS} competitors are supported.`);
  }
  assertUniqueIds(input.tiers, "Tiers");
  assertUniqueIds(input.addOns ?? [], "Add-ons");
  assertUniqueIds(input.competitors ?? [], "Competitors");
}

function availableAddOns(
  tier: TierDefinition,
  addOns: readonly AddOnDefinition[],
): AddOnDefinition[] {
  const tierFeatures = new Set(tier.featureIds);
  // An add-on already wholly in a tier cannot add value and must not create a
  // duplicate tier offer. Partially overlapping add-ons remain valid.
  return addOns.filter((addOn) =>
    addOn.featureIds.some((featureId) => !tierFeatures.has(featureId)),
  );
}

function ownOffers(
  input: OfferExpansionInput,
  addOns: readonly AddOnDefinition[],
): ExpandedOffer[] {
  return input.tiers.flatMap((tier) => {
    const eligibleAddOns = availableAddOns(tier, addOns);
    return addOnSubsets(eligibleAddOns).map((subset) => {
      const selectedFeatures = uniqueFeatureIds([
        ...tier.featureIds,
        ...subset.flatMap((addOn) => addOn.featureIds),
      ]);
      const addOnPrice = subset.reduce(
        (total, addOn) => total + effectivePrice(addOn.price, addOn.priceMetric, input.seatCount),
        0,
      );
      const addOnIds = subset.map((addOn) => addOn.id);
      return {
        id:
          addOnIds.length === 0
            ? `tier:${tier.id}`
            : `tier:${tier.id}+addons:${addOnIds.join(",")}`,
        name:
          addOnIds.length === 0
            ? tier.name
            : `${tier.name} + ${subset.map((addOn) => addOn.name).join(" + ")}`,
        owner: "own" as const,
        kind: addOnIds.length === 0 ? ("tier" as const) : ("tier-add-on" as const),
        value: valueForFeatures(selectedFeatures, input.featureValues),
        effectivePrice: effectivePrice(tier.price, tier.priceMetric, input.seatCount) + addOnPrice,
        featureIds: selectedFeatures,
        tierId: tier.id,
        addOnIds,
      };
    });
  });
}

function competitorOffers(
  competitors: readonly CompetitorDefinition[],
  seatCount: number,
): ExpandedOffer[] {
  return competitors.map((competitor) => {
    assertFiniteNonNegative(competitor.value, `Competitor “${competitor.name}” value`);
    return {
      id: `competitor:${competitor.id}`,
      name: competitor.name,
      owner: "competitor" as const,
      kind: "competitor" as const,
      value: competitor.value,
      effectivePrice: effectivePrice(competitor.price, competitor.priceMetric, seatCount),
      featureIds: [],
      competitorId: competitor.id,
    };
  });
}

/**
 * Expands a segment's menu into all joint tier/add-on alternatives plus its
 * outside option. Values and prices are account-level at this point.
 */
export function expandOffers(input: OfferExpansionInput): ExpandedOffer[] {
  validateInput(input);
  const expanded: ExpandedOffer[] = [
    {
      id: "outside",
      name: "Outside option",
      owner: "outside",
      kind: "outside",
      value: 0,
      effectivePrice: 0,
      featureIds: [],
    },
    ...ownOffers(input, input.addOns ?? []),
  ];

  if (input.includeCompetitors ?? true) {
    expanded.push(...competitorOffers(input.competitors ?? [], input.seatCount));
  }
  return expanded;
}
