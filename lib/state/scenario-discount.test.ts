import { describe, expect, it } from "vitest";

import { evaluateScenarioDiscount } from "./scenario-discount";
import { simulateScenarioDesign } from "./scenario-economics";
import { lintScenarioDesign } from "./scenario-linter";
import { scenarioSchema, type Scenario } from "./schemas";

const guess = { kind: "guess", confidence: "low" } as const;

type Design = Scenario["designs"][number];

function discountFixture(policies?: Design["discountPolicies"]): Scenario {
  return scenarioSchema.parse({
    schemaVersion: 1,
    id: "discount-fixture",
    name: "Discount fixture",
    status: "draft",
    model: {
      features: [
        { id: "core", name: "Core" },
        { id: "team", name: "Team" },
        { id: "governance", name: "Governance" },
      ],
      segments: [
        {
          id: "midmarket",
          name: "Midmarket",
          prospectBand: { p10: 500, p50: 1_000, p90: 2_000 },
          seatCount: 1,
          wtpBand: { p10: 150, p50: 300, p90: 600 },
          withinSegmentSigma: 0.4,
          featureAllocation: { core: 0.4, team: 0.27, governance: 0.33 },
          provenance: {
            prospectCount: guess,
            willingnessToPay: guess,
            featureValues: { core: guess, team: guess, governance: guess },
          },
        },
      ],
    },
    designs: [
      {
        id: "menu",
        name: "Good better best",
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
        addOns: [],
        ...(policies ? { discountPolicies: policies } : {}),
      },
    ],
    activeDesignId: "menu",
    competitors: [],
    research: {},
    settings: { seed: 240715, currency: "USD", theme: "system" },
  });
}

describe("scenario discount adapter (@spec §4.19)", () => {
  // T-DSC-10 @spec §4.19 — the gate that keeps a list-priced design silent.
  it("returns nothing when the active design permits no discount", () => {
    expect(evaluateScenarioDiscount(discountFixture())).toBeNull();
    expect(evaluateScenarioDiscount(discountFixture([]))).toBeNull();
    expect(
      lintScenarioDesign(discountFixture()).filter((finding) => finding.id.startsWith("P")),
    ).toHaveLength(0);
  });

  // T-DSC-11 @spec §4.19
  it("measures leakage against the same list MRR the rest of the studio reports", () => {
    const scenario = discountFixture([
      { tierId: "better", floorFraction: 0.25, hitRateBySegment: { midmarket: 0.5 } },
    ]);
    const readout = evaluateScenarioDiscount(scenario);
    const economics = simulateScenarioDesign(scenario, scenario.designs[0]);

    expect(readout).not.toBeNull();
    // There is exactly one definition of list MRR, and this is it.
    expect(readout?.listMrr).toBeCloseTo(economics?.mrr ?? 0, 9);
    expect(readout?.discountLeakage).toBeGreaterThan(0);
    expect(readout?.achievedMrr).toBeCloseTo(
      (readout?.listMrr ?? 0) - (readout?.discountLeakage ?? 0),
      9,
    );
  });

  // T-DSC-12 @spec §4.19
  it("surfaces fence erosion through the scenario linter with the approver named", () => {
    const scenario = discountFixture([
      {
        tierId: "better",
        floorFraction: 0.9,
        hitRateBySegment: { midmarket: 1 },
        approvalBands: [
          { upToFraction: 0.15, approver: "Account executive" },
          { upToFraction: 0.95, approver: "VP Sales" },
        ],
      },
    ]);
    const findings = lintScenarioDesign(scenario);
    const p1 = findings.find((finding) => finding.id === "P1");

    expect(p1?.severity).toBe("warning");
    expect(p1?.message).toContain("Best");
    expect(p1?.message).toContain("VP Sales");
    expect(p1?.segmentIds).toEqual(["midmarket"]);
  });

  // T-DSC-13 @spec §4.19
  it("rejects a policy the design cannot honor", () => {
    expect(() => discountFixture([{ tierId: "ghost", floorFraction: 0.2 }])).toThrow();
    expect(() =>
      discountFixture([
        { tierId: "better", floorFraction: 0.2 },
        { tierId: "better", floorFraction: 0.3 },
      ]),
    ).toThrow();
    expect(() =>
      discountFixture([
        { tierId: "better", floorFraction: 0.2, hitRateBySegment: { unknown: 0.2 } },
      ]),
    ).toThrow();
    expect(() =>
      discountFixture([
        { tierId: "better", floorFraction: 0.2, hitRateBySegment: { midmarket: 0.7 } },
        { tierId: "best", floorFraction: 0.2, hitRateBySegment: { midmarket: 0.7 } },
      ]),
    ).toThrow();
  });
});
