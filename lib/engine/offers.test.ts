import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { expandOffers, interactionValueForFeatures, offerValueForFeatures } from "./offers";
import type { AddOnDefinition, ExpandedOffer, FeatureInteraction, TierDefinition } from "./types";

function expectedOfferIds(tier: TierDefinition, addOns: readonly AddOnDefinition[]): string[] {
  const eligible = addOns.filter((addOn) =>
    addOn.featureIds.some((id) => !tier.featureIds.includes(id)),
  );
  return Array.from({ length: 1 << eligible.length }, (_, mask) => {
    const ids = eligible.filter((_, index) => (mask & (1 << index)) !== 0).map((addOn) => addOn.id);
    return ids.length === 0 ? `tier:${tier.id}` : `tier:${tier.id}+addons:${ids.join(",")}`;
  });
}

function expandedById(offers: readonly ExpandedOffer[]): Map<string, ExpandedOffer> {
  return new Map(offers.map((offer) => [offer.id, offer]));
}

describe("offer expansion", () => {
  // T-ADD-01 @spec §4.2
  it("matches independent tier × add-on subset enumeration", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 3, maxLength: 3 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 100 }),
        (values, seats, tierPrice) => {
          const tier: TierDefinition = {
            id: "starter",
            name: "Starter",
            price: tierPrice,
            priceMetric: "flat",
            featureIds: ["core"],
          };
          const addOns: AddOnDefinition[] = [
            {
              id: "included",
              name: "Included",
              price: 5,
              priceMetric: "flat",
              featureIds: ["core"],
            },
            {
              id: "extra",
              name: "Extra",
              price: 3,
              priceMetric: "per-seat",
              featureIds: ["extra"],
            },
            {
              id: "both",
              name: "Both",
              price: 7,
              priceMetric: "flat",
              featureIds: ["core", "both"],
            },
          ];
          const featureValues: Record<string, number> = {
            core: values[0],
            extra: values[1],
            both: values[2],
          };
          const result = expandOffers({
            seatCount: seats,
            featureValues,
            tiers: [tier],
            addOns,
            includeCompetitors: false,
          });
          const byId = expandedById(result);
          const expectedIds = expectedOfferIds(tier, addOns);

          expect([...byId.keys()].sort()).toEqual(["outside", ...expectedIds].sort());
          for (const id of expectedIds) {
            const offer = byId.get(id);
            expect(offer).toBeDefined();
            const selectedAddOns = id.includes("+addons:") ? id.split(":")[2].split(",") : [];
            const selectedFeatures = new Set(["core"]);
            let expectedPrice = tierPrice;
            for (const addOnId of selectedAddOns) {
              const addOn = addOns.find((candidate) => candidate.id === addOnId);
              if (!addOn) throw new Error("Independent fixture lookup failed.");
              addOn.featureIds.forEach((featureId) => selectedFeatures.add(featureId));
              expectedPrice += addOn.priceMetric === "per-seat" ? addOn.price * seats : addOn.price;
            }
            const expectedValue = [...selectedFeatures].reduce(
              (sum, featureId) => sum + featureValues[featureId],
              0,
            );
            expect(offer?.effectivePrice).toBe(expectedPrice);
            expect(offer?.value).toBe(expectedValue);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("non-additive feature interactions", () => {
  const featureValues = { a: 100, b: 60, c: 40 };

  // @spec §4.1 — an interaction contributes only when both features are present.
  it("applies a pair adjustment only to offers holding both features", () => {
    const interactions: FeatureInteraction[] = [{ featureIds: ["a", "b"], value: 25 }];
    expect(interactionValueForFeatures(["a", "b", "c"], interactions)).toBe(25);
    expect(interactionValueForFeatures(["a", "c"], interactions)).toBe(0);
    expect(interactionValueForFeatures(["b"], interactions)).toBe(0);
  });

  // @spec §4.1 — complements add, substitutes subtract, and value floors at zero.
  it("adds complements, subtracts substitutes, and never returns a negative value", () => {
    const additive = offerValueForFeatures(["a", "b"], featureValues, []);
    expect(additive).toBe(160);

    const complement = offerValueForFeatures(["a", "b"], featureValues, [
      { featureIds: ["a", "b"], value: 40 },
    ]);
    expect(complement).toBe(200);

    const substitute = offerValueForFeatures(["a", "b"], featureValues, [
      { featureIds: ["a", "b"], value: -50 },
    ]);
    expect(substitute).toBe(110);

    // A substitute larger than the additive base clamps at zero, not negative.
    const clamped = offerValueForFeatures(["a", "b"], featureValues, [
      { featureIds: ["a", "b"], value: -500 },
    ]);
    expect(clamped).toBe(0);
  });

  // @spec §4.1 — omitting interactions is identical to the additive model.
  it("is byte-identical to the additive model when no interaction is supplied", () => {
    const withoutArg = offerValueForFeatures(["a", "b", "c"], featureValues);
    const withEmpty = offerValueForFeatures(["a", "b", "c"], featureValues, []);
    expect(withoutArg).toBe(200);
    expect(withEmpty).toBe(200);
  });

  // @spec §4.1 — a stale interaction referencing an absent feature is inert.
  it("ignores an interaction whose features are not both present, and rejects non-finite values", () => {
    expect(interactionValueForFeatures(["a", "b"], [{ featureIds: ["a", "z"], value: 99 }])).toBe(
      0,
    );
    expect(() =>
      interactionValueForFeatures(["a", "b"], [{ featureIds: ["a", "b"], value: Number.NaN }]),
    ).toThrow(/finite/);
  });

  // @spec §4.1 — the full expansion carries interaction value into composites.
  it("raises the value of a tier and its add-on composites that unlock the pair", () => {
    const offers = expandOffers({
      seatCount: 1,
      featureValues,
      tiers: [{ id: "base", name: "Base", price: 50, priceMetric: "flat", featureIds: ["a"] }],
      addOns: [{ id: "plus", name: "Plus", price: 20, priceMetric: "flat", featureIds: ["b"] }],
      includeCompetitors: false,
      interactions: [{ featureIds: ["a", "b"], value: 30 }],
    });
    const byId = expandedById(offers);
    // Bare tier holds only "a": no pair, additive value 100.
    expect(byId.get("tier:base")?.value).toBe(100);
    // Composite holds "a" and "b": additive 160 + interaction 30 = 190.
    expect(byId.get("tier:base+addons:plus")?.value).toBe(190);
  });
});
