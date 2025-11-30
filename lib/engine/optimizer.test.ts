import { describe, expect, it } from "vitest";

import { simulateEconomics, sweepTierPrice } from "./economics";
import { expandOffers } from "./offers";
import { optimizeJointPrices } from "./optimizer";
import type { PriceSweepSegmentInput } from "./types";

function segment(
  id: string,
  prospectCount: number,
  sigma: number,
  wtp: number,
  seatCount = 1,
  tiers = defaultTiers,
): PriceSweepSegmentInput {
  return {
    id,
    prospectCount,
    sigma,
    fullCatalogValue: wtp,
    offerExpansion: {
      seatCount,
      featureValues: { core: wtp * 0.6, pro: wtp * 0.4 },
      tiers,
      addOns: [],
      competitors: [],
      includeCompetitors: false,
    },
  };
}

const defaultTiers = [
  { id: "basic", name: "Basic", price: 20, priceMetric: "flat" as const, featureIds: ["core"] },
  {
    id: "pro",
    name: "Pro",
    price: 60,
    priceMetric: "flat" as const,
    featureIds: ["core", "pro"],
  },
];

function baselineMrr(segments: readonly PriceSweepSegmentInput[]): number {
  return simulateEconomics({
    segments: segments.map((entry) => ({
      id: entry.id,
      prospectCount: entry.prospectCount,
      fullCatalogValue: entry.fullCatalogValue ?? 0,
      sigma: entry.sigma,
      offers: expandOffers(entry.offerExpansion),
      selectionOptions: entry.selectionOptions,
    })),
  }).mrr;
}

describe("joint price optimizer", () => {
  // @spec §4.14 T-OPT-01
  it("weakly improves scenario MRR versus the current design", () => {
    const segments = [segment("smb", 200, 0.5, 80), segment("mid", 100, 0.4, 140)];
    const result = optimizeJointPrices({
      segments,
      tiers: [
        { tierId: "basic", currentPrice: 20, priceMetric: "flat" },
        { tierId: "pro", currentPrice: 60, priceMetric: "flat" },
      ],
      seed: 42,
      starts: 3,
      maxCycles: 3,
    });
    expect(result.baselineMrr).toBeCloseTo(baselineMrr(segments), 6);
    expect(result.bestMrr).toBeGreaterThanOrEqual(result.baselineMrr - 1e-9);
    expect(result.disclosure).toMatch(/local/i);
    expect(result.disclosure).toMatch(/not/i);
  });

  // @spec §4.14 T-OPT-02
  it("converges within one sweep-grid step of the single-tier sweep argmax", () => {
    const segments = [segment("solo", 300, 0.55, 100)];
    const singleTier = [defaultTiers[1]]; // only pro
    const singleSegments: PriceSweepSegmentInput[] = segments.map((entry) => ({
      ...entry,
      offerExpansion: { ...entry.offerExpansion, tiers: singleTier },
    }));
    const sweep = sweepTierPrice({
      tierId: "pro",
      segments: singleSegments,
    });
    const optimum = optimizeJointPrices({
      segments: singleSegments,
      tiers: [{ tierId: "pro", currentPrice: singleTier[0].price, priceMetric: "flat" }],
      seed: 7,
      starts: 3,
      maxCycles: 3,
    });
    const gridStep = sweep.searchedUpperBound / (sweep.points.length - 1);
    expect(Math.abs(optimum.bestPrices[0].price - sweep.bestPoint.price)).toBeLessThanOrEqual(
      gridStep * 1.5,
    );
    expect(optimum.bestMrr).toBeGreaterThanOrEqual(baselineMrr(singleSegments) - 1e-6);
  });

  // @spec §4.14 T-OPT-03
  it("is deterministic under identical seeds", () => {
    const segments = [segment("smb", 200, 0.5, 80), segment("mid", 100, 0.4, 140)];
    const options = {
      segments,
      tiers: [
        { tierId: "basic", currentPrice: 20, priceMetric: "flat" as const },
        { tierId: "pro", currentPrice: 60, priceMetric: "flat" as const },
      ],
      seed: 1234,
      starts: 4,
      maxCycles: 3,
    };
    const first = optimizeJointPrices(options);
    const second = optimizeJointPrices(options);
    expect(second.bestMrr).toBeCloseTo(first.bestMrr, 9);
    expect(second.bestPrices.map((entry) => entry.price)).toEqual(
      first.bestPrices.map((entry) => entry.price),
    );
    expect(second.candidates).toHaveLength(first.candidates.length);
  });

  // @spec §4.14 T-OPT-04
  it("rejects inputs with no tiers or no segments", () => {
    expect(() =>
      optimizeJointPrices({
        segments: [segment("solo", 100, 0.5, 80)],
        tiers: [],
        seed: 1,
      }),
    ).toThrow(/at least one tier/);
    expect(() =>
      optimizeJointPrices({
        segments: [],
        tiers: [{ tierId: "basic", currentPrice: 20, priceMetric: "flat" }],
        seed: 1,
      }),
    ).toThrow(/at least one segment/);
  });
});
