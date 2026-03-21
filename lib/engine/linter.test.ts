import { describe, expect, it } from "vitest";

import { simulateEconomics } from "./economics";
import { lintDesign, type DesignLinterInput, type LinterTier } from "./linter";
import { expandOffers } from "./offers";
import type { EconomicsReadout, SegmentEconomicsInput, SegmentEconomicsReadout } from "./types";

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

describe("deterministic design linter", () => {
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
  it("does not flag a tier whose add-on composite carries its envelope share", () => {
    expect(
      ids(
        menuInput(
          [{ id: "pro", name: "Pro", price: 100, priceMetric: "flat", featureIds: ["a"] }],
          [
            {
              id: "analytics",
              name: "Analytics",
              price: 0,
              priceMetric: "flat",
              featureIds: ["b"],
            },
          ],
        ),
      ),
    ).not.toContain("E2");
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
  it("does not count top-tier add-on composites as downgrade mass", () => {
    expect(
      ids(
        menuInput(
          [{ id: "pro", name: "Pro", price: 50, priceMetric: "flat", featureIds: ["a"] }],
          [
            {
              id: "analytics",
              name: "Analytics",
              price: 0,
              priceMetric: "flat",
              featureIds: ["b"],
            },
          ],
        ),
      ),
    ).not.toContain("E4");
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

// §4.9's E7 (competitor takes material potential) and the σ = 0 value moments
// are the linter paths a lognormal fixture never exercises: a point-mass
// segment resolves selection by a single median pick rather than by
// integrating shares, so it runs entirely different arithmetic.
describe("linter — point-mass segments and competitor loss", () => {
  function competitiveSegment(sigma: number): SegmentEconomicsInput {
    return {
      id: "segment",
      prospectCount: 1_000,
      fullCatalogValue: 200,
      sigma,
      offers: expandOffers({
        seatCount: 1,
        featureValues: { a: 100, b: 100 },
        tiers: [
          { id: "pro", name: "Pro", price: 190, priceMetric: "flat", featureIds: ["a", "b"] },
        ],
        competitors: [{ id: "rival", name: "Rival", price: 20, priceMetric: "flat", value: 190 }],
        includeCompetitors: true,
      }),
    };
  }

  function competitiveInput(sigma: number): DesignLinterInput {
    const simulate = () => simulateEconomics({ segments: [competitiveSegment(sigma)] });
    return {
      features,
      tiers: [{ id: "pro", name: "Pro", price: 190, priceMetric: "flat", featureIds: ["a", "b"] }],
      addOns: [],
      segments: [{ id: "segment", name: "Core segment", seatCount: 1 }],
      baseline: simulate(),
      simulate,
    };
  }

  // @spec §4.9 T-LNT-10
  it("flags a cheap dominant competitor in a point-mass segment", () => {
    const findings = lintDesign(competitiveInput(0));
    const e7 = findings.find((finding) => finding.id === "E7");
    expect(e7).toBeDefined();
    expect(e7?.message).toMatch(/Rival takes/);
    // A point-mass segment loses all of its potential to the winner.
    expect(e7?.metrics?.lossShare ?? 0).toBeGreaterThan(0.9);
  });

  // @spec §4.9 T-LNT-11
  it("flags the same competitor when the segment has dispersion", () => {
    const findings = lintDesign(competitiveInput(0.4));
    const e7 = findings.find((finding) => finding.id === "E7");
    expect(e7).toBeDefined();
    expect(e7?.metrics?.lossShare ?? 0).toBeGreaterThan(0);
  });

  // @spec §4.9 T-LNT-12 — the E1 "in no offer" wording, not the "in every offer" one.
  it("uses the absent-feature wording when a fence appears in no offer", () => {
    const findings = lintDesign(
      directInput({
        features: [{ id: "ghost", name: "Ghost feature" }],
        tiers: [
          { id: "free", name: "Free", price: 0, priceMetric: "flat", featureIds: [] },
          { id: "paid", name: "Paid", price: 10, priceMetric: "flat", featureIds: [] },
        ],
      }),
    );
    const e1 = findings.find((finding) => finding.id === "E1");
    expect(e1?.message).toMatch(/is not in any current offer/);
  });
});

describe("hybrid usage and credit rules (@spec §4.17)", () => {
  const callsMetric = { id: "calls", name: "API calls", unitLabel: "calls" };
  const callsBand = { p10: 5_000, p50: 10_000, p90: 20_000 };

  function hybridInput(overrides: Partial<DesignLinterInput>): DesignLinterInput {
    return directInput({
      usageMetrics: [callsMetric],
      segments: [
        { id: "segment", name: "Core segment", seatCount: 1, usageBands: { calls: callsBand } },
      ],
      ...overrides,
    });
  }

  // T-LNT-13 @spec §4.17
  it("flags an overage rate above the pack's own implied unit price", () => {
    const findings = lintDesign(
      hybridInput({
        tiers: [
          {
            id: "metered",
            name: "Metered",
            price: 100,
            priceMetric: "flat",
            featureIds: [],
            creditPacks: [
              { metricId: "calls", packUnits: 8_000, packPrice: 400, overagePerUnit: 0.25 },
            ],
          },
        ],
      }),
    );
    const u1 = findings.find((finding) => finding.id === "U1");
    expect(u1?.severity).toBe("warning");
    expect(u1?.message).toMatch(/5\.0× the pack rate/);
    expect(u1?.segmentIds).toEqual(["segment"]);
    expect(u1?.metrics?.probabilityOfOverage ?? 0).toBeGreaterThan(0.2);
  });

  // T-LNT-14 @spec §4.17 — a cliff nobody reaches is not a cliff.
  it("stays quiet on a cliff the segment is unlikely to hit", () => {
    const findings = lintDesign(
      hybridInput({
        tiers: [
          {
            id: "metered",
            name: "Metered",
            price: 100,
            priceMetric: "flat",
            featureIds: [],
            creditPacks: [
              { metricId: "calls", packUnits: 400_000, packPrice: 2_000, overagePerUnit: 0.25 },
            ],
          },
        ],
      }),
    );
    expect(findings.filter((finding) => finding.id === "U1")).toHaveLength(0);
    // The same oversized pack is exactly what the expiry rule is for.
    expect(findings.find((finding) => finding.id === "U2")?.severity).toBe("warning");
  });

  // T-LNT-15 @spec §4.17
  it("flags expiring credits the segment does not spend and clears a pack that rolls over", () => {
    const oversized = {
      metricId: "calls",
      packUnits: 40_000,
      packPrice: 1_200,
    };
    const expiring = lintDesign(
      hybridInput({
        tiers: [
          {
            id: "packs",
            name: "Credits",
            price: 0,
            priceMetric: "flat",
            featureIds: [],
            creditPacks: [oversized],
          },
        ],
      }),
    );
    const u2 = expiring.find((finding) => finding.id === "U2");
    expect(u2).toBeDefined();
    expect(u2?.message).toMatch(/revenue with no delivery behind it/);
    expect(u2?.metrics?.expectedBreakageRevenue ?? 0).toBeGreaterThan(0);

    const rolling = lintDesign(
      hybridInput({
        tiers: [
          {
            id: "packs",
            name: "Credits",
            price: 0,
            priceMetric: "flat",
            featureIds: [],
            creditPacks: [{ ...oversized, expiresAtPeriodEnd: false }],
          },
        ],
      }),
    );
    expect(rolling.filter((finding) => finding.id === "U2")).toHaveLength(0);
  });

  // T-LNT-16 @spec §4.17
  it("flags a consumption allowance that never binds but not the same outcome allowance", () => {
    const tiers = [
      {
        id: "metered",
        name: "Metered",
        price: 100,
        priceMetric: "flat" as const,
        featureIds: [],
        usagePricing: [{ metricId: "calls", perUnitPrice: 0.01, includedUnits: 500_000 }],
      },
    ];

    const consumption = lintDesign(hybridInput({ tiers }));
    const u3 = consumption.find((finding) => finding.id === "U3");
    expect(u3?.severity).toBe("info");
    expect(u3?.message).toMatch(/never screens anybody/);

    const outcome = lintDesign(
      hybridInput({ tiers, usageMetrics: [{ ...callsMetric, unitKind: "outcome" as const }] }),
    );
    expect(outcome.filter((finding) => finding.id === "U3")).toHaveLength(0);
  });

  // T-LNT-17 @spec §4.17 — the gate that keeps every frozen fixture silent on this family.
  it("produces nothing for a menu that sells neither a pack nor a metered line", () => {
    const findings = lintDesign(
      hybridInput({
        tiers: [{ id: "flat", name: "Flat", price: 100, priceMetric: "flat", featureIds: [] }],
      }),
    );
    expect(findings.filter((finding) => finding.id.startsWith("U"))).toHaveLength(0);
  });

  // T-LNT-18 @spec §4.17 — a segment with no band cannot be reasoned about.
  it("produces nothing when the segment has no usage band for the metric", () => {
    const findings = lintDesign(
      hybridInput({
        segments: [{ id: "segment", name: "Core segment", seatCount: 1 }],
        tiers: [
          {
            id: "metered",
            name: "Metered",
            price: 100,
            priceMetric: "flat",
            featureIds: [],
            usagePricing: [{ metricId: "calls", perUnitPrice: 0.01, includedUnits: 500_000 }],
            creditPacks: [
              { metricId: "calls", packUnits: 8_000, packPrice: 400, overagePerUnit: 0.25 },
            ],
          },
        ],
      }),
    );
    expect(findings.filter((finding) => finding.id.startsWith("U"))).toHaveLength(0);
  });
});
