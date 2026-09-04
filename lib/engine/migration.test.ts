import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { lintDesign, type DesignLinterInput } from "./linter";
import {
  simulateMigration,
  type MigrationInput,
  type MigrationPolicy,
  type MigrationSegmentInput,
} from "./migration";
import { expandOffers } from "./offers";
import type { EconomicsReadout, ExpandedOffer } from "./types";

/**
 * One legacy plan at $80 for a segment that values the full catalog at $200, against a proposed
 * two-tier menu. The switching cost is what keeps the base where it is.
 */
function proposedMenu(): ExpandedOffer[] {
  return expandOffers({
    seatCount: 1,
    featureValues: { core: 120, advanced: 80 },
    tiers: [
      { id: "starter", name: "Starter", price: 60, priceMetric: "flat", featureIds: ["core"] },
      {
        id: "pro",
        name: "Pro",
        price: 150,
        priceMetric: "flat",
        featureIds: ["core", "advanced"],
      },
    ],
  });
}

function segment(overrides: Partial<MigrationSegmentInput> = {}): MigrationSegmentInput {
  return {
    id: "base",
    name: "Installed base",
    baseCount: 400,
    sigma: 0.35,
    switchingCost: 40,
    incumbent: { id: "legacy", name: "Legacy", value: 120, effectivePrice: 80 },
    proposedOffers: proposedMenu(),
    ...overrides,
  };
}

function run(policy: MigrationPolicy, overrides: Partial<MigrationSegmentInput> = {}) {
  return simulateMigration({ policy, segments: [segment(overrides)] });
}

describe("repricing and migration (@spec §4.18)", () => {
  // T-MIG-01 @spec §4.18
  it("reconciles opening MRR to closing MRR exactly", () => {
    for (const policy of ["grandfather", "forced-at-renewal", "opt-in-with-deadline"] as const) {
      const { bridge, baseCount } = run(policy);
      expect(bridge.openingMrr).toBeCloseTo(400 * 80, 9);
      expect(bridge.expansion).toBeGreaterThanOrEqual(0);
      expect(bridge.contraction).toBeLessThanOrEqual(0);
      expect(bridge.churn).toBeLessThanOrEqual(0);
      expect(Math.abs(bridge.bridgeResidual)).toBeLessThan(1e-9 * Math.max(1, bridge.openingMrr));
      expect(baseCount).toBe(400);
    }
  });

  // T-MIG-02 @spec §4.18
  it("puts the whole base somewhere: the matrix shares sum to one", () => {
    const readout = run("grandfather");
    const totalShare = readout.cells.reduce((total, cell) => total + cell.share, 0);
    const totalAccounts = readout.cells.reduce((total, cell) => total + cell.accounts, 0);
    expect(totalShare).toBeCloseTo(1, 12);
    expect(totalAccounts).toBeCloseTo(400, 9);
    expect(readout.stayShare + readout.churnShare).toBeLessThanOrEqual(1 + 1e-12);
  });

  // T-MIG-03 @spec §4.18
  it("keeps a base on the legacy plan that a forced migration would move or lose", () => {
    const grandfathered = run("grandfather");
    const forced = run("forced-at-renewal");

    expect(grandfathered.stayShare).toBeGreaterThan(0);
    // Withdrawing the legacy plan is the only difference between the two runs.
    expect(forced.stayShare).toBe(0);
    expect(forced.cells.some((cell) => cell.stays)).toBe(false);
    expect(forced.churnShare).toBeGreaterThan(grandfathered.churnShare);
    // The counterfactual the linter reads is the forced run's own closing MRR.
    expect(grandfathered.segments[0].withdrawnIncumbentMrr).toBeCloseTo(
      forced.bridge.closingMrr,
      9,
    );
    expect(forced.segments[0].grandfatherOpportunityCost).toBe(0);
  });

  // T-MIG-04 @spec §4.18
  it("charges the switching cost to the buyer and never books it as revenue", () => {
    const free = run("grandfather", { switchingCost: 0 });
    const sticky = run("grandfather", { switchingCost: 40 });

    // A switching cost can only make staying relatively more attractive.
    expect(sticky.stayShare).toBeGreaterThan(free.stayShare);
    // Revenue is always the destination's own price — never the price the chooser faced.
    for (const cell of sticky.cells) {
      if (cell.accounts === 0 || cell.destinationOfferId === null) continue;
      const perAccount = cell.revenue / cell.accounts;
      expect([0, 60, 80, 150]).toContain(Number(perAccount.toFixed(9)));
    }
  });

  // T-MIG-05 @spec §4.18
  it("treats opt-in-with-deadline as grandfathering plus a disclosed exposure", () => {
    const grandfathered = run("grandfather");
    const optIn = run("opt-in-with-deadline");

    // A rational buyer faces the identical choice set; only the disclosure differs.
    expect(optIn.bridge.closingMrr).toBeCloseTo(grandfathered.bridge.closingMrr, 12);
    expect(optIn.stayShare).toBeCloseTo(grandfathered.stayShare, 12);
    expect(grandfathered.mrrRequiringBuyerAction).toBe(0);
    expect(optIn.mrrRequiringBuyerAction).toBeGreaterThan(0);
    expect(optIn.mrrRequiringBuyerAction).toBeCloseTo(
      optIn.cells.filter((cell) => cell.stays).reduce((total, cell) => total + cell.revenue, 0),
      12,
    );
  });

  // T-MIG-06 @spec §4.18
  it("separates leaving the category from leaving for a competitor", () => {
    const withRival = expandOffers({
      seatCount: 1,
      featureValues: { core: 120, advanced: 80 },
      tiers: [
        {
          id: "pro",
          name: "Pro",
          price: 150,
          priceMetric: "flat",
          featureIds: ["core", "advanced"],
        },
      ],
      competitors: [{ id: "rival", name: "Rival", price: 20, priceMetric: "flat", value: 190 }],
      includeCompetitors: true,
    });
    const readout = simulateMigration({
      policy: "forced-at-renewal",
      segments: [segment({ proposedOffers: withRival })],
    });

    const churnCells = readout.cells.filter((cell) => cell.revenue === 0 && !cell.stays);
    expect(churnCells.some((cell) => cell.destinationOfferId === null)).toBe(true);
    expect(churnCells.some((cell) => cell.destinationOfferId === "competitor:rival")).toBe(true);
    // Both are exits: neither contributes revenue, and both land in the churn movement.
    expect(readout.bridge.churn).toBeLessThan(0);
  });

  // T-MIG-07 @spec §4.18
  it("keeps the bridge exact across random bases, policies, and switching costs", () => {
    const arbitrary = fc.record({
      baseCount: fc.integer({ min: 0, max: 5_000 }),
      sigma: fc.oneof(fc.constant(0), fc.double({ min: 0.05, max: 1.5, noNaN: true })),
      switchingCost: fc.double({ min: 0, max: 300, noNaN: true }),
      incumbentPrice: fc.double({ min: 0, max: 400, noNaN: true }),
      incumbentValue: fc.double({ min: 0, max: 400, noNaN: true }),
      policy: fc.constantFrom<MigrationPolicy>(
        "grandfather",
        "forced-at-renewal",
        "opt-in-with-deadline",
      ),
    });

    fc.assert(
      fc.property(arbitrary, (fixture) => {
        const readout = simulateMigration({
          policy: fixture.policy,
          segments: [
            segment({
              baseCount: fixture.baseCount,
              sigma: fixture.sigma,
              switchingCost: fixture.switchingCost,
              incumbent: {
                id: "legacy",
                name: "Legacy",
                value: fixture.incumbentValue,
                effectivePrice: fixture.incumbentPrice,
              },
            }),
          ],
        });
        const scale = Math.max(1, readout.bridge.openingMrr, readout.bridge.closingMrr);
        expect(Math.abs(readout.bridge.bridgeResidual)).toBeLessThanOrEqual(1e-9 * scale);
        expect(readout.bridge.closingMrr).toBeGreaterThanOrEqual(-1e-9);
        expect(readout.stayShare).toBeGreaterThanOrEqual(0);
        expect(readout.stayShare).toBeLessThanOrEqual(1 + 1e-12);
      }),
      { numRuns: 200 },
    );
  });

  // T-MIG-08 @spec §4.18
  it("rejects an unusable base description", () => {
    const bad = (overrides: Partial<MigrationSegmentInput>): MigrationInput => ({
      policy: "grandfather",
      segments: [segment(overrides)],
    });
    expect(() => simulateMigration(bad({ id: "" }))).toThrow(/non-empty ID/);
    expect(() => simulateMigration(bad({ baseCount: -1 }))).toThrow(RangeError);
    expect(() => simulateMigration(bad({ switchingCost: -1 }))).toThrow(RangeError);
    expect(() => simulateMigration(bad({ sigma: -1 }))).toThrow(RangeError);
    expect(() =>
      simulateMigration(
        bad({ incumbent: { id: "legacy", name: "x", value: -1, effectivePrice: 1 } }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      simulateMigration(
        bad({ incumbent: { id: "legacy", name: "x", value: 1, effectivePrice: -1 } }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      simulateMigration(bad({ incumbent: { id: "", name: "x", value: 1, effectivePrice: 1 } })),
    ).toThrow(RangeError);
    expect(() => simulateMigration({ policy: "grandfather", segments: [] })).toThrow(RangeError);
  });

  // T-MIG-08b @spec §4.18 — the incumbent plan occupies a reserved offer ID in
  // the choice set. A proposed offer that reuses it would collide with the
  // incumbent inside the bridge and silently double-count a cohort, so the
  // collision is refused at the door rather than reconciled afterwards.
  it("rejects a proposed offer that reuses the incumbent's reserved ID", () => {
    // Spelled out rather than imported: `incumbent:<id>` is the reserved-ID
    // format itself, so writing it literally is what makes this a test of the
    // contract instead of a test that the module agrees with itself.
    const reserved = `incumbent:${segment().incumbent.id}`;
    const collide = () =>
      simulateMigration({
        policy: "grandfather",
        segments: [
          segment({
            proposedOffers: [...proposedMenu(), { ...proposedMenu()[0], id: reserved }],
          }),
        ],
      });
    expect(collide).toThrow(RangeError);
  });
});

describe("migration linter rules (@spec §4.18)", () => {
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
    }).map((finding) => finding.id);
  }

  // T-LNT-19 @spec §4.18 — the gate: no base, no M finding.
  it("produces nothing when no migration readout is supplied", () => {
    expect(lint({})).toEqual([]);
  });

  // T-LNT-20 @spec §4.18
  it("flags a stranded legacy cohort only when withdrawing the plan would earn more", () => {
    // A cheap legacy plan against an expensive menu: the base sits still and the vendor pays
    // for it, because the forced counterfactual keeps most of them at a higher price.
    const stranded = simulateMigration({
      policy: "grandfather",
      segments: [
        segment({
          switchingCost: 0,
          incumbent: { id: "legacy", name: "Legacy", value: 200, effectivePrice: 20 },
        }),
      ],
    });
    expect(stranded.segments[0].stayShare).toBeGreaterThan(0.5);
    expect(stranded.segments[0].grandfatherOpportunityCost).toBeGreaterThan(0);
    expect(lint({ migration: stranded })).toContain("M1");

    // The same sticky base costs nothing when withdrawing the plan would only cause churn.
    const worthKeeping = simulateMigration({
      policy: "grandfather",
      segments: [
        segment({
          switchingCost: 400,
          incumbent: { id: "legacy", name: "Legacy", value: 200, effectivePrice: 190 },
        }),
      ],
    });
    expect(worthKeeping.segments[0].grandfatherOpportunityCost).toBeLessThanOrEqual(0);
    expect(lint({ migration: worthKeeping })).not.toContain("M1");
  });

  // T-LNT-21 @spec §4.18
  it("prices a forced migration's churn against what the migration wins elsewhere", () => {
    const forced = simulateMigration({
      policy: "forced-at-renewal",
      segments: [
        segment({
          switchingCost: 120,
          incumbent: { id: "legacy", name: "Legacy", value: 120, effectivePrice: 20 },
        }),
      ],
    });
    expect(forced.churnShare).toBeGreaterThan(0.1);

    const findings = lintDesign({
      features: [],
      tiers: [],
      addOns: [],
      segments: [],
      baseline: noReadout,
      simulate: () => noReadout,
      migration: forced,
    });
    const m2 = findings.find((finding) => finding.id === "M2");
    expect(m2?.severity).toBe("warning");
    expect(m2?.message).toMatch(/no legacy plan to fall back to/);
    expect(m2?.metrics?.churnedMrr ?? 0).toBeGreaterThan(0);
    // A grandfathered base is never flagged as stranded and churning at once by this fixture.
    expect(findings.filter((finding) => finding.id === "M1")).toHaveLength(0);
  });

  // T-LNT-22 @spec §4.18
  it("discloses the opt-in exposure without discounting it by an invented take-up rate", () => {
    const optIn = simulateMigration({ policy: "opt-in-with-deadline", segments: [segment()] });
    const findings = lintDesign({
      features: [],
      tiers: [],
      addOns: [],
      segments: [],
      baseline: noReadout,
      simulate: () => noReadout,
      migration: optIn,
    });
    const m3 = findings.find((finding) => finding.id === "M3");
    expect(m3?.severity).toBe("info");
    expect(m3?.message).toMatch(/ceiling rather than the forecast/);
    expect(m3?.metrics?.mrrRequiringBuyerAction).toBeCloseTo(optIn.mrrRequiringBuyerAction, 12);

    // The same base under grandfathering has no deadline and therefore no exposure.
    expect(
      lint({ migration: simulateMigration({ policy: "grandfather", segments: [segment()] }) }),
    ).not.toContain("M3");
  });
});
