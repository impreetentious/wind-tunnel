import { describe, expect, it } from "vitest";
import {
  removeOfferCounterfactual,
  simulateEconomics,
  simulateSegmentEconomics,
  sweepTierPrice,
} from "./economics";
import { optimizeJointPrices } from "./optimizer";
import { lintDesign } from "./linter";
import type { ExpandedOffer, PriceSweepSegmentInput } from "./types";

const own: ExpandedOffer = {
  id: "own",
  name: "Own",
  owner: "own",
  kind: "tier",
  tierId: "t",
  value: 4,
  effectivePrice: 2,
  featureIds: ["a"],
};
const segment = { id: "s", sigma: 0, prospectCount: 3, fullCatalogValue: 6, offers: [own] };
const sweepSegment: PriceSweepSegmentInput = {
  id: "s",
  sigma: 0,
  prospectCount: 3,
  offerExpansion: {
    seatCount: 1,
    featureValues: { a: 4 },
    tiers: [{ id: "t", name: "Tier", price: 2, priceMetric: "flat", featureIds: ["a"] }],
  },
};

describe("economic conservation at domain boundaries (@spec §4.3)", () => {
  it("pins the point-mass waterfall and offer removal", () => {
    // Three identical buyers select V=4, P=2. Catalog potential is 3*6=18,
    // partitioned into revenue 6, surplus 6 and fence gap 6.
    expect(simulateEconomics({ segments: [segment] })).toMatchObject({
      mrr: 6,
      ownBuyerSurplus: 6,
      fencingGap: 6,
      unserved: 0,
      competitorLoss: 0,
      potential: 18,
      conservationResidual: 0,
      paidConversion: 1,
      arpa: 2,
      captureRate: 1 / 3,
    });
    const result = removeOfferCounterfactual({ segments: [segment] }, "own");
    expect(result.mrrChangeWhenRemoved).toBe(-6);
    expect(result.removedOfferContribution).toBe(6);
    expect(result.withoutOffer.unserved).toBe(18);
    for (const id of ["", "outside"])
      expect(() => removeOfferCounterfactual({ segments: [segment] }, id)).toThrow(RangeError);
  });
  it("zero prospects and worthless catalog produce finite zero ratios", () => {
    const competitor: ExpandedOffer = {
      ...own,
      id: "rival",
      owner: "competitor",
      kind: "competitor",
      competitorId: "r",
      value: 0,
      effectivePrice: 0,
    };
    for (const prospectCount of [0, 3]) {
      const result = simulateEconomics({
        segments: [{ ...segment, prospectCount, fullCatalogValue: 0, offers: [competitor] }],
      });
      expect(result).toMatchObject({
        mrr: 0,
        potential: 0,
        arpa: 0,
        captureRate: 0,
        competitorLossShare: 0,
        conservationResidual: 0,
      });
      expect(result.paidConversion).toBe(0);
    }
  });
  it("free own offers count as buyers but never paid conversion", () => {
    const result = simulateEconomics({
      segments: [{ ...segment, offers: [{ ...own, effectivePrice: 0 }] }],
    });
    expect(result).toMatchObject({
      mrr: 0,
      ownBuyers: 3,
      paidBuyers: 0,
      paidConversion: 0,
      arpa: 0,
      ownBuyerSurplus: 12,
      fencingGap: 6,
    });
  });
  it("rejects empty and malformed segment inputs", () => {
    expect(() => simulateEconomics({ segments: [] })).toThrow(RangeError);
    for (const patch of [
      { id: "" },
      { prospectCount: -1 },
      { fullCatalogValue: Infinity },
      { sigma: NaN },
    ])
      expect(() => simulateSegmentEconomics({ ...segment, ...patch })).toThrow(RangeError);
  });
});

describe("price-sweep and optimizer boundaries (@spec §4.4)", () => {
  it("the zero-value/zero-price sweep has exactly one honest zero point", () => {
    const worthless = {
      ...sweepSegment,
      offerExpansion: {
        ...sweepSegment.offerExpansion,
        featureValues: { a: 0 },
        tiers: [{ ...sweepSegment.offerExpansion.tiers[0], price: 0 }],
      },
    };
    const result = sweepTierPrice({ tierId: "t", segments: [worthless] });
    expect(result.points).toEqual([{ price: 0, demand: 0, revenue: 0, totalMrr: 0 }]);
    expect(result).toMatchObject({
      expansionCount: 0,
      searchedUpperBound: 0,
      bestInSearchedRange: false,
    });
    // No tier with zero value can generate paid revenue at any price.
    const optimized = optimizeJointPrices({
      seed: 0,
      segments: [worthless],
      tiers: [{ tierId: "t", currentPrice: 0, priceMetric: "flat" }],
    });
    expect(optimized).toMatchObject({
      baselineMrr: 0,
      bestMrr: 0,
      bestPrices: [{ tierId: "t", price: 0 }],
      status: "noImprovement",
    });
    expect(optimized.mrrLift).toBeUndefined();
    expect(optimized.candidates).toHaveLength(4);
    expect(
      optimized.candidates.every(
        (candidate) => candidate.cyclesRun === 1 && !candidate.improvedFromStart,
      ),
    ).toBe(true);
  });
  it("requires an included consistent tier and a valid per-seat denominator", () => {
    expect(() => sweepTierPrice({ tierId: "", segments: [sweepSegment] })).toThrow(RangeError);
    expect(() => sweepTierPrice({ tierId: "t", segments: [] })).toThrow(RangeError);
    expect(() => sweepTierPrice({ tierId: "absent", segments: [sweepSegment] })).toThrow(/missing/);
    for (const patch of [{ price: 3 }, { priceMetric: "per-seat" as const }])
      expect(() =>
        sweepTierPrice({
          tierId: "t",
          segments: [
            sweepSegment,
            {
              ...sweepSegment,
              id: "other",
              offerExpansion: {
                ...sweepSegment.offerExpansion,
                tiers: [{ ...sweepSegment.offerExpansion.tiers[0], ...patch }],
              },
            },
          ],
        }),
      ).toThrow(/same list price/);
    expect(() =>
      sweepTierPrice({ tierId: "t", segments: [{ ...sweepSegment, fullCatalogValue: -1 }] }),
    ).toThrow(RangeError);
    expect(() =>
      sweepTierPrice({
        tierId: "t",
        segments: [
          {
            ...sweepSegment,
            offerExpansion: {
              ...sweepSegment.offerExpansion,
              seatCount: 0,
              tiers: [{ ...sweepSegment.offerExpansion.tiers[0], priceMetric: "per-seat" }],
            },
          },
        ],
      }),
    ).toThrow(/at least one seat/);
  });
  it("rejects missing optimizer tiers/segments and invalid price identifiers", () => {
    const input = {
      seed: 1,
      segments: [sweepSegment],
      tiers: [{ tierId: "t", currentPrice: 2, priceMetric: "flat" as const }],
    };
    expect(() => optimizeJointPrices({ ...input, tiers: [] })).toThrow(/at least one tier/);
    expect(() => optimizeJointPrices({ ...input, segments: [] })).toThrow(/at least one segment/);
    for (const patch of [
      { tierId: "" },
      { tierId: "missing" },
      { currentPrice: -1 },
      { currentPrice: NaN },
    ])
      expect(() =>
        optimizeJointPrices({ ...input, tiers: [{ ...input.tiers[0], ...patch }] }),
      ).toThrow(RangeError);
  });
  it("retains prices outside the selected coordinate and explicit catalog values", () => {
    const other = {
      id: "unsearched",
      name: "Other",
      price: 5,
      priceMetric: "flat" as const,
      featureIds: ["a"],
    };
    const result = optimizeJointPrices({
      seed: 0,
      starts: 1,
      maxCycles: 1,
      segments: [
        {
          ...sweepSegment,
          fullCatalogValue: 10,
          offerExpansion: {
            ...sweepSegment.offerExpansion,
            tiers: [...sweepSegment.offerExpansion.tiers, other],
          },
        },
      ],
      tiers: [{ tierId: "t", currentPrice: 2, priceMetric: "flat" }],
    });
    expect(result.baselineMrr).toBe(6);
    expect(result.bestMrr).toBeGreaterThanOrEqual(6);
    expect(result.bestPrices.map((price) => price.tierId)).toEqual(["t"]);
  });
});

describe("point-mass competitor loss linter (@spec §4.9)", () => {
  it("a winning competitor takes all potential; a losing one takes none", () => {
    const rival: ExpandedOffer = {
      ...own,
      id: "competitor:r",
      name: "Rival",
      owner: "competitor",
      kind: "competitor",
      competitorId: "r",
      tierId: undefined,
    };
    for (const price of [0, 5]) {
      const baseline = simulateEconomics({
        segments: [{ ...segment, offers: [own, { ...rival, effectivePrice: price }] }],
      });
      const findings = lintDesign({
        tiers: [],
        addOns: [],
        features: [],
        segments: [{ id: "s", name: "S", seatCount: 1 }],
        baseline,
        simulate: () => baseline,
      });
      expect(findings.map((finding) => finding.id)).toEqual(price === 0 ? ["E7"] : []);
      if (price === 0) expect(findings[0].metrics).toEqual({ lossShare: 1, competitorLoss: 18 });
    }
  });
});
