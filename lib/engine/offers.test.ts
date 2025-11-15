import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { expandOffers } from "./offers";
import type { AddOnDefinition, ExpandedOffer, TierDefinition } from "./types";

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
