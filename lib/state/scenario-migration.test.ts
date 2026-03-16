import { describe, expect, it } from "vitest";

import { diffDesignPair, diffScenarios } from "./scenario-diff";
import { incumbentDesign, simulateScenarioMigration } from "./scenario-migration";
import { scenarioSchema, type Scenario } from "./schemas";

const guess = { kind: "guess", confidence: "low" } as const;

/**
 * A two-design scenario: `legacy` is what is sold today, `proposal` is the reprice. The base
 * sits on the legacy tier and has to decide what to do about it.
 */
function repricingFixture(overrides: Partial<Scenario> = {}): Scenario {
  return scenarioSchema.parse({
    schemaVersion: 1,
    id: "repricing-fixture",
    name: "Repricing fixture",
    status: "draft",
    model: {
      features: [
        { id: "core", name: "Core workflow" },
        { id: "advanced", name: "Advanced" },
      ],
      segments: [
        {
          id: "base",
          name: "Installed base",
          prospectBand: { p10: 200, p50: 400, p90: 800 },
          seatCount: 1,
          wtpBand: { p10: 100, p50: 200, p90: 400 },
          withinSegmentSigma: 0.35,
          featureAllocation: { core: 0.6, advanced: 0.4 },
          provenance: {
            prospectCount: guess,
            willingnessToPay: guess,
            featureValues: { core: guess, advanced: guess },
          },
        },
      ],
    },
    designs: [
      {
        id: "legacy",
        name: "Legacy",
        tiers: [
          {
            id: "legacy-tier",
            name: "Legacy plan",
            price: 80,
            priceMetric: "flat",
            featureIds: ["core"],
          },
        ],
        addOns: [],
      },
      {
        id: "proposal",
        name: "Proposal",
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
        addOns: [],
      },
    ],
    activeDesignId: "proposal",
    competitors: [],
    research: {},
    migration: {
      policy: "grandfather",
      incumbentDesignId: "legacy",
      base: [
        { segmentId: "base", incumbentTierId: "legacy-tier", baseCount: 400, switchingCost: 40 },
      ],
    },
    settings: { seed: 240715, currency: "USD", theme: "system" },
    ...overrides,
  });
}

describe("scenario migration adapter (@spec §4.18)", () => {
  // T-MIG-09 @spec §4.18
  it("prices the incumbent through the same offer expansion as every other offer", () => {
    const scenario = repricingFixture();
    const readout = simulateScenarioMigration(scenario);

    expect(readout).not.toBeNull();
    // Legacy plan: flat $80 carrying only the core feature, worth 60% of a $200 catalog.
    expect(readout?.bridge.openingMrr).toBeCloseTo(400 * 80, 9);
    expect(Math.abs(readout?.bridge.bridgeResidual ?? 1)).toBeLessThan(1e-9 * 400 * 80);
    expect(incumbentDesign(scenario)?.id).toBe("legacy");
  });

  // T-MIG-10 @spec §4.18 — the gate that keeps every greenfield scenario silent.
  it("returns nothing without a migration block, a resolvable design, or a base", () => {
    const greenfield = repricingFixture();
    expect(simulateScenarioMigration({ ...greenfield, migration: undefined })).toBeNull();
    expect(incumbentDesign({ ...greenfield, migration: undefined })).toBeNull();
    expect(
      simulateScenarioMigration({
        ...greenfield,
        migration: { ...greenfield.migration!, base: [] },
      }),
    ).toBeNull();
    // Repricing a design against itself is not a migration.
    expect(simulateScenarioMigration({ ...greenfield, activeDesignId: "legacy" })).toBeNull();
  });

  // T-MIG-11 @spec §4.18
  it("carries a metered legacy plan's surcharge into its incumbent price", () => {
    const plain = repricingFixture();
    const metered = repricingFixture({
      model: {
        ...plain.model,
        usageMetrics: [{ id: "calls", name: "API calls", unitLabel: "calls" }],
        segments: plain.model.segments.map((segment) => ({
          ...segment,
          usageBands: { calls: { p10: 5_000, p50: 10_000, p90: 20_000 } },
        })),
      },
      designs: plain.designs.map((design) =>
        design.id !== "legacy"
          ? design
          : {
              ...design,
              tiers: design.tiers.map((tier) => ({
                ...tier,
                usagePricing: [{ metricId: "calls", perUnitPrice: 0.002, includedUnits: 5_000 }],
              })),
            },
      ),
    });

    const plainOpening = simulateScenarioMigration(plain)?.bridge.openingMrr ?? 0;
    const meteredOpening = simulateScenarioMigration(metered)?.bridge.openingMrr ?? 0;
    // (10,000 − 5,000) × $0.002 = $10/account/month on top of the $80 list price.
    expect(meteredOpening - plainOpening).toBeCloseTo(400 * 10, 6);
  });

  // T-MIG-12 @spec §4.18
  it("rejects a base that references a plan the incumbent design does not have", () => {
    const scenario = repricingFixture();
    expect(() =>
      scenarioSchema.parse({
        ...scenario,
        migration: {
          ...scenario.migration!,
          base: [{ segmentId: "base", incumbentTierId: "ghost", baseCount: 1, switchingCost: 0 }],
        },
      }),
    ).toThrow();
    expect(() =>
      scenarioSchema.parse({
        ...scenario,
        migration: { ...scenario.migration!, incumbentDesignId: "ghost" },
      }),
    ).toThrow();
    expect(() =>
      scenarioSchema.parse({
        ...scenario,
        migration: {
          ...scenario.migration!,
          base: [
            { segmentId: "base", incumbentTierId: "legacy-tier", baseCount: 1, switchingCost: 0 },
            { segmentId: "base", incumbentTierId: "legacy-tier", baseCount: 2, switchingCost: 0 },
          ],
        },
      }),
    ).toThrow();
  });
});

describe("current design versus proposal (@spec §4.18)", () => {
  // T-MIG-13 @spec §4.18
  it("reports what moved between two designs instead of one added and one removed", () => {
    const scenario = repricingFixture();
    const legacy = scenario.designs[0];
    const proposal = scenario.designs[1];
    const diff = diffDesignPair(legacy, proposal);

    // `diffScenarios` compares by id, so these two read as unrelated designs there.
    const byId = diffScenarios(scenario, scenario);
    expect(byId).toEqual([]);

    expect(diff.some((entry) => entry.path === "design.name")).toBe(true);
    // The legacy tier does not exist in the proposal; both new tiers do not exist in the legacy.
    expect(diff.filter((entry) => entry.kind === "removed").map((entry) => entry.path)).toEqual([
      "tiers.legacy-tier",
    ]);
    expect(
      diff
        .filter((entry) => entry.kind === "added")
        .map((entry) => entry.path)
        .sort(),
    ).toEqual(["tiers.pro", "tiers.starter"]);
  });

  // T-MIG-14 @spec §4.18
  it("reads a repriced and re-metered tier as a change on the same tier", () => {
    const before = {
      id: "d",
      name: "Design",
      tiers: [
        { id: "pro", name: "Pro", price: 100, priceMetric: "flat" as const, featureIds: ["core"] },
      ],
      addOns: [],
    };
    const after = {
      ...before,
      tiers: [
        {
          ...before.tiers[0],
          price: 140,
          usagePricing: [{ metricId: "calls", perUnitPrice: 0.01, includedUnits: 1_000 }],
        },
      ],
    };
    const diff = diffDesignPair(before, after);

    expect(diff.map((entry) => entry.path)).toEqual(["tiers.pro.metering", "tiers.pro.price"]);
    expect(diff.every((entry) => entry.kind === "changed")).toBe(true);
    expect(diff.find((entry) => entry.path === "tiers.pro.metering")?.before).toBe("none");
  });

  // T-MIG-15 @spec §4.18
  it("shows the migration block in a scenario diff", () => {
    const before = repricingFixture();
    const after = repricingFixture({
      migration: { ...before.migration!, policy: "forced-at-renewal" },
    });
    const entries = diffScenarios(before, after).filter((entry) => entry.category === "migration");
    expect(entries).toEqual([
      {
        category: "migration",
        kind: "changed",
        path: "migration.policy",
        before: "grandfather",
        after: "forced-at-renewal",
      },
    ]);
    expect(
      diffScenarios(before, { ...before, migration: undefined }).filter(
        (entry) => entry.category === "migration",
      )[0]?.kind,
    ).toBe("removed");
  });
});
