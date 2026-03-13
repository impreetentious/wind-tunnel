import { describe, expect, it } from "vitest";
import { estimateConjoint } from "@/lib/engine/conjoint";
import { stableStringify } from "@/lib/state/codec";
import { buildSyntheticConjointStudy } from "@/lib/state/conjoint";
import { positioningMapForSegment } from "@/lib/state/positioning";
import { simulateScenarioDesign } from "@/lib/state/scenario-economics";
import { scenarioTemplates } from "./index";

function rounded(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(9)) : value;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        rounded(nested),
      ]),
    );
  }
  return value;
}

function snapshot(value: unknown): string {
  return stableStringify(rounded(value));
}

describe("seeded engine golden scenarios", () => {
  for (const template of scenarioTemplates) {
    it(`snapshots ${template.id} full economics output`, () => {
      const design = template.scenario.designs.find(
        (candidate) => candidate.id === template.scenario.activeDesignId,
      );
      if (!design) throw new Error(`${template.id} has no active design.`);
      expect(snapshot(simulateScenarioDesign(template.scenario, design))).toMatchSnapshot();
    });
  }

  it("snapshots the canonical seeded CBC estimate", () => {
    expect(snapshot(estimateConjoint(buildSyntheticConjointStudy()))).toMatchSnapshot();
  });

  it("snapshots the canonical template positioning map", () => {
    const template = scenarioTemplates[0];
    const segmentId = template.scenario.model.segments[0]?.id;
    if (!segmentId) throw new Error("PLG template has no segment.");
    expect(snapshot(positioningMapForSegment(template.scenario, segmentId))).toMatchSnapshot();
  });
});
