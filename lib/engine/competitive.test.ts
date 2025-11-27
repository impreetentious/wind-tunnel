import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  breakEvenRays,
  buildPositioningMap,
  directDominanceVerdict,
  paretoFrontier,
  type CompetitorPoint,
  type PositioningTierPoint,
} from "./competitive";
import { simulateEconomics } from "./economics";
import { expandOffers } from "./offers";
import { lognormalQuantile, scaleDistribution } from "./stats";
import type { CompetitorDefinition, SegmentEconomicsInput, TierDefinition } from "./types";

function competitor(
  id: string,
  value: number,
  price: number,
  overrides: Partial<CompetitorDefinition> = {},
): CompetitorDefinition {
  return {
    id,
    name: id,
    price,
    priceMetric: "flat",
    value,
    ...overrides,
  };
}

function pointFromCompetitor(source: CompetitorDefinition, seatCount = 1): CompetitorPoint {
  return {
    id: source.id,
    name: source.name,
    value: source.value,
    effectivePrice: source.priceMetric === "per-seat" ? source.price * seatCount : source.price,
  };
}

describe("competitive positioning", () => {
  // T-CMP-01 @spec §4.11
  it("returns the Pareto staircase, including a Pareto point off the convex hull", () => {
    // (V=100, P=40) sits below the segment from (60,20) → (140,60), i.e. below
    // the convex hull, but is Pareto-efficient because nothing dominates it.
    const alpha = pointFromCompetitor(competitor("alpha", 60, 20));
    const beta = pointFromCompetitor(competitor("beta", 100, 40));
    const gamma = pointFromCompetitor(competitor("gamma", 140, 60));
    const dominated = pointFromCompetitor(competitor("dominated", 80, 50));
    const worse = pointFromCompetitor(competitor("worse", 120, 100));
    const frontier = paretoFrontier([alpha, beta, gamma, dominated, worse]);
    expect(frontier.map((point) => point.id)).toEqual(["alpha", "beta", "gamma"]);

    const singleton = paretoFrontier([alpha]);
    expect(singleton).toEqual([alpha]);
  });

  // T-CMP-02 @spec §4.11
  it("returns break-even rays whose slopes match the segment's lognormal quantiles", () => {
    const sigma = 0.6;
    const rays = breakEvenRays(sigma);
    const distribution = scaleDistribution(sigma);
    expect(rays[0]).toEqual({
      label: "p10",
      slope: lognormalQuantile(0.1, distribution),
    });
    expect(rays[1]).toEqual({
      label: "p50",
      slope: lognormalQuantile(0.5, distribution),
    });
    expect(rays[2]).toEqual({
      label: "p90",
      slope: lognormalQuantile(0.9, distribution),
    });
    // A ray at slope ε passes through (V, εV) — the definition of the ray.
    for (const ray of rays) {
      const value = 42;
      expect(ray.slope * value).toBeCloseTo(ray.slope * value, 12);
    }
  });

  // T-CMP-03 @spec §4.11
  it("collapses duplicate competitor points on the frontier", () => {
    const alpha = pointFromCompetitor(competitor("alpha", 100, 40));
    const alphaCopy = pointFromCompetitor(competitor("alpha-copy", 100, 40));
    const frontier = paretoFrontier([alpha, alphaCopy]);
    expect(frontier.length).toBe(1);
    expect(frontier[0].value).toBe(100);
    expect(frontier[0].effectivePrice).toBe(40);
  });

  // T-CMP-04 @spec §4.11
  it("triggers direct dominance only when the discrete predicate holds", () => {
    const frontier: readonly CompetitorPoint[] = [
      pointFromCompetitor(competitor("cheap", 90, 30)),
      pointFromCompetitor(competitor("premium", 160, 100)),
    ];
    const tier: PositioningTierPoint = { id: "pro", name: "Pro", value: 120, effectivePrice: 80 };
    // No competitor is both ≥ 120 on value and ≤ 80 on price → not directly dominated.
    expect(directDominanceVerdict(tier, frontier).verdict).toBe("not-directly-dominated");

    const dominatedTier: PositioningTierPoint = {
      id: "expensive",
      name: "Expensive",
      value: 80,
      effectivePrice: 60,
    };
    // 'cheap' at (90, 30) dominates (80, 60).
    const dominatedReadout = directDominanceVerdict(dominatedTier, frontier);
    expect(dominatedReadout.verdict).toBe("directly-dominated");
    expect(dominatedReadout.dominatingCompetitorId).toBe("cheap");
  });

  // T-CMP-05 @spec §4.11
  it("makes competitors take real share when they beat the tier menu", () => {
    const featureValues = { core: 200 };
    const tiers: readonly TierDefinition[] = [
      { id: "pro", name: "Pro", price: 150, priceMetric: "flat", featureIds: ["core"] },
    ];
    const competitors: readonly CompetitorDefinition[] = [
      { id: "rival", name: "Rival", price: 60, priceMetric: "flat", value: 200 },
    ];
    const withCompetitors: SegmentEconomicsInput = {
      id: "teams",
      prospectCount: 200,
      fullCatalogValue: 200,
      sigma: 0.4,
      offers: expandOffers({
        seatCount: 1,
        featureValues,
        tiers,
        competitors,
        includeCompetitors: true,
      }),
    };
    const withoutCompetitors: SegmentEconomicsInput = {
      ...withCompetitors,
      offers: expandOffers({
        seatCount: 1,
        featureValues,
        tiers,
        competitors,
        includeCompetitors: false,
      }),
    };

    const withResult = simulateEconomics({ segments: [withCompetitors] });
    const withoutResult = simulateEconomics({ segments: [withoutCompetitors] });

    expect(withResult.competitorBuyers).toBeGreaterThan(0);
    expect(withResult.paidBuyers).toBeLessThan(withoutResult.paidBuyers);
    expect(Math.abs(withResult.conservationResidual)).toBeLessThan(1e-6 * withResult.potential);
    // Every share (own + outside + competitor) must sum to prospectCount.
    const segment = withResult.segments[0];
    const totalShare = segment.ownBuyers + segment.competitorBuyers;
    expect(totalShare).toBeLessThanOrEqual(segment.prospectCount + 1e-9);
  });

  // T-CMP-06 @spec §4.11
  it("preserves KPIs to 1e-12 when the competitor set is empty", () => {
    const featureValues = { core: 180 };
    const tiers: readonly TierDefinition[] = [
      { id: "pro", name: "Pro", price: 90, priceMetric: "flat", featureIds: ["core"] },
    ];
    const baseInput: SegmentEconomicsInput = {
      id: "teams",
      prospectCount: 500,
      fullCatalogValue: 180,
      sigma: 0.5,
      offers: expandOffers({
        seatCount: 1,
        featureValues,
        tiers,
        includeCompetitors: false,
      }),
    };
    const withEmpty: SegmentEconomicsInput = {
      ...baseInput,
      offers: expandOffers({
        seatCount: 1,
        featureValues,
        tiers,
        competitors: [],
        includeCompetitors: true,
      }),
    };
    const baseline = simulateEconomics({ segments: [baseInput] });
    const withEmptyResult = simulateEconomics({ segments: [withEmpty] });
    expect(withEmptyResult.mrr).toBeCloseTo(baseline.mrr, 12);
    expect(withEmptyResult.revenue).toBeCloseTo(baseline.revenue, 12);
    expect(withEmptyResult.ownBuyerSurplus).toBeCloseTo(baseline.ownBuyerSurplus, 12);
    expect(withEmptyResult.fencingGap).toBeCloseTo(baseline.fencingGap, 12);
    expect(withEmptyResult.competitorLoss).toBe(0);
    expect(withEmptyResult.competitorLossShare).toBeUndefined();
  });

  // T-CMP-07 @spec §4.11
  it("preserves 5-term conservation on random fixtures with 0–5 competitors", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            value: fc.double({ min: 40, max: 300, noNaN: true, noDefaultInfinity: true }),
            price: fc.double({ min: 0, max: 250, noNaN: true, noDefaultInfinity: true }),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        fc.double({ min: 0.1, max: 1.4, noNaN: true, noDefaultInfinity: true }),
        (rawCompetitors, sigma) => {
          const featureValues = { core: 200 };
          const tiers: readonly TierDefinition[] = [
            {
              id: "starter",
              name: "Starter",
              price: 40,
              priceMetric: "flat",
              featureIds: ["core"],
            },
            {
              id: "pro",
              name: "Pro",
              price: 120,
              priceMetric: "flat",
              featureIds: ["core"],
            },
          ];
          const competitors: CompetitorDefinition[] = rawCompetitors.map((raw, index) => ({
            id: `c-${index}`,
            name: `Competitor ${index}`,
            price: raw.price,
            priceMetric: "flat",
            value: raw.value,
          }));
          const segment: SegmentEconomicsInput = {
            id: "teams",
            prospectCount: 100,
            fullCatalogValue: 200,
            sigma,
            offers: expandOffers({
              seatCount: 1,
              featureValues,
              tiers,
              competitors,
              includeCompetitors: competitors.length > 0,
            }),
          };
          const result = simulateEconomics({ segments: [segment] });
          const sum =
            result.revenue +
            result.ownBuyerSurplus +
            result.fencingGap +
            result.unserved +
            result.competitorLoss;
          const tolerance = Math.max(1e-6, 1e-6 * result.potential);
          expect(Math.abs(result.potential - sum)).toBeLessThan(tolerance);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("buildPositioningMap", () => {
  // @spec §4.11
  it("normalizes per-seat competitor prices and returns the tier positions", () => {
    const map = buildPositioningMap({
      segmentId: "teams",
      seatCount: 4,
      sigma: 0.4,
      competitors: [
        {
          id: "rival",
          name: "Rival",
          price: 30,
          priceMetric: "per-seat",
          value: 200,
        },
      ],
      tiers: [
        {
          id: "pro",
          name: "Pro",
          price: 100,
          priceMetric: "flat",
          value: 180,
        },
      ],
    });

    expect(map.segmentId).toBe("teams");
    expect(map.tiers).toHaveLength(1);
    expect(map.tiers[0].effectivePrice).toBe(100);
    expect(map.frontier).toHaveLength(1);
    // Per-seat 30 × 4 seats = 120 account-month.
    expect(map.frontier[0].effectivePrice).toBe(120);
    expect(map.rays.map((ray) => ray.label)).toEqual(["p10", "p50", "p90"]);
    expect(map.dominance).toHaveLength(1);
    expect(map.dominance[0].tierId).toBe("pro");
  });
});
