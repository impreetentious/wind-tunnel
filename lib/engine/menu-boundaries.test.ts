import { describe, expect, it } from "vitest";
import { selectOffers, selectOfferAtScale } from "./envelope";
import { expandOffers } from "./offers";
import { buildPositioningMap, breakEvenRays, paretoFrontier } from "./competitive";
import { computeSegmentElasticity } from "./elasticity";
import { analyzeBundling, evaluateBundlingRegime } from "./bundling";
import type { ExpandedOffer, OfferExpansionInput } from "./types";

const own: ExpandedOffer = {
  id: "own",
  name: "Own",
  owner: "own",
  kind: "tier",
  value: 4,
  effectivePrice: 2,
  featureIds: [],
};
const expansion: OfferExpansionInput = {
  seatCount: 2,
  featureValues: { a: 4 },
  tiers: [{ id: "t", name: "Tier", price: 1, priceMetric: "flat", featureIds: ["a"] }],
};

describe("menu domain boundaries (@spec §4.2)", () => {
  it.each([
    { id: "" },
    { value: -1 },
    { value: Infinity },
    { effectivePrice: -1 },
    { effectivePrice: NaN },
  ])("rejects malformed offer %j", (patch) => {
    expect(() => selectOffers([{ ...own, ...patch }], 1)).toThrow(RangeError);
  });
  it("rejects duplicate identifiers and malformed outside options", () => {
    expect(() => selectOffers([own, own], 1)).toThrow(/unique/);
    const outside: ExpandedOffer = {
      ...own,
      id: "outside",
      owner: "outside",
      kind: "outside",
      value: 0,
      effectivePrice: 0,
    };
    for (const patch of [
      { owner: "own" as const },
      { kind: "tier" as const },
      { value: 1 },
      { effectivePrice: 1 },
    ])
      expect(() => selectOffers([{ ...outside, ...patch }], 1)).toThrow(/outside offer/);
  });
  it.each([-1, Infinity, NaN])("rejects scale/sigma/tolerance %s", (invalid) => {
    expect(() => selectOfferAtScale([own], invalid)).toThrow(RangeError);
    expect(() => selectOffers([own], invalid)).toThrow(RangeError);
    expect(() => selectOfferAtScale([own], 1, { tieTolerance: invalid })).toThrow(RangeError);
    expect(() => selectOffers([own], 1, { tieTolerance: invalid })).toThrow(RangeError);
  });
  it("resolves zero-value free ties independently of input order", () => {
    const free = { ...own, value: 0, effectivePrice: 0 };
    expect(selectOfferAtScale([free], 0).id).toBe("outside");
    expect(selectOfferAtScale([free], 0, { tieMode: "seller-favorable" }).id).toBe("own");
    const rival = {
      ...free,
      id: "rival",
      owner: "competitor" as const,
      kind: "competitor" as const,
    };
    for (const offers of [
      [free, rival],
      [rival, free],
    ])
      expect(selectOfferAtScale(offers, 0, { tieMode: "seller-favorable" }).id).toBe("rival");
  });
  it("a free positive-value offer captures all buyers with zero local price elasticity", () => {
    const result = computeSegmentElasticity({
      segmentId: "s",
      sigma: 1,
      offers: [{ ...own, effectivePrice: 0 }],
    });
    expect(result.activeOfferElasticities).toEqual([
      {
        offerId: "own",
        effectiveValue: 4,
        effectivePrice: 0,
        share: 1,
        ownShareDerivative: -0,
        ownPriceDemandElasticity: undefined,
        ownPriceRevenueElasticity: undefined,
      },
    ]);
    expect(result.substitution).toEqual([
      {
        fromOfferId: "own",
        toOfferId: "outside",
        shareDerivative: 0,
        crossPriceDemandElasticity: undefined,
      },
    ]);
    expect(() => computeSegmentElasticity({ segmentId: "", sigma: 1, offers: [] })).toThrow(
      RangeError,
    );
    expect(() => computeSegmentElasticity({ segmentId: "s", sigma: -1, offers: [] })).toThrow(
      RangeError,
    );
  });
  it.each(["tiers", "addOns", "competitors"] as const)(
    "rejects excessive or duplicate %s",
    (key) => {
      const item =
        key === "competitors"
          ? { id: "x", name: "X", price: 1, priceMetric: "flat" as const, value: 1 }
          : { id: "x", name: "X", price: 1, priceMetric: "flat" as const, featureIds: ["a"] };
      const limit = key === "tiers" ? 5 : key === "addOns" ? 3 : 6;
      expect(() =>
        expandOffers({
          ...expansion,
          [key]: Array.from({ length: limit + 1 }, (_, index) => ({ ...item, id: String(index) })),
        }),
      ).toThrow(/At most/);
      expect(() => expandOffers({ ...expansion, [key]: [item, item] })).toThrow(/unique/);
      expect(() => expandOffers({ ...expansion, [key]: [{ ...item, id: "" }] })).toThrow(
        /non-empty/,
      );
    },
  );
  it.each([-1, NaN, Infinity])("rejects invalid expansion seat count %s", (seatCount) => {
    expect(() => expandOffers({ ...expansion, seatCount })).toThrow(RangeError);
  });
  it("keeps a stale usage metric inert and rejects an invalid used feature", () => {
    const result = expandOffers({
      ...expansion,
      tiers: [{ ...expansion.tiers[0], usagePricing: [{ metricId: "missing", perUnitPrice: 3 }] }],
    });
    expect(result[1].effectivePrice).toBe(1);
    expect(() => expandOffers({ ...expansion, featureValues: { a: -1 } })).toThrow(RangeError);
    expect(() =>
      expandOffers({ ...expansion, tiers: [{ ...expansion.tiers[0], price: -1 }] }),
    ).toThrow(RangeError);
  });
  it("preserves only the cheaper equal-value Pareto point and converts seats once", () => {
    const result = buildPositioningMap({
      segmentId: "s",
      seatCount: 3,
      sigma: 0,
      competitors: [{ id: "r", name: "R", value: 8, price: 2, priceMetric: "per-seat" }],
      tiers: [{ id: "t", name: "T", value: 7, price: 3, priceMetric: "per-seat" }],
    });
    expect(result.frontier[0].effectivePrice).toBe(6);
    expect(result.tiers[0].effectivePrice).toBe(9);
    expect(result.dominance).toEqual([
      { tierId: "t", verdict: "directly-dominated", dominatingCompetitorId: "r" },
    ]);
    expect(
      paretoFrontier([
        { id: "a", name: "A", value: 4, effectivePrice: 2 },
        { id: "b", name: "B", value: 4, effectivePrice: 1 },
      ]).map((point) => point.id),
    ).toEqual(["b"]);
  });
  it("rejects malformed positioning inputs and competitor fields", () => {
    const input = {
      segmentId: "s",
      seatCount: 1,
      sigma: 0,
      tiers: [],
      competitors: [{ id: "r", name: "R", value: 1, price: 1, priceMetric: "flat" as const }],
    };
    for (const patch of [{ segmentId: "" }, { seatCount: 0 }, { seatCount: NaN }])
      expect(() => buildPositioningMap({ ...input, ...patch })).toThrow(RangeError);
    for (const patch of [{ id: "" }, { name: "" }, { value: -1 }, { price: Infinity }])
      expect(() =>
        buildPositioningMap({ ...input, competitors: [{ ...input.competitors[0], ...patch }] }),
      ).toThrow(RangeError);
    expect(() => breakEvenRays(-1)).toThrow(RangeError);
  });
  it("the worthless bundle has a singleton zero price grid and zero revenue", () => {
    const result = analyzeBundling({
      tieMode: "seller-favorable",
      segments: [{ id: "s", prospectCount: 2, sigma: 0, valueA: 0, valueB: 0 }],
    });
    expect(result.candidates).toEqual({ a: [0], b: [0], bundle: [0] });
    expect(result.best.revenue).toBe(0);
    expect(result.tieMode).toBe("seller-favorable");
  });
  it("rejects empty/duplicate/negative bundle inputs and incomplete menus", () => {
    const segment = { id: "s", prospectCount: 2, sigma: 0, valueA: 4, valueB: 6 };
    expect(() => analyzeBundling({ segments: [] })).toThrow(RangeError);
    expect(() => analyzeBundling({ segments: [segment, segment] })).toThrow(RangeError);
    for (const patch of [
      { id: "" },
      { prospectCount: -1 },
      { sigma: NaN },
      { valueA: -1 },
      { valueB: Infinity },
    ])
      expect(() => analyzeBundling({ segments: [{ ...segment, ...patch }] })).toThrow(RangeError);
    expect(() => evaluateBundlingRegime({ segments: [segment] }, "components", { a: 1 })).toThrow(
      RangeError,
    );
    expect(() => evaluateBundlingRegime({ segments: [segment] }, "pure-bundle", {})).toThrow(
      RangeError,
    );
    expect(() => evaluateBundlingRegime({ segments: [segment] }, "mixed", {})).toThrow(RangeError);
    expect(() =>
      evaluateBundlingRegime({ segments: [segment] }, "mixed", { a: 1, b: 1, bundle: 3 }),
    ).toThrow(RangeError);
  });
});
