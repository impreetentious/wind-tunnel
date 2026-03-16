import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  allowanceDeadZones,
  evaluateCreditPack,
  summarizeHybridCost,
  type CreditPack,
} from "./credits";
import { simulateEconomics } from "./economics";
import { expandOffers } from "./offers";
import type { UsageBand } from "./usage";

const band: UsageBand = { p10: 5_000, p50: 10_000, p90: 20_000 };

function pack(overrides: Partial<CreditPack> = {}): CreditPack {
  return { metricId: "calls", packUnits: 10_000, packPrice: 500, ...overrides };
}

describe("credit packs and breakage (@spec §4.17)", () => {
  // T-CRD-01 @spec §4.17
  it("splits a pack into the units the buyer spends and the units they forfeit", () => {
    const readout = evaluateCreditPack(pack(), band);
    const spent = readout.packUnits - readout.expectedUnusedUnits;

    expect(spent + readout.expectedUnusedUnits).toBeCloseTo(readout.packUnits, 9);
    expect(readout.utilisation).toBeCloseTo(spent / readout.packUnits, 12);
    expect(readout.utilisation).toBeGreaterThan(0);
    expect(readout.utilisation).toBeLessThan(1);
    expect(readout.impliedUnitPrice).toBeCloseTo(500 / 10_000, 12);
    expect(readout.expectedBreakageRevenue).toBeCloseTo(
      readout.expectedUnusedUnits * readout.impliedUnitPrice,
      9,
    );
    // Breakage is a slice of the pack price, never more than the whole of it.
    expect(readout.expectedBreakageRevenue).toBeLessThanOrEqual(readout.packPrice);
  });

  // T-CRD-02 @spec §4.17
  it("reports no breakage on a pack that rolls over, because the units are still owed", () => {
    const expiring = evaluateCreditPack(pack(), band);
    const rolling = evaluateCreditPack(pack({ expiresAtPeriodEnd: false }), band);

    expect(expiring.expectedBreakageRevenue).toBeGreaterThan(0);
    expect(rolling.expectedBreakageRevenue).toBe(0);
    expect(rolling.expectedUnusedUnits).toBe(0);
    // Rolling over changes what the vendor may call revenue, not what the buyer consumes.
    expect(rolling.expectedOverageUnits).toBeCloseTo(expiring.expectedOverageUnits, 12);
    expect(rolling.probabilityOfOverage).toBeCloseTo(expiring.probabilityOfOverage, 12);
  });

  // T-CRD-03 @spec §4.17
  it("makes a pack far above P90 nearly all breakage and one far below P10 nearly all overage", () => {
    const oversized = evaluateCreditPack(pack({ packUnits: 400_000, packPrice: 20_000 }), band);
    const undersized = evaluateCreditPack(
      pack({ packUnits: 200, packPrice: 10, overagePerUnit: 0.05 }),
      band,
    );

    expect(oversized.utilisation).toBeLessThan(0.05);
    expect(oversized.probabilityOfOverage).toBeLessThan(0.001);
    expect(oversized.expectedOverageUnits).toBeLessThan(1);

    expect(undersized.utilisation).toBeGreaterThan(0.99);
    expect(undersized.probabilityOfOverage).toBeGreaterThan(0.99);
    expect(undersized.expectedBreakageRevenue).toBeLessThan(0.01);
    // Everything past a tiny pack is overage, so the expected bill is dominated by it.
    expect(undersized.expectedOverageUnits).toBeGreaterThan(9_000);
    expect(undersized.expectedBuyerCost).toBeGreaterThan(undersized.packPrice * 10);
  });

  // T-CRD-04 @spec §4.17
  it("flags the overage cliff only when the rate past the pack beats the rate inside it", () => {
    const cliff = evaluateCreditPack(pack({ overagePerUnit: 0.2 }), band);
    const flat = evaluateCreditPack(pack({ overagePerUnit: 0.05 }), band);
    const cheaper = evaluateCreditPack(pack({ overagePerUnit: 0.01 }), band);

    expect(cliff.overageCliff).toBe(true);
    // Exactly the pack's own implied unit price is not a cliff.
    expect(flat.impliedUnitPrice).toBeCloseTo(0.05, 12);
    expect(flat.overageCliff).toBe(false);
    expect(cheaper.overageCliff).toBe(false);
  });

  // T-CRD-05 @spec §4.17
  it("keeps utilisation inside [0, 1] and the unit identity exact on random packs and bands", () => {
    const arbitrary = fc.record({
      p10: fc.double({ min: 1, max: 5_000, noNaN: true }),
      spread: fc.double({ min: 1, max: 40, noNaN: true }),
      packUnits: fc.double({ min: 1, max: 500_000, noNaN: true }),
      packPrice: fc.double({ min: 0, max: 50_000, noNaN: true }),
      overagePerUnit: fc.double({ min: 0, max: 10, noNaN: true }),
    });

    fc.assert(
      fc.property(arbitrary, (fixture) => {
        const p10 = fixture.p10;
        const p90 = p10 * fixture.spread;
        const readout = evaluateCreditPack(
          {
            metricId: "calls",
            packUnits: fixture.packUnits,
            packPrice: fixture.packPrice,
            overagePerUnit: fixture.overagePerUnit,
          },
          { p10, p50: Math.sqrt(p10 * p90), p90 },
        );

        expect(readout.utilisation).toBeGreaterThanOrEqual(0);
        expect(readout.utilisation).toBeLessThanOrEqual(1);
        expect(readout.probabilityOfOverage).toBeGreaterThanOrEqual(0);
        expect(readout.probabilityOfOverage).toBeLessThanOrEqual(1);
        expect(readout.expectedUnusedUnits).toBeGreaterThanOrEqual(0);
        expect(readout.expectedOverageUnits).toBeGreaterThanOrEqual(0);
        expect(readout.expectedUnusedUnits).toBeLessThanOrEqual(
          readout.packUnits * (1 + 1e-9) + 1e-9,
        );
        expect(readout.expectedBreakageRevenue).toBeLessThanOrEqual(
          readout.packPrice * (1 + 1e-9) + 1e-9,
        );
      }),
      { numRuns: 200 },
    );
  });

  // T-CRD-06 @spec §4.17
  it("degenerates to a point estimate rather than throwing when a band has no lognormal fit", () => {
    // P10 = 0 makes log 0 undefined; the band falls back to a point mass at P50.
    const zeroFloor = evaluateCreditPack(pack({ packUnits: 20_000 }), {
      p10: 0,
      p50: 10_000,
      p90: 40_000,
    });
    expect(zeroFloor.expectedUnusedUnits).toBeCloseTo(10_000, 6);
    expect(zeroFloor.probabilityOfOverage).toBe(0);

    // A segment expected to consume nothing forfeits the entire pack.
    const noUsage = evaluateCreditPack(pack(), { p10: 0, p50: 0, p90: 0 });
    expect(noUsage.utilisation).toBe(0);
    expect(noUsage.expectedUnusedUnits).toBe(10_000);
    expect(noUsage.expectedBreakageRevenue).toBeCloseTo(500, 9);
    expect(noUsage.expectedOverageUnits).toBe(0);
  });

  // T-CRD-07 @spec §4.17
  it("rejects a pack that cannot be priced", () => {
    expect(() => evaluateCreditPack(pack({ packUnits: 0 }), band)).toThrow(RangeError);
    expect(() => evaluateCreditPack(pack({ packPrice: -1 }), band)).toThrow(RangeError);
    expect(() => evaluateCreditPack(pack({ overagePerUnit: -1 }), band)).toThrow(RangeError);
  });
});

describe("hybrid cost summary (@spec §4.17)", () => {
  // T-CRD-08 @spec §4.17
  it("totals the packs and keeps breakage separable from overage", () => {
    const packs = [
      pack({ overagePerUnit: 0.2 }),
      pack({ metricId: "gb", packUnits: 500, packPrice: 250, overagePerUnit: 1 }),
    ];
    const summary = summarizeHybridCost({
      creditPacks: packs,
      usageBands: { calls: band, gb: { p10: 100, p50: 200, p90: 400 } },
    });

    expect(summary.packs).toHaveLength(2);
    expect(summary.expectedSurcharge).toBeCloseTo(
      summary.packs.reduce((total, entry) => total + entry.expectedBuyerCost, 0),
      12,
    );
    // The two components are reported apart because only one has delivery behind it.
    expect(summary.expectedBreakageRevenue).toBeGreaterThan(0);
    expect(summary.expectedOverageRevenue).toBeGreaterThan(0);
    expect(summary.expectedBreakageRevenue).toBeLessThan(summary.expectedSurcharge);
  });

  // T-CRD-09 @spec §4.17
  it("treats a pack on an unbanded metric as inert instead of throwing", () => {
    const summary = summarizeHybridCost({ creditPacks: [pack()], usageBands: {} });
    expect(summary.packs).toHaveLength(0);
    expect(summary.expectedSurcharge).toBe(0);
    expect(summary.expectedBreakageRevenue).toBe(0);
  });
});

describe("allowance dead zones (@spec §4.17)", () => {
  // T-CRD-10 @spec §4.17
  it("reports an allowance the segment never reaches and stays quiet on one that binds", () => {
    const zones = allowanceDeadZones(
      [
        { metricId: "calls", perUnitPrice: 0.01, includedUnits: 500_000 },
        { metricId: "calls", perUnitPrice: 0.01, includedUnits: 8_000 },
        { metricId: "calls", perUnitPrice: 0.01 },
        { metricId: "absent", perUnitPrice: 0.01, includedUnits: 500_000 },
      ],
      { calls: band },
    );

    expect(zones).toHaveLength(1);
    expect(zones[0].includedUnits).toBe(500_000);
    expect(zones[0].probabilityOfExceeding).toBeLessThan(0.05);
  });
});

describe("packs through the offer envelope (@spec §4.17)", () => {
  const usageBands = { calls: band };
  const expansion = {
    seatCount: 10,
    featureValues: { core: 400 },
    usageBands,
    tiers: [
      {
        id: "metered",
        name: "Metered",
        price: 40,
        priceMetric: "per-seat" as const,
        featureIds: ["core"],
        creditPacks: [pack({ overagePerUnit: 0.2 })],
      },
    ],
  };

  // T-CRD-11 @spec §4.17
  it("folds the expected pack bill into effectivePrice and labels the breakage inside it", () => {
    const withPacks = expandOffers(expansion);
    const withoutPacks = expandOffers({
      ...expansion,
      tiers: [{ ...expansion.tiers[0], creditPacks: undefined }],
    });

    const metered = withPacks.find((offer) => offer.tierId === "metered");
    const plain = withoutPacks.find((offer) => offer.tierId === "metered");
    const expected = summarizeHybridCost({
      creditPacks: expansion.tiers[0].creditPacks,
      usageBands,
    });

    expect(plain?.effectivePrice).toBe(400);
    expect(metered?.effectivePrice).toBeCloseTo(400 + expected.expectedSurcharge, 9);
    expect(metered?.breakageRevenue).toBeCloseTo(expected.expectedBreakageRevenue, 12);
    // The pack surcharge is account-level, exactly like a §4.15 usage line: it does not
    // multiply by the seat count the way the base per-seat price does.
    expect(metered!.effectivePrice - plain!.effectivePrice).toBeCloseTo(
      expected.expectedSurcharge,
      9,
    );
    // An offer with no pack carries no breakage key at all, so nothing pre-extension moves.
    expect(plain).not.toHaveProperty("breakageRevenue");
  });

  // T-CRD-12 @spec §4.17
  it("discloses breakage beside the waterfall without disturbing the §4.3 identity", () => {
    const simulate = (offers: ReturnType<typeof expandOffers>) =>
      simulateEconomics({
        segments: [{ id: "core", prospectCount: 500, fullCatalogValue: 400, sigma: 0.4, offers }],
      });

    const withPacks = simulate(expandOffers(expansion));
    const withoutPacks = simulate(
      expandOffers({ ...expansion, tiers: [{ ...expansion.tiers[0], creditPacks: undefined }] }),
    );

    expect(Math.abs(withPacks.conservationResidual)).toBeLessThanOrEqual(
      1e-9 * withPacks.potential,
    );
    expect(withPacks.breakageRevenue).toBeGreaterThan(0);
    // Breakage is a slice of revenue, not an addition to it.
    expect(withPacks.breakageRevenue).toBeLessThan(withPacks.revenue);
    // The absent key is the pre-extension contract: no pack, no disclosure, no golden movement.
    expect(withoutPacks.breakageRevenue).toBeUndefined();
    expect(withoutPacks.segments[0].breakageRevenue).toBeUndefined();
  });
});
