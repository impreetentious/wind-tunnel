import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { evaluateDiscountPolicy, type DiscountInput, type DiscountPolicy } from "./discount";
import { lintDesign, type DesignLinterInput } from "./linter";
import { expandOffers } from "./offers";
import type { EconomicsReadout } from "./types";

/**
 * Good / Better / Best over a $300 catalog. Better at $120 screens the middle of the segment;
 * Best at $260 screens its top. A permitted floor on Better is what puts that screen at risk.
 */
function menu(seatCount = 1) {
  return expandOffers({
    seatCount,
    featureValues: { core: 120, team: 80, governance: 100 },
    tiers: [
      { id: "good", name: "Good", price: 40, priceMetric: "flat", featureIds: ["core"] },
      {
        id: "better",
        name: "Better",
        price: 120,
        priceMetric: "flat",
        featureIds: ["core", "team"],
      },
      {
        id: "best",
        name: "Best",
        price: 260,
        priceMetric: "flat",
        featureIds: ["core", "team", "governance"],
      },
    ],
  });
}

function input(policies: readonly DiscountPolicy[], sigma = 0.4): DiscountInput {
  return {
    segments: [
      {
        id: "midmarket",
        name: "Midmarket",
        prospectCount: 1_000,
        sigma,
        listOffers: menu(),
      },
    ],
    policies,
  };
}

describe("discount-policy leakage (@spec §4.19)", () => {
  // T-DSC-01 @spec §4.19
  it("leaves the list menu untouched when no discount is permitted or granted", () => {
    const none = evaluateDiscountPolicy(input([]));
    expect(none.discountLeakage).toBe(0);
    expect(none.achievedMrr).toBeCloseTo(none.listMrr, 12);
    expect(none.fenceErosions).toHaveLength(0);
    expect(none.segments[0].cohorts).toEqual([{ tierId: null, weight: 1, mrr: none.listMrr }]);

    // A permitted floor nobody reaches costs nothing either.
    const unused = evaluateDiscountPolicy(
      input([{ tierId: "better", floorFraction: 0.2, hitRateBySegment: { midmarket: 0 } }]),
    );
    expect(unused.discountLeakage).toBeCloseTo(0, 9);
    expect(unused.segments[0].discountedShare).toBe(0);
  });

  // T-DSC-02 @spec §4.19
  it("prices the leakage through the choice model rather than by multiplying it out", () => {
    const policy: DiscountPolicy = {
      tierId: "better",
      floorFraction: 0.25,
      hitRateBySegment: { midmarket: 0.5 },
    };
    const readout = evaluateDiscountPolicy(input([policy]));
    const segment = readout.segments[0];

    expect(segment.discountedShare).toBe(0.5);
    expect(segment.cohorts.map((cohort) => cohort.tierId)).toEqual([null, "better"]);
    expect(segment.cohorts.reduce((total, cohort) => total + cohort.weight, 0)).toBeCloseTo(1, 12);
    expect(segment.cohorts.reduce((total, cohort) => total + cohort.mrr, 0)).toBeCloseTo(
      segment.achievedMrr,
      9,
    );
    expect(segment.discountLeakage).toBeCloseTo(segment.listMrr - segment.achievedMrr, 12);

    // The naive figure — half the deals, a quarter off Better's list price — is not the answer,
    // because at $90 some buyers who took Good move up to Better instead.
    const naive = 0.5 * 0.25 * 120 * 1_000;
    expect(segment.discountLeakage).not.toBeCloseTo(naive, 0);
    expect(segment.discountLeakage).toBeGreaterThan(0);
    expect(segment.discountLeakage).toBeLessThan(naive);
  });

  // T-DSC-03 @spec §4.19
  it("detects a floor that flips the segment's top decile off the tier built for it", () => {
    // At list the P90 buyer takes Best. A shallow floor on Better leaves that intact; a deep
    // one pulls the top decile down onto the discounted tier.
    const shallow = evaluateDiscountPolicy(
      input([{ tierId: "better", floorFraction: 0.1, hitRateBySegment: { midmarket: 1 } }]),
    );
    expect(shallow.fenceErosions).toHaveLength(0);

    const deep = evaluateDiscountPolicy(
      input([
        {
          tierId: "better",
          floorFraction: 0.9,
          hitRateBySegment: { midmarket: 1 },
          approvalBands: [
            { upToFraction: 0.15, approver: "Account executive" },
            { upToFraction: 0.95, approver: "VP Sales" },
          ],
        },
      ]),
    );
    expect(deep.fenceErosions).toHaveLength(1);
    const [erosion] = deep.fenceErosions;
    expect(erosion.discountedTierId).toBe("better");
    expect(erosion.erodedTierId).toBe("best");
    expect(erosion.shareAtList).toBeGreaterThan(0);
    expect(erosion.mrrAtRisk).toBeGreaterThan(0);
    // The approver named is the one who signs for the *permitted* depth, not the shallowest band.
    expect(erosion.approver).toBe("VP Sales");
  });

  // T-DSC-04 @spec §4.19
  it("checks erosion at the permitted floor even when nobody is expected to reach it", () => {
    // Erosion is a property of the policy: a floor that un-fences the menu does so on the
    // first deal that gets there, whatever the hit rate says.
    const readout = evaluateDiscountPolicy(
      input([{ tierId: "better", floorFraction: 0.9, hitRateBySegment: { midmarket: 0 } }]),
    );
    expect(readout.fenceErosions).toHaveLength(1);
    expect(readout.discountLeakage).toBeCloseTo(0, 9);
  });

  // T-DSC-05 @spec §4.19
  it("never reports a cheaper tier as eroded by a discount on a richer one", () => {
    const readout = evaluateDiscountPolicy(
      input([{ tierId: "best", floorFraction: 0.9, hitRateBySegment: { midmarket: 1 } }]),
    );
    // Discounting Best can absolutely take share from Good and Better; that is the menu
    // working, not a fence breaking. Erosion is only reported for a *higher-value* tier.
    for (const erosion of readout.fenceErosions) {
      expect(erosion.discountedTierId).toBe("best");
      expect(["good", "better"]).not.toContain(erosion.erodedTierId);
    }
  });

  // T-DSC-06 @spec §4.19
  it("discounts a tier without discounting the add-ons bolted onto it", () => {
    const withAddOn = expandOffers({
      seatCount: 1,
      featureValues: { core: 120, team: 80, extra: 60 },
      tiers: [
        {
          id: "better",
          name: "Better",
          price: 120,
          priceMetric: "flat",
          featureIds: ["core", "team"],
        },
      ],
      addOns: [
        { id: "extra", name: "Extra", price: 50, priceMetric: "flat", featureIds: ["extra"] },
      ],
    });
    const readout = evaluateDiscountPolicy({
      segments: [{ id: "s", name: "S", prospectCount: 100, sigma: 0, listOffers: withAddOn }],
      policies: [{ tierId: "better", floorFraction: 0.5, hitRateBySegment: { s: 1 } }],
    });

    // $60 comes off the tier line. The composite drops by the same $60, not by half of $170.
    expect(readout.segments[0].achievedMrr).toBeGreaterThan(0);
    const composite = withAddOn.find((offer) => (offer.addOnIds?.length ?? 0) === 1);
    expect(composite?.effectivePrice).toBe(170);
    expect(readout.segments[0].listMrr - readout.segments[0].achievedMrr).toBeCloseTo(60 * 100, 6);
  });

  // T-DSC-07 @spec §4.19
  it("keeps the cohort weights a partition and leakage bounded on random policies", () => {
    const arbitrary = fc.record({
      betterFloor: fc.double({ min: 0, max: 1, noNaN: true }),
      bestFloor: fc.double({ min: 0, max: 1, noNaN: true }),
      betterRate: fc.double({ min: 0, max: 0.5, noNaN: true }),
      bestRate: fc.double({ min: 0, max: 0.5, noNaN: true }),
      sigma: fc.oneof(fc.constant(0), fc.double({ min: 0.05, max: 1.5, noNaN: true })),
    });

    fc.assert(
      fc.property(arbitrary, (fixture) => {
        const readout = evaluateDiscountPolicy(
          input(
            [
              {
                tierId: "better",
                floorFraction: fixture.betterFloor,
                hitRateBySegment: { midmarket: fixture.betterRate },
              },
              {
                tierId: "best",
                floorFraction: fixture.bestFloor,
                hitRateBySegment: { midmarket: fixture.bestRate },
              },
            ],
            fixture.sigma,
          ),
        );
        const segment = readout.segments[0];
        const weight = segment.cohorts.reduce((total, cohort) => total + cohort.weight, 0);
        expect(weight).toBeCloseTo(1, 9);
        expect(segment.cohorts.reduce((total, cohort) => total + cohort.mrr, 0)).toBeCloseTo(
          segment.achievedMrr,
          6,
        );
        expect(segment.achievedMrr).toBeGreaterThanOrEqual(-1e-9);
        // A discount can move buyers up a tier, so achieved MRR is not bounded above by list —
        // but leakage can never exceed the whole of list MRR.
        expect(segment.discountLeakage).toBeLessThanOrEqual(segment.listMrr + 1e-9);
      }),
      { numRuns: 200 },
    );
  });

  // T-DSC-08 @spec §4.19
  it("rejects a policy that cannot be honored", () => {
    expect(() => evaluateDiscountPolicy(input([{ tierId: "better", floorFraction: 1.5 }]))).toThrow(
      RangeError,
    );
    expect(() =>
      evaluateDiscountPolicy(
        input([{ tierId: "better", floorFraction: 0.2, hitRateBySegment: { midmarket: 1.2 } }]),
      ),
    ).toThrow(RangeError);
    expect(() =>
      evaluateDiscountPolicy(
        input([
          { tierId: "better", floorFraction: 0.2 },
          { tierId: "better", floorFraction: 0.3 },
        ]),
      ),
    ).toThrow(RangeError);
    // A deal cannot be discounted on more of the menu than there is.
    expect(() =>
      evaluateDiscountPolicy(
        input([
          { tierId: "better", floorFraction: 0.2, hitRateBySegment: { midmarket: 0.7 } },
          { tierId: "best", floorFraction: 0.2, hitRateBySegment: { midmarket: 0.7 } },
        ]),
      ),
    ).toThrow(RangeError);
  });

  // T-DSC-08c @spec §4.19 — a competitor offer belongs in the choice set, because
  // it changes which of our tiers a buyer picks, but it is not our revenue. It
  // must contribute no MRR and no tier share to the readout, or discount leakage
  // would be measured against a base that includes the competition's price.
  it("counts competitor offers in the choice set but never in our MRR or tier shares", () => {
    const withRival = (): DiscountInput => ({
      segments: [
        {
          id: "midmarket",
          name: "Midmarket",
          prospectCount: 1_000,
          sigma: 0.4,
          listOffers: expandOffers({
            seatCount: 1,
            featureValues: { core: 120, team: 80, governance: 100 },
            tiers: [
              { id: "good", name: "Good", price: 40, priceMetric: "flat", featureIds: ["core"] },
              {
                id: "better",
                name: "Better",
                price: 120,
                priceMetric: "flat",
                featureIds: ["core", "team"],
              },
            ],
            competitors: [
              { id: "rival", name: "Rival", price: 90, priceMetric: "flat", value: 190 },
            ],
            includeCompetitors: true,
          }),
        },
      ],
      policies: [{ tierId: "better", floorFraction: 0.2, hitRateBySegment: { midmarket: 0.5 } }],
    });

    const readout = evaluateDiscountPolicy(withRival());
    const cohortTiers = readout.segments[0].cohorts.map((cohort) => cohort.tierId);

    // The rival is present in the menu the buyer chooses from...
    expect(readout.segments[0].listMrr).toBeGreaterThan(0);
    // ...but never appears as one of our tiers, and never earns us MRR.
    expect(cohortTiers).not.toContain("rival");
    // Achieved MRR is deliberately not bounded above by list here: a discount
    // both moves buyers up a tier and wins buyers back from the rival, so it can
    // exceed list. Leakage is the bounded quantity — it can never exceed the
    // whole of list MRR, which is the same invariant the property test pins.
    expect(readout.achievedMrr).toBeGreaterThan(0);
    expect(readout.discountLeakage).toBeLessThanOrEqual(readout.listMrr + 1e-9);
  });

  // T-DSC-08b @spec §4.19 — the segment side of the same contract. A policy is
  // only meaningful against a population, so a segment whose prospect count is
  // negative or non-finite is rejected rather than silently weighted to zero,
  // which would make leakage look like a real result computed over nobody.
  it("rejects a segment whose prospect count is not a finite, non-negative number", () => {
    const withCount = (prospectCount: number) => ({
      ...input([]),
      segments: [{ ...input([]).segments[0], prospectCount }],
    });
    expect(() => evaluateDiscountPolicy(withCount(-1))).toThrow(RangeError);
    expect(() => evaluateDiscountPolicy(withCount(Number.NaN))).toThrow(RangeError);
    expect(() => evaluateDiscountPolicy(withCount(Number.POSITIVE_INFINITY))).toThrow(RangeError);
    expect(() => evaluateDiscountPolicy(withCount(0))).not.toThrow();
  });

  // T-DSC-09 @spec §4.19
  it("ignores a policy on a tier this segment's menu does not contain", () => {
    const readout = evaluateDiscountPolicy(input([{ tierId: "ghost", floorFraction: 0.5 }]));
    expect(readout.discountLeakage).toBeCloseTo(0, 9);
    expect(readout.fenceErosions).toHaveLength(0);
  });
});

describe("discount linter rules (@spec §4.19)", () => {
  const noReadout: EconomicsReadout = {
    segments: [],
    mrr: 0,
    revenue: 0,
    ownBuyerSurplus: 0,
    fencingGap: 0,
    unserved: 0,
    competitorLoss: 0,
    potential: 0,
    conservationResidual: 0,
    totalProspects: 0,
    paidBuyers: 0,
    ownBuyers: 0,
    competitorBuyers: 0,
    paidConversion: 0,
    arpa: 0,
    captureRate: 0,
  };

  function lint(overrides: Partial<DesignLinterInput>) {
    return lintDesign({
      features: [],
      tiers: [],
      addOns: [],
      segments: [],
      baseline: noReadout,
      simulate: () => noReadout,
      ...overrides,
    });
  }

  // T-LNT-23 @spec §4.19 — the gate: no policy, no P finding.
  it("produces nothing when no discount readout is supplied", () => {
    expect(lint({})).toEqual([]);
  });

  // T-LNT-24 @spec §4.19
  it("names the tier, the segment, and the approver when a floor un-fences the menu", () => {
    const discount = evaluateDiscountPolicy(
      input([
        {
          tierId: "better",
          floorFraction: 0.9,
          hitRateBySegment: { midmarket: 1 },
          approvalBands: [{ upToFraction: 0.95, approver: "VP Sales" }],
        },
      ]),
    );
    const p1 = lint({ discount }).find((finding) => finding.id === "P1");
    expect(p1?.severity).toBe("warning");
    expect(p1?.message).toMatch(/makes it beat Best for Midmarket's top decile/);
    expect(p1?.message).toMatch(/VP Sales can authorize that depth/);
    expect(p1?.segmentIds).toEqual(["midmarket"]);
  });

  // T-LNT-25 @spec §4.19
  it("reports material leakage in dollars and stays quiet on an immaterial policy", () => {
    const material = evaluateDiscountPolicy(
      input([{ tierId: "better", floorFraction: 0.6, hitRateBySegment: { midmarket: 0.8 } }]),
    );
    expect(material.discountLeakageShare).toBeGreaterThan(0.1);
    const p2 = lint({ discount: material }).find((finding) => finding.id === "P2");
    expect(p2?.severity).toBe("warning");
    expect(p2?.metrics?.discountLeakage).toBeCloseTo(material.discountLeakage, 9);

    const slight = evaluateDiscountPolicy(
      input([{ tierId: "better", floorFraction: 0.05, hitRateBySegment: { midmarket: 0.1 } }]),
    );
    expect(slight.discountLeakageShare).toBeLessThan(0.1);
    expect(lint({ discount: slight }).filter((finding) => finding.id === "P2")).toHaveLength(0);
  });
});
