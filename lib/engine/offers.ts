import { summarizeUsageCost, type UsageBand } from "./usage";
import type {
  AddOnDefinition,
  CompetitorDefinition,
  ExpandedOffer,
  FeatureInteraction,
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

/**
 * §4.15 usage surcharge for an offer. Delegates to `summarizeUsageCost` so
 * every consumer (tier, add-on, sweep) computes the same per-segment expected
 * cost. Returns 0 when the offer carries no usage lines, so an additive-only
 * scenario is byte-identical to the pre-extension model.
 */
function usageSurcharge(
  usagePricing: readonly import("./usage").UsagePricing[] | undefined,
  usageBands: Readonly<Record<string, UsageBand>> | undefined,
): number {
  if (!usagePricing || usagePricing.length === 0) return 0;
  return summarizeUsageCost({ usagePricing, usageBands: usageBands ?? {} });
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

/**
 * Sum of non-additive pair adjustments (§4.1.1) active for a feature set. An
 * interaction contributes only when both of its features are present; a pair
 * referencing an absent feature is inert, so a stale interaction never crashes
 * or silently distorts an unrelated offer. Each `value` must be finite.
 */
export function interactionValueForFeatures(
  featureIds: readonly string[],
  interactions: readonly FeatureInteraction[],
): number {
  if (interactions.length === 0) return 0;
  const present = new Set(featureIds);
  return interactions.reduce((total, interaction) => {
    const [a, b] = interaction.featureIds;
    if (a === b || !present.has(a) || !present.has(b)) return total;
    if (!Number.isFinite(interaction.value)) {
      throw new RangeError(`Interaction value for “${a}+${b}” must be finite.`);
    }
    return total + interaction.value;
  }, 0);
}

/**
 * Account-level value of a feature set: the additive sum plus any non-additive
 * pair adjustments, floored at zero. Substitutes can push value down but never
 * below zero — the envelope requires non-negative offer values, and a "worse
 * than worthless" bundle is economically indistinguishable from a worthless one.
 */
export function offerValueForFeatures(
  featureIds: readonly string[],
  featureValues: Readonly<Record<string, number>>,
  interactions: readonly FeatureInteraction[] = [],
): number {
  const additive = valueForFeatures(featureIds, featureValues);
  return Math.max(0, additive + interactionValueForFeatures(featureIds, interactions));
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
  const interactions = input.interactions ?? [];
  const usageBands = input.usageBands;
  return input.tiers.flatMap((tier) => {
    const eligibleAddOns = availableAddOns(tier, addOns);
    return addOnSubsets(eligibleAddOns).map((subset) => {
      const selectedFeatures = uniqueFeatureIds([
        ...tier.featureIds,
        ...subset.flatMap((addOn) => addOn.featureIds),
      ]);
      const addOnPrice = subset.reduce(
        (total, addOn) =>
          total +
          effectivePrice(addOn.price, addOn.priceMetric, input.seatCount) +
          usageSurcharge(addOn.usagePricing, usageBands),
        0,
      );
      const addOnIds = subset.map((addOn) => addOn.id);
      const tierEffective =
        effectivePrice(tier.price, tier.priceMetric, input.seatCount) +
        usageSurcharge(tier.usagePricing, usageBands);
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
        value: offerValueForFeatures(selectedFeatures, input.featureValues, interactions),
        effectivePrice: tierEffective + addOnPrice,
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
