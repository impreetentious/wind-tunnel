import { describe, expect, it } from "vitest";

import { scenarioSchema } from "./schemas";
import {
  addCompetitor,
  positioningMapForSegment,
  removeCompetitor,
  renameCompetitor,
  setCompetitorOverallValue,
  setCompetitorPrice,
  setCompetitorPriceMetric,
  setCompetitorValueForSegment,
} from "./positioning";
import { plgCollaborationTemplate } from "./templates";

describe("positioning state adapter", () => {
  it("adds a competitor with a per-segment default value from segment WTP", () => {
    const updated = addCompetitor(plgCollaborationTemplate, "Rival");
    expect(updated.competitors).toHaveLength(plgCollaborationTemplate.competitors.length + 1);
    const added = updated.competitors[updated.competitors.length - 1];
    for (const segment of updated.model.segments) {
      expect(added.valueBySegment[segment.id]).toBe(segment.wtpBand.p50);
    }
    expect(scenarioSchema.safeParse(updated).success).toBe(true);
  });

  it("edits competitor fields without breaking the schema", () => {
    const added = addCompetitor(plgCollaborationTemplate, "Rival");
    const competitorId = added.competitors[added.competitors.length - 1].id;
    const renamed = renameCompetitor(added, competitorId, "Rival Renamed");
    const withPrice = setCompetitorPrice(renamed, competitorId, 42);
    const withMetric = setCompetitorPriceMetric(withPrice, competitorId, "per-seat");
    const someSegmentId = added.model.segments[0].id;
    const perSegment = setCompetitorValueForSegment(withMetric, competitorId, someSegmentId, 99);
    const overall = setCompetitorOverallValue(perSegment, competitorId, 77);

    const final = overall.competitors.find((competitor) => competitor.id === competitorId);
    expect(final?.name).toBe("Rival Renamed");
    expect(final?.price).toBe(42);
    expect(final?.priceMetric).toBe("per-seat");
    for (const segment of overall.model.segments) {
      expect(final?.valueBySegment[segment.id]).toBe(77);
    }
    expect(scenarioSchema.safeParse(overall).success).toBe(true);
  });

  it("removes a competitor and preserves the remaining set", () => {
    const added = addCompetitor(plgCollaborationTemplate, "Rival");
    const competitorId = added.competitors[added.competitors.length - 1].id;
    const removed = removeCompetitor(added, competitorId);
    expect(removed.competitors).toHaveLength(plgCollaborationTemplate.competitors.length);
    expect(removed.competitors.some((competitor) => competitor.id === competitorId)).toBe(false);
    expect(scenarioSchema.safeParse(removed).success).toBe(true);
  });

  it("builds a segment-scoped positioning map with tier account values from the model", () => {
    const scenario = addCompetitor(plgCollaborationTemplate, "Rival");
    const segmentId = scenario.model.segments[0].id;
    const map = positioningMapForSegment(scenario, segmentId);
    expect(map).not.toBeNull();
    expect(map?.segmentId).toBe(segmentId);
    expect(map?.rays.map((ray) => ray.label)).toEqual(["p10", "p50", "p90"]);
    expect(map?.tiers.length).toBeGreaterThan(0);
    for (const tier of map!.tiers) {
      expect(tier.value).toBeGreaterThanOrEqual(0);
      expect(tier.effectivePrice).toBeGreaterThanOrEqual(0);
    }
  });
});
