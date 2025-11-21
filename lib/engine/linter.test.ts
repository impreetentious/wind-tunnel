import { describe, expect, it } from "vitest";

import { simulateEconomics } from "./economics";
import { lintDesign, type DesignLinterInput, type LinterTier } from "./linter";
import { expandOffers } from "./offers";
import type { EconomicsReadout, SegmentEconomicsReadout } from "./types";

const features = [
  { id: "a", name: "Workflow" },
  { id: "b", name: "Automation" },
];

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

function readoutWith(segment: SegmentEconomicsReadout, overrides: Partial<EconomicsReadout> = {}) {
  return {
    ...noReadout,
    segments: [segment],
    totalProspects: segment.prospectCount,
    paidBuyers: segment.ownPaidBuyers,
    ownBuyers: segment.ownBuyers,
    competitorBuyers: segment.competitorBuyers,
    mrr: segment.revenue,
    revenue: segment.revenue,
    ownBuyerSurplus: segment.ownBuyerSurplus,
    fencingGap: segment.fencingGap,
    unserved: segment.unserved,
    competitorLoss: segment.competitorLoss,
    potential: segment.potential,
    conservationResidual: segment.conservationResidual,
    paidConversion: segment.prospectCount === 0 ? 0 : segment.ownPaidBuyers / segment.prospectCount,
    arpa: segment.ownPaidBuyers === 0 ? 0 : segment.revenue / segment.ownPaidBuyers,
    captureRate: segment.potential === 0 ? 0 : segment.revenue / segment.potential,
    ...overrides,
  };
}

function menuInput(
  tiers: readonly LinterTier[],
  addOns: DesignLinterInput["addOns"] = [],
): DesignLinterInput {
  const simulate = (menu: { tiers: readonly LinterTier[]; addOns: DesignLinterInput["addOns"] }) =>
    simulateEconomics({
      segments: [
        {
          id: "segment",
          prospectCount: 1_000,
          fullCatalogValue: 200,
          sigma: 0.2,
          offers: expandOffers({
            seatCount: 1,
            featureValues: { a: 100, b: 100 },
            tiers: menu.tiers,
            addOns: menu.addOns,
          }),
        },
      ],
    });
  return {
    features,
    tiers,
    addOns,
    segments: [{ id: "segment", name: "Core segment", seatCount: 1 }],
    baseline: simulate({ tiers, addOns }),
    simulate,
  };
}

function directInput(overrides: Partial<DesignLinterInput>): DesignLinterInput {
  return {
    features: [],
    tiers: [],
    addOns: [],
    segments: [],
    baseline: noReadout,
    simulate: () => noReadout,
    ...overrides,
  };
}

function ids(input: DesignLinterInput) {
  return lintDesign(input).map((finding) => finding.id);
}

describe("P5 deterministic design linter", () => {
  // @spec §4.9
  it("T-LNT-01 flags a dead fence and nothing else", () => {
    expect(
      ids(
        directInput({
          features: [{ id: "core", name: "Core feature" }],
          tiers: [
            { id: "free", name: "Free", price: 0, priceMetric: "flat", featureIds: ["core"] },
            { id: "paid", name: "Paid", price: 20, priceMetric: "flat", featureIds: ["core"] },
          ],
        }),
      ),
    ).toEqual(["E1"]);
  });

  // @spec §4.9
  it("T-LNT-02 flags a dominated tier with per-segment detail", () => {
    const segment: SegmentEconomicsReadout = {
      id: "segment",
      prospectCount: 100,
      fullCatalogValue: 100,
      sigma: 0,
      selection: {
        offers: [
          {
            id: "tier:inert",
            name: "Inert",
            owner: "own",
            kind: "tier",
            value: 100,
            effectivePrice: 20,
            featureIds: [],
            tierId: "inert",
          },
        ],
        active: [],
        shares: { "tier:inert": 0 },
        tieMode: "conservative",
      },
      revenue: 0,
      ownBuyerSurplus: 0,
      fencingGap: 0,
      unserved: 0,
      competitorLoss: 0,
      potential: 100,
      conservationResidual: 0,
      ownPaidBuyers: 0,
      ownBuyers: 0,
      competitorBuyers: 0,
    };
    const findings = lintDesign(
      directInput({
        tiers: [{ id: "inert", name: "Inert", price: 20, priceMetric: "flat", featureIds: [] }],
        segments: [{ id: "segment", name: "Segment", seatCount: 1 }],
        baseline: readoutWith(segment),
      }),
    );
    expect(findings.map((finding) => finding.id)).toEqual(["E2"]);
    expect(findings[0].segmentIds).toEqual(["segment"]);
  });

  // @spec §4.9
  it("T-LNT-03 flags a fence inversion and nothing else", () => {
    expect(
      ids(
        directInput({
          features,
          tiers: [
            { id: "lower", name: "Lower", price: 20, priceMetric: "flat", featureIds: ["a"] },
            { id: "higher", name: "Higher", price: 40, priceMetric: "flat", featureIds: ["b"] },
          ],
          segments: [{ id: "segment", name: "Segment", seatCount: 1 }],
        }),
      ),
    ).toEqual(["E3"]);
  });

  // @spec §4.9
  it("T-LNT-04 flags downgrade mass above the documented 30% threshold", () => {
    const input = menuInput(
      [
        { id: "basic", name: "Basic", price: 10, priceMetric: "flat", featureIds: ["a"] },
        { id: "pro", name: "Pro", price: 130, priceMetric: "flat", featureIds: ["a", "b"] },
      ],
      [
        {
          id: "automation",
          name: "Automation",
          price: 200,
          priceMetric: "flat",
          featureIds: ["b"],
        },
      ],
    );
    const findings = lintDesign(input);
    expect(findings.map((finding) => finding.id)).toEqual(["E4"]);
    expect(findings[0].metrics?.shareOfBuyers).toBeGreaterThan(0.3);
  });

  // @spec §4.9
  it("T-LNT-05 uses the free-tier counterfactual MRR difference", () => {
    const baseline = { ...noReadout, mrr: 100, revenue: 100, paidBuyers: 100 };
    const findings = lintDesign(
      directInput({
        tiers: [
          { id: "free", name: "Free", price: 0, priceMetric: "flat", featureIds: [] },
          { id: "paid", name: "Paid", price: 20, priceMetric: "flat", featureIds: [] },
        ],
        baseline,
        simulate: () => ({ ...baseline, mrr: 130, revenue: 130, paidBuyers: 120 }),
      }),
    );
    expect(findings.map((finding) => finding.id)).toEqual(["E5"]);
    expect(findings[0].metrics).toMatchObject({ absorbedShare: 1 / 6, recoveredMrr: 30 });
  });

  // @spec §4.9
  it("T-LNT-06 flags a negative add-on contribution after the tier mix shifts", () => {
    const baseline = { ...noReadout, mrr: 100, revenue: 100 };
    const findings = lintDesign(
      directInput({
        tiers: [{ id: "base", name: "Base", price: 50, priceMetric: "flat", featureIds: [] }],
        addOns: [{ id: "extra", name: "Extra", price: 20, priceMetric: "flat", featureIds: ["a"] }],
        baseline,
        simulate: () => ({ ...baseline, mrr: 130, revenue: 130 }),
      }),
    );
    expect(findings.map((finding) => finding.id)).toEqual(["E6"]);
    expect(findings[0].metrics?.netContribution).toBe(-30);
  });

  // @spec §4.9
  it("T-LNT-08 flags more than four visible paid offers", () => {
    expect(
      ids(
        directInput({
          tiers: Array.from({ length: 5 }, (_, index) => ({
            id: `tier-${index}`,
            name: `Tier ${index}`,
            price: 10,
            priceMetric: "flat" as const,
            featureIds: [],
          })),
        }),
      ),
    ).toEqual(["B1"]);
  });

  // @spec §4.9
  it("T-LNT-09 flags a top tier below both documented anchor thresholds", () => {
    const tier = {
      id: "top",
      name: "Top",
      price: 100,
      priceMetric: "flat" as const,
      featureIds: [],
    };
    const offer = {
      id: "tier:top",
      name: "Top",
      owner: "own" as const,
      kind: "tier" as const,
      value: 100,
      effectivePrice: 100,
      featureIds: [],
      tierId: "top",
    };
    const segment: SegmentEconomicsReadout = {
      id: "segment",
      prospectCount: 100,
      fullCatalogValue: 100,
      sigma: 0.4,
      selection: {
        offers: [offer],
        active: [{ offer, lower: 1, upper: Number.POSITIVE_INFINITY, share: 0.01 }],
        shares: { "tier:top": 0.01 },
        tieMode: "conservative",
      },
      revenue: 1,
      ownBuyerSurplus: 0,
      fencingGap: 0,
      unserved: 0,
      competitorLoss: 0,
      potential: 100,
      conservationResidual: 0,
      ownPaidBuyers: 1,
      ownBuyers: 1,
      competitorBuyers: 0,
    };
    const findings = lintDesign(
      directInput({
        tiers: [tier],
        segments: [{ id: "segment", name: "Segment", seatCount: 1 }],
        baseline: readoutWith(segment, { mrr: 20_000, revenue: 20_000 }),
      }),
    );
    expect(findings.map((finding) => finding.id)).toEqual(["B2"]);
  });

  // @spec §4.9
  it("keeps a well-spaced menu clean", () => {
    const input = menuInput(
      [
        { id: "basic", name: "Basic", price: 60, priceMetric: "flat", featureIds: ["a"] },
        { id: "pro", name: "Pro", price: 130, priceMetric: "flat", featureIds: ["a", "b"] },
      ],
      [
        {
          id: "automation",
          name: "Automation",
          price: 200,
          priceMetric: "flat",
          featureIds: ["b"],
        },
      ],
    );
    expect(ids(input)).toEqual([]);
  });
});
