import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  removeOfferCounterfactual,
  simulateEconomics,
  simulateSegmentEconomics,
  sweepTierPrice,
} from "./economics";
import { expandOffers } from "./offers";
import type { ExpandedOffer, SegmentEconomicsInput, TierPriceSweepInput } from "./types";

function offer(
  id: string,
  value: number,
  effectivePrice: number,
  owner: ExpandedOffer["owner"] = "own",
): ExpandedOffer {
  return {
    id,
    name: id,
    owner,
    kind: owner === "outside" ? "outside" : owner === "competitor" ? "competitor" : "tier",
    value,
    effectivePrice,
    featureIds: [],
  };
}

const outside = offer("outside", 0, 0, "outside");

function numericOwnSurplus(value: number, price: number, sigma: number): number {
  const lower = -10 * sigma;
  const upper = 10 * sigma;
  const steps = 40_000;
  const width = (upper - lower) / steps;
  const integrand = (logScale: number) => {
    const scale = Math.exp(logScale);
    const density =
      Math.exp(-(logScale * logScale) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
    return Math.max(0, scale * value - price) * density;
  };
  let total = integrand(lower) + integrand(upper);
  for (let index = 1; index < steps; index += 1) {
    total += (index % 2 === 0 ? 2 : 4) * integrand(lower + index * width);
  }
  return (total * width) / 3;
}

function tierRevenueAndDemand(
  segment: ReturnType<typeof simulateSegmentEconomics>,
  tierId: string,
) {
  let demand = 0;
  let revenue = 0;
  for (const selectedOffer of segment.selection.offers) {
    if (selectedOffer.owner !== "own" || selectedOffer.tierId !== tierId) continue;
    const share = segment.selection.shares[selectedOffer.id] ?? 0;
    demand += segment.prospectCount * share;
    revenue += segment.prospectCount * share * selectedOffer.effectivePrice;
  }
  return { demand, revenue };
}

function basicSweepInput(overrides: Partial<TierPriceSweepInput> = {}): TierPriceSweepInput {
  return {
    tierId: "pro",
    segments: [
      {
        id: "teams",
        prospectCount: 100,
        sigma: 0.5,
        offerExpansion: {
          seatCount: 4,
          featureValues: { core: 120, analytics: 80 },
          tiers: [
            {
              id: "starter",
              name: "Starter",
              price: 20,
              priceMetric: "flat",
              featureIds: ["core"],
            },
            {
              id: "pro",
              name: "Pro",
              price: 77.13,
              priceMetric: "flat",
              featureIds: ["core", "analytics"],
            },
          ],
          addOns: [],
          includeCompetitors: false,
        },
      },
    ],
    ...overrides,
  };
}

describe("economics readouts", () => {
  // T-ECON-01 @spec §4.3
  it("matches a hand-computed two-segment, two-tier fixture", () => {
    const result = simulateEconomics({
      segments: [
        {
          id: "alpha",
          prospectCount: 100,
          fullCatalogValue: 100,
          sigma: 0,
          offers: [outside, offer("alpha-basic", 60, 20), offer("alpha-pro", 100, 70)],
        },
        {
          id: "beta",
          prospectCount: 50,
          fullCatalogValue: 200,
          sigma: 0,
          offers: [outside, offer("beta-basic", 100, 40), offer("beta-pro", 200, 120)],
        },
      ],
    });

    expect(result.revenue).toBeCloseTo(8_000, 9);
    expect(result.ownBuyerSurplus).toBeCloseTo(8_000, 9);
    expect(result.fencingGap).toBeCloseTo(4_000, 9);
    expect(result.unserved).toBeCloseTo(0, 9);
    expect(result.competitorLoss).toBeCloseTo(0, 9);
    expect(result.potential).toBeCloseTo(20_000, 9);
    expect(result.conservationResidual).toBeCloseTo(0, 9);
    expect(result.mrr).toBeCloseTo(8_000, 9);
    expect(result.paidConversion).toBeCloseTo(1, 9);
    expect(result.arpa).toBeCloseTo(8_000 / 150, 9);
    expect(result.captureRate).toBeCloseTo(0.4, 9);
    expect(result.competitorLossShare).toBeUndefined();
  });

  // T-ECON-02 @spec §4.3
  it("conserves own-catalog potential on adversarial menus with and without competitors", () => {
    const segmentArbitrary = fc.record({
      fullValue: fc.double({ min: 1, max: 2_000, noNaN: true }),
      basicFraction: fc.double({ min: 0, max: 1, noNaN: true }),
      basicPrice: fc.double({ min: 0, max: 2_500, noNaN: true }),
      proPrice: fc.double({ min: 0, max: 3_000, noNaN: true }),
      freeFraction: fc.double({ min: 0, max: 1, noNaN: true }),
      sigma: fc.oneof(fc.constant(0), fc.double({ min: 0.05, max: 2, noNaN: true })),
      prospects: fc.integer({ min: 1, max: 10_000 }),
      competitorValue: fc.double({ min: 0, max: 3_000, noNaN: true }),
      competitorPrice: fc.double({ min: 0, max: 3_000, noNaN: true }),
      withCompetitor: fc.boolean(),
    });

    fc.assert(
      fc.property(segmentArbitrary, (fixture) => {
        const fullValue = fixture.fullValue;
        const offers: ExpandedOffer[] = [
          outside,
          offer("free-fence", fullValue * fixture.freeFraction, 0),
          offer("basic", fullValue * fixture.basicFraction, fixture.basicPrice),
          offer("pro", fullValue, fixture.proPrice),
          offer("dominated", fullValue * fixture.basicFraction, fixture.basicPrice + 1),
        ];
        if (fixture.withCompetitor) {
          offers.push(
            offer("competitor", fixture.competitorValue, fixture.competitorPrice, "competitor"),
          );
        }
        const result = simulateEconomics({
          segments: [
            {
              id: "adversarial",
              prospectCount: fixture.prospects,
              fullCatalogValue: fullValue,
              sigma: fixture.sigma,
              offers,
            },
          ],
        });
        expect(Math.abs(result.conservationResidual)).toBeLessThanOrEqual(
          1e-6 * Math.max(1, result.potential),
        );
        if (fixture.withCompetitor) expect(result.competitorLossShare).toBeDefined();
        else expect(result.competitorLossShare).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  // T-ECON-03 @spec §4.3
  it("makes an offer's own choice share weakly decrease when its price rises", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1_000, noNaN: true }),
        fc.double({ min: 0, max: 1_000, noNaN: true }),
        fc.double({ min: 1, max: 1_500, noNaN: true }),
        fc.double({ min: 0, max: 1_500, noNaN: true }),
        fc.double({ min: 0, max: 1_000, noNaN: true }),
        fc.double({ min: 0.05, max: 2, noNaN: true }),
        (targetValue, price, alternativeValue, alternativePrice, increase, sigma) => {
          const before = simulateSegmentEconomics({
            id: "before",
            prospectCount: 1,
            fullCatalogValue: Math.max(targetValue, alternativeValue),
            sigma,
            offers: [
              outside,
              offer("target", targetValue, price),
              offer("alternative", alternativeValue, alternativePrice),
            ],
          });
          const after = simulateSegmentEconomics({
            id: "after",
            prospectCount: 1,
            fullCatalogValue: Math.max(targetValue, alternativeValue),
            sigma,
            offers: [
              outside,
              offer("target", targetValue, price + increase),
              offer("alternative", alternativeValue, alternativePrice),
            ],
          });
          expect(after.selection.shares.target).toBeLessThanOrEqual(
            before.selection.shares.target + 1e-12,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  // T-ECON-04 @spec §4.3
  it("matches independent numerical integration for own-buyer surplus", () => {
    for (const [value, price, sigma] of [
      [100, 40, 0.25],
      [180, 120, 0.7],
      [75, 95, 1.2],
    ]) {
      const result = simulateSegmentEconomics({
        id: `surplus-${value}`,
        prospectCount: 1,
        fullCatalogValue: value,
        sigma,
        offers: [outside, offer("paid", value, price)],
      });
      const expected = numericOwnSurplus(value, price, sigma);
      expect(Math.abs(result.ownBuyerSurplus - expected) / expected).toBeLessThan(1e-6);
    }
  });

  // T-ECON-05 @spec §4.3
  it("leaves every readout unchanged when a zero-share offer is removed", () => {
    const input: { segments: SegmentEconomicsInput[] } = {
      segments: [
        {
          id: "zero-share",
          prospectCount: 500,
          fullCatalogValue: 100,
          sigma: 0.6,
          offers: [outside, offer("better", 100, 30), offer("dominated", 80, 70)],
        },
      ],
    };
    const result = removeOfferCounterfactual(input, "dominated");
    expect(result.mrrChangeWhenRemoved).toBeCloseTo(0, 12);
    expect(result.removedOfferContribution).toBeCloseTo(0, 12);
    expect(result.withoutOffer).toMatchObject({
      mrr: result.baseline.mrr,
      potential: result.baseline.potential,
      ownBuyerSurplus: result.baseline.ownBuyerSurplus,
      fencingGap: result.baseline.fencingGap,
    });
  });

  // T-ECON-06 @spec §4.3
  it("puts free-tier withheld value in fencing and competitor selections only in loss", () => {
    const freeTier = simulateEconomics({
      segments: [
        {
          id: "free",
          prospectCount: 10,
          fullCatalogValue: 100,
          sigma: 0,
          offers: [outside, offer("free", 50, 0)],
        },
      ],
    });
    expect(freeTier.revenue).toBe(0);
    expect(freeTier.ownBuyerSurplus).toBe(500);
    expect(freeTier.fencingGap).toBe(500);
    expect(freeTier.potential).toBe(1_000);
    expect(freeTier.conservationResidual).toBe(0);

    const competitor = simulateEconomics({
      segments: [
        {
          id: "competitor",
          prospectCount: 10,
          fullCatalogValue: 100,
          sigma: 0,
          offers: [outside, offer("own-basic", 50, 100), offer("competitor", 100, 0, "competitor")],
        },
      ],
    });
    expect(competitor.ownBuyerSurplus).toBe(0);
    expect(competitor.competitorLoss).toBe(1_000);
    expect(competitor.competitorLossShare).toBe(1);
    expect(competitor.conservationResidual).toBe(0);
  });
});

describe("tier price sweeps", () => {
  // T-SWP-01 @spec §4.4
  it("includes the exact current price and reproduces its simulated tier demand and revenue", () => {
    const input = basicSweepInput();
    const sweep = sweepTierPrice(input);
    const currentPoint = sweep.points.find(
      (point) => point.price === input.segments[0].offerExpansion.tiers[1].price,
    );
    const source = input.segments[0];
    const expectedSegment = simulateSegmentEconomics({
      id: source.id,
      prospectCount: source.prospectCount,
      fullCatalogValue: 200,
      sigma: source.sigma,
      offers: expandOffers(source.offerExpansion),
    });
    const expected = tierRevenueAndDemand(expectedSegment, "pro");
    expect(currentPoint).toBeDefined();
    expect(currentPoint?.demand).toBeCloseTo(expected.demand, 9);
    expect(currentPoint?.revenue).toBeCloseTo(expected.revenue, 9);
    expect(currentPoint?.totalMrr).toBeCloseTo(expectedSegment.revenue, 9);

    const perSeatSweep = sweepTierPrice({
      tierId: "team",
      segments: [
        {
          id: "per-seat",
          prospectCount: 10,
          sigma: 0,
          selectionOptions: { tieMode: "seller-favorable" },
          offerExpansion: {
            seatCount: 5,
            featureValues: { full: 500 },
            tiers: [
              {
                id: "team",
                name: "Team",
                price: 20,
                priceMetric: "per-seat",
                featureIds: ["full"],
              },
            ],
            includeCompetitors: false,
          },
        },
      ],
    });
    const perSeatCurrentPoint = perSeatSweep.points.find((point) => point.price === 20);
    expect(perSeatCurrentPoint).toMatchObject({ price: 20, demand: 10, revenue: 1_000 });
  });

  // T-SWP-02 @spec §4.4
  it("has weakly decreasing residual demand as the selected tier price rises", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.double({ min: 20, max: 300, noNaN: true }),
        fc.double({ min: 0.1, max: 1.5, noNaN: true }),
        (fullValue, currentPrice, sigma) => {
          const sweep = sweepTierPrice({
            tierId: "pro",
            segments: [
              {
                id: "property",
                prospectCount: 100,
                sigma,
                offerExpansion: {
                  seatCount: 1,
                  featureValues: { full: fullValue },
                  tiers: [
                    {
                      id: "pro",
                      name: "Pro",
                      price: currentPrice,
                      priceMetric: "flat",
                      featureIds: ["full"],
                    },
                  ],
                  includeCompetitors: false,
                },
              },
            ],
          });
          for (let index = 1; index < sweep.points.length; index += 1) {
            expect(sweep.points[index].demand).toBeLessThanOrEqual(
              sweep.points[index - 1].demand + 1e-9,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // T-SWP-03 @spec §4.4
  it("finds the golden single-tier optimum within one grid step", () => {
    const sweep = sweepTierPrice({
      tierId: "pro",
      segments: [
        {
          id: "golden",
          prospectCount: 1_000,
          sigma: 0,
          offerExpansion: {
            seatCount: 1,
            featureValues: { full: 100 },
            tiers: [
              {
                id: "pro",
                name: "Pro",
                price: 35.13,
                priceMetric: "flat",
                featureIds: ["full"],
              },
            ],
            includeCompetitors: false,
          },
          selectionOptions: { tieMode: "seller-favorable" },
        },
      ],
    });
    const gridStep = sweep.searchedUpperBound / 399;
    expect(Math.abs(sweep.bestPoint.price - 100)).toBeLessThanOrEqual(gridStep);
    expect(sweep.bestPoint.revenue).toBe(100_000);
  });

  // T-SWP-04 @spec §4.4
  it("expands beyond the initial bound and labels an exhausted boundary search", () => {
    const expanding = sweepTierPrice({
      tierId: "pro",
      segments: [
        {
          id: "high-spread",
          prospectCount: 1_000,
          sigma: 2,
          offerExpansion: {
            seatCount: 1,
            featureValues: { full: 100 },
            tiers: [
              {
                id: "pro",
                name: "Pro",
                price: 10,
                priceMetric: "flat",
                featureIds: ["full"],
              },
            ],
            includeCompetitors: false,
          },
        },
      ],
    });
    expect(expanding.expansionCount).toBeGreaterThan(0);
    expect(expanding.bestPoint.price).toBeLessThan(expanding.searchedUpperBound);
    expect(expanding.bestInSearchedRange).toBe(false);

    const capped = sweepTierPrice({
      tierId: "pro",
      segments: [
        {
          id: "cap",
          prospectCount: 1,
          sigma: 6,
          offerExpansion: {
            seatCount: 1,
            featureValues: { full: 1 },
            tiers: [
              {
                id: "pro",
                name: "Pro",
                price: 1,
                priceMetric: "flat",
                featureIds: ["full"],
              },
            ],
            includeCompetitors: false,
          },
        },
      ],
    });
    expect(capped.expansionCount).toBe(8);
    expect(capped.bestInSearchedRange).toBe(true);
    expect(capped.bestPoint.price).toBe(capped.searchedUpperBound);
  });
});

describe("screening oracle", () => {
  function screeningInput(lowProspects: number, proPrice: number, onlyPro = false) {
    return {
      segments: [
        {
          id: "low",
          prospectCount: lowProspects,
          fullCatalogValue: 55,
          sigma: 0,
          selectionOptions: { tieMode: "seller-favorable" as const },
          offers: onlyPro
            ? [outside, offer("pro", 55, proPrice)]
            : [outside, offer("basic", 40, 40), offer("pro", 55, proPrice)],
        },
        {
          id: "high",
          prospectCount: 50,
          fullCatalogValue: 100,
          sigma: 0,
          selectionOptions: { tieMode: "seller-favorable" as const },
          offers: onlyPro
            ? [outside, offer("pro", 100, proPrice)]
            : [outside, offer("basic", 60, 40), offer("pro", 100, proPrice)],
        },
      ],
    };
  }

  // T-SCRN-01 @spec §4.5
  it("reproduces the canonical serve-both menu and information rent", () => {
    const result = simulateEconomics(screeningInput(100, 80));
    expect(result.mrr).toBe(8_000);
    expect(result.segments[0].selection.selectedAtMedianId).toBe("basic");
    expect(result.segments[1].selection.selectedAtMedianId).toBe("pro");
    expect(result.segments[0].ownBuyerSurplus).toBe(0);
    expect(result.segments[1].ownBuyerSurplus).toBe(1_000);
  });

  // T-SCRN-02 @spec §4.5
  it("shows high-type cannibalization after a strict Pro price increase", () => {
    const result = simulateEconomics(screeningInput(100, 85));
    expect(result.mrr).toBe(6_000);
    expect(result.segments[1].selection.selectedAtMedianId).toBe("basic");
  });

  // T-SCRN-03 @spec §4.5
  it("reproduces the low-type exclusion result", () => {
    const proOnly = simulateEconomics(screeningInput(10, 100, true));
    const serveBoth = simulateEconomics(screeningInput(10, 80));
    expect(proOnly.mrr).toBe(5_000);
    expect(proOnly.mrr).toBeGreaterThan(serveBoth.mrr);
    expect(proOnly.segments[0].selection.selectedAtMedianId).toBe("outside");
  });

  // T-SCRN-04 @spec §4.5
  it("has no distortion at the top in the optimal menu", () => {
    const result = simulateEconomics(screeningInput(100, 80));
    expect(result.segments[1].selection.selectedAtMedianId).toBe("pro");
  });
});
