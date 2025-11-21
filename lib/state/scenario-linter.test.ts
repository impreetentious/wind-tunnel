import { describe, expect, it } from "vitest";

import { simulateScenarioDesign } from "./scenario-economics";
import { lintScenarioDesign } from "./scenario-linter";
import { scenarioSchema } from "./schemas";

const lowConfidenceGuess = { kind: "guess", confidence: "low" } as const;

function competitorFixture() {
  const segment = (id: string, name: string) => ({
    id,
    name,
    prospectBand: { p10: 50, p50: 100, p90: 200 },
    seatCount: 1,
    wtpBand: { p10: 100, p50: 200, p90: 400 },
    withinSegmentSigma: 0.5,
    featureAllocation: { core: 0.5, extension: 0.5 },
    provenance: {
      prospectCount: lowConfidenceGuess,
      willingnessToPay: lowConfidenceGuess,
      featureValues: { core: lowConfidenceGuess, extension: lowConfidenceGuess },
    },
  });

  return scenarioSchema.parse({
    schemaVersion: 1,
    id: "competitor-linter-fixture",
    name: "Competitor linter fixture",
    status: "draft",
    model: {
      features: [
        { id: "core", name: "Core workflow" },
        { id: "extension", name: "Extension" },
      ],
      segments: [segment("teams", "Teams")],
    },
    designs: [
      {
        id: "baseline",
        name: "Baseline",
        tiers: [
          {
            id: "own",
            name: "Own tier",
            price: 125,
            priceMetric: "flat",
            featureIds: ["core", "extension"],
          },
        ],
        addOns: [],
      },
    ],
    activeDesignId: "baseline",
    competitors: [
      {
        id: "rival",
        name: "Rival",
        price: 75,
        priceMetric: "flat",
        valueBySegment: { teams: 150 },
      },
    ],
    research: {},
    settings: { seed: 240715, currency: "USD", theme: "system" },
  });
}

describe("P5 scenario linter integration", () => {
  // @spec §4.9
  it("T-LNT-07 runs the JSON competitor fixture through the engine and flags material loss", () => {
    const scenario = competitorFixture();
    const design = scenario.designs[0];
    const readout = simulateScenarioDesign(scenario, design);

    expect(readout).not.toBeNull();
    expect(readout?.conservationResidual).toBeCloseTo(0, 8);

    const findings = lintScenarioDesign(scenario);
    expect(findings.map((finding) => finding.id)).toEqual(["E7"]);
    expect(findings[0].metrics?.lossShare).toBeGreaterThan(0.25);
  });
});
