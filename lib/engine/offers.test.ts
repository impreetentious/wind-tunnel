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

  // @spec §4.1.1 — an interaction contributes only when both features are present.
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

  // @spec §4.15 — usage lines fold into the offer's effective price
  it("adds the segment expected usage surcharge to tier and add-on composites", () => {
    const offers = expandOffers({
      seatCount: 5,
      featureValues,
      tiers: [
        {
          id: "base",
          name: "Base",
          price: 50,
          priceMetric: "flat",
          featureIds: ["a"],
          usagePricing: [{ metricId: "calls", perUnitPrice: 0.001, includedUnits: 1_000 }],
        },
      ],
      addOns: [
        {
          id: "plus",
          name: "Plus",
          price: 20,
          priceMetric: "flat",
          featureIds: ["b"],
          usagePricing: [{ metricId: "gb", perUnitPrice: 5 }],
        },
      ],
      includeCompetitors: false,
      usageBands: {
        calls: { p10: 3_000, p50: 5_000, p90: 9_000 },
        gb: { p10: 5, p50: 10, p90: 20 },
      },
    });
    const byId = expandedById(offers);
    // Base: 50 flat + (5000 - 1000) * 0.001 = 50 + 4 = 54
    expect(byId.get("tier:base")?.effectivePrice).toBeCloseTo(54, 12);
    // Composite adds add-on flat 20 + usage 10 * 5 = 20 + 50 = 70; total 54 + 70 = 124
    expect(byId.get("tier:base+addons:plus")?.effectivePrice).toBeCloseTo(124, 12);
  });

  // @spec §4.15 — omitting usage lines/bands is byte-identical to the flat model
  it("computes an unchanged effective price when usage is not configured", () => {
    const offers = expandOffers({
      seatCount: 1,
      featureValues,
      tiers: [{ id: "base", name: "Base", price: 40, priceMetric: "flat", featureIds: ["a"] }],
      includeCompetitors: false,
    });
    const withEmpty = expandOffers({
      seatCount: 1,
      featureValues,
      tiers: [{ id: "base", name: "Base", price: 40, priceMetric: "flat", featureIds: ["a"] }],
      includeCompetitors: false,
      usageBands: {},
    });
    expect(offers.map((offer) => offer.effectivePrice)).toEqual(
      withEmpty.map((offer) => offer.effectivePrice),
    );
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

// §4.2's expansion is the first thing every other engine consumes, so its caps
// and completeness checks are the earliest place a malformed catalog can be
// stopped. A missing feature value in particular would otherwise silently
// expand to NaN value and poison every downstream readout.
describe("offer expansion guards", () => {
  const featureValues = { core: 100, analytics: 60 };
  const tier: TierDefinition = {
    id: "pro",
    name: "Pro",
    price: 50,
    priceMetric: "flat",
    featureIds: ["core"],
  };

  function expansion(overrides: Record<string, unknown> = {}) {
    return expandOffers({
      seatCount: 4,
      featureValues,
      tiers: [tier],
      includeCompetitors: false,
      ...overrides,
    } as Parameters<typeof expandOffers>[0]);
  }

  // @spec §4.2 T-OFR-G1
  it("rejects a malformed seat count", () => {
    for (const seatCount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => expansion({ seatCount })).toThrow(RangeError);
    }
  });

  // @spec §4.2 T-OFR-G2
  it("enforces the documented catalog caps", () => {
    const tiers = Array.from({ length: 6 }, (_, index) => ({ ...tier, id: `t${index}` }));
    expect(() => expansion({ tiers })).toThrow(/At most 5 tiers/);

    const addOns = Array.from({ length: 4 }, (_, index) => ({
      id: `x${index}`,
      name: `X${index}`,
      price: 5,
      priceMetric: "flat" as const,
      featureIds: ["analytics"],
    }));
    expect(() => expansion({ addOns })).toThrow(/At most 3 add-ons/);

    const competitors = Array.from({ length: 7 }, (_, index) => ({
      id: `c${index}`,
      name: `C${index}`,
      price: 40,
      priceMetric: "flat" as const,
      value: 120,
    }));
    expect(() => expansion({ competitors, includeCompetitors: true })).toThrow(
      /At most 6 competitors/,
    );
  });

  // @spec §4.2 T-OFR-G3
  it("rejects duplicate or blank ids in any collection", () => {
    expect(() => expansion({ tiers: [tier, { ...tier }] })).toThrow(RangeError);
    expect(() => expansion({ tiers: [{ ...tier, id: "" }] })).toThrow(RangeError);
  });

  // @spec §4.2 T-OFR-G4
  it("rejects a tier referencing a feature with no value", () => {
    expect(() => expansion({ tiers: [{ ...tier, featureIds: ["absent"] }] })).toThrow(
      /Missing value for feature/,
    );
    expect(() => expansion({ featureValues: { core: Number.NaN }, tiers: [tier] })).toThrow(
      RangeError,
    );
    expect(() => expansion({ featureValues: { core: -10 }, tiers: [tier] })).toThrow(RangeError);
  });

  // @spec §4.2 T-OFR-G5 — a self-pair or absent side contributes nothing.
  it("ignores interactions that are not fully present, and rejects non-finite ones", () => {
    expect(interactionValueForFeatures(["core"], [])).toBe(0);
    expect(
      interactionValueForFeatures(["core"], [{ featureIds: ["core", "core"], value: 25 }]),
    ).toBe(0);
    expect(
      interactionValueForFeatures(["core"], [{ featureIds: ["core", "analytics"], value: 25 }]),
    ).toBe(0);
    expect(
      interactionValueForFeatures(
        ["core", "analytics"],
        [{ featureIds: ["core", "analytics"], value: 25 }],
      ),
    ).toBe(25);
    expect(() =>
      interactionValueForFeatures(
        ["core", "analytics"],
        [{ featureIds: ["core", "analytics"], value: Number.NaN }],
      ),
    ).toThrow(RangeError);
  });

  // @spec §4.2 T-OFR-G7 — usage pricing is optional; absent means zero cost.
  it("adds no usage cost when a tier declares no usage pricing", () => {
    const withoutUsage = expansion({ tiers: [{ ...tier, usagePricing: [] }] });
    const baseline = expansion();
    const find = (offers: ReturnType<typeof expandOffers>) =>
      offers.find((offer) => offer.id === "pro")?.effectivePrice;
    expect(find(withoutUsage)).toBe(find(baseline));
  });

  // @spec §4.15 T-OFR-G8 — §4.15 and §4.17 both make a metered line inert when the segment has
  // no band for its metric. The expansion input may omit `usageBands` altogether, which is the
  // shape a pre-extension scenario has: a metered template opened against such a segment must
  // price at its list price rather than throwing on the missing record.
  it("prices usage lines and credit packs at list when the segment carries no usage bands", () => {
    const metered = {
      ...tier,
      usagePricing: [{ metricId: "api-calls", perUnitPrice: 0.02, includedUnits: 10 }],
      creditPacks: [{ metricId: "api-calls", packUnits: 500, packPrice: 40 }],
    };
    const bandless = expansion({ tiers: [metered] });
    const offer = bandless.find((candidate) => candidate.id === "pro");
    expect(offer?.effectivePrice).toBe(
      expansion().find((candidate) => candidate.id === "pro")?.effectivePrice,
    );
    // No pack was priced, so the offer carries no breakage key to disclose.
    expect(offer?.breakageRevenue).toBeUndefined();
  });

  // @spec §4.2 T-OFR-G6 — substitutes may reduce value, but never below zero.
  it("floors offer value at zero", () => {
    expect(
      offerValueForFeatures(["core", "analytics"], featureValues, [
        { featureIds: ["core", "analytics"], value: -1_000 },
      ]),
    ).toBe(0);
  });
});
