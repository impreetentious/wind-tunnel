import { describe, expect, it } from "vitest";

import { generateConjointDesign } from "@/lib/engine/conjoint";

import {
  applyConjointBridge,
  CONJOINT_DEMO_CSV,
  conjointCsv,
  estimateConjointRecord,
  makeConjointStudy,
  parseConjointCsv,
  scenarioWithConjointStudy,
} from "./conjoint";
import { scenarioTemplates } from "./templates";

const attributes = [
  { id: "speed", name: "Speed", levels: ["low", "medium", "high"] as const },
  { id: "support", name: "Support", levels: ["self", "priority", "dedicated"] as const },
] as const;

function buildRecord() {
  const design = generateConjointDesign({
    attributes: attributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      levels: attribute.levels,
    })),
    taskCount: 12,
    alternativesPerTask: 3,
    priceLevels: [10, 30, 50],
    includeNone: true,
    seed: 4242,
  });
  return {
    design,
    record: makeConjointStudy(
      design,
      {
        attributes: attributes.map((attribute) => ({
          id: attribute.id,
          name: attribute.name,
          levels: attribute.levels,
        })),
        numericPrice: true,
      },
      [],
    ),
  };
}

describe("Conjoint scenario adapter", () => {
  // @spec §4.10
  it("round-trips a headered CSV against the demo dataset", () => {
    const { record } = buildRecord();
    // Build simple tasks referenced in the demo CSV.
    const tasks = [
      {
        id: "task-1",
        alternatives: [
          { id: "concept-1" },
          { id: "concept-2" },
          { id: "none", none: true as const },
        ],
      },
      { id: "task-2", alternatives: [{ id: "concept-1" }, { id: "concept-2" }] },
    ];
    const parsed = parseConjointCsv(CONJOINT_DEMO_CSV, tasks);
    expect(parsed.errors).toEqual([]);
    expect(parsed.observations).toHaveLength(4);
    expect(conjointCsv(parsed.observations).split("\n")[0]).toBe("respondent,task,alternative");
    // Ensure the store adapter can hold the same rows.
    const withObservations = { ...record, observations: parsed.observations };
    expect(withObservations.observations).toEqual(parsed.observations);
  });

  // @spec §4.10
  it("rejects rows that reference unknown tasks or alternatives", () => {
    const { record } = buildRecord();
    const csv = `respondent,task,alternative
r1,${record.tasks[0].id},${record.tasks[0].alternatives[0].id}
r1,missing,concept-1
r1,${record.tasks[0].id},not-a-concept`;
    const parsed = parseConjointCsv(csv, record.tasks);
    expect(parsed.observations).toHaveLength(1);
    expect(parsed.errors.map((error) => error.line)).toEqual([3, 4]);
  });

  // @spec §4.10
  it("stamps conjoint provenance and renormalizes shares when the bridge fires", () => {
    const template = scenarioTemplates[0];
    const scenario = template.scenario;
    const segment = scenario.model.segments[0];
    const feature = scenario.model.features[0];
    const record = {
      attributes: [{ id: "value", name: "Value", levels: ["low", "high"] as string[] }],
      tasks: [
        {
          id: "task",
          alternatives: [{ id: "a" }, { id: "b" }, { id: "c" }],
        },
      ],
      observations: [{ respondentId: "r1", taskId: "task", chosenAlternativeId: "a" }],
      numericPrice: true,
    } as ReturnType<typeof makeConjointStudy>;
    const bridgeResult = applyConjointBridge(
      scenario,
      record,
      {
        status: "ok",
        iterations: 1,
        logLikelihoodHistory: [-1],
        respondentCount: 500,
        observationCount: 5000,
        bridgeEnabled: true,
        bridgeReason: "test",
        partWorths: [
          {
            attributeId: "value",
            level: "low",
            estimate: 0,
            standardError: 0.01,
            ci90: [-0.02, 0.02],
          },
          {
            attributeId: "value",
            level: "high",
            estimate: 0.4,
            standardError: 0.01,
            ci90: [0.38, 0.42],
          },
        ],
        priceCoefficient: {
          id: "price",
          estimate: -0.05,
          standardError: 0.005,
          ci90: [-0.06, -0.04],
        },
      },
      {
        segmentId: segment.id,
        entries: [
          {
            attributeId: "value",
            featureId: feature.id,
            referenceLevel: "low",
            targetLevel: "high",
          },
        ],
      },
    );
    expect(bridgeResult.ok).toBe(true);
    const updatedSegment = bridgeResult.scenario.model.segments.find(
      (candidate) => candidate.id === segment.id,
    );
    expect(updatedSegment).toBeDefined();
    const total = Object.values(updatedSegment!.featureAllocation).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(total).toBeCloseTo(1, 9);
    expect(updatedSegment!.provenance.featureValues[feature.id].kind).toBe("conjoint");
    expect(updatedSegment!.provenance.featureValues[feature.id].note).toMatch(/N=500/);
  });

  // @spec §4.10
  it("returns the disabled-bridge reason when the price coefficient is not significant", () => {
    const scenario = scenarioTemplates[0].scenario;
    const bridgeResult = applyConjointBridge(
      scenario,
      { attributes: [], tasks: [], observations: [], numericPrice: true },
      {
        status: "ok",
        iterations: 1,
        logLikelihoodHistory: [-1],
        respondentCount: 5,
        observationCount: 5,
        bridgeEnabled: false,
        bridgeReason: "The numeric price coefficient is not significantly negative.",
      },
      { segmentId: scenario.model.segments[0].id, entries: [] },
    );
    expect(bridgeResult.ok).toBe(false);
    expect(bridgeResult.reason).toMatch(/price/);
  });

  it("re-runs the pooled estimator through the record adapter", () => {
    const { record } = buildRecord();
    const scenario = scenarioTemplates[0].scenario;
    const populated = {
      ...record,
      observations: record.tasks.map((task, index) => ({
        respondentId: `r${index}`,
        taskId: task.id,
        chosenAlternativeId: task.alternatives[0].id,
      })),
    };
    const updated = scenarioWithConjointStudy(scenario, populated);
    expect(updated.research.conjoint).toEqual(populated);
    const estimate = estimateConjointRecord(populated);
    expect(["ok", "nonIdentifiable", "separated", "nonConverged"]).toContain(estimate.status);
  });
});
