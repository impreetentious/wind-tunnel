import { describe, expect, it } from "vitest";

import { scenarioSchema } from "./schemas";
import {
  addCompetitor,
  applyCompetitorValueSurvey,
  parseCompetitorValueSurvey,
  positioningMapForSegment,
  removeCompetitor,
  renameCompetitor,
  setCompetitorOverallValue,
  setCompetitorPrice,
  setCompetitorPriceMetric,
  setCompetitorValueForSegment,
  summarizeCompetitorValueSurvey,
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

describe("competitor value survey shortcut (M-09)", () => {
  it("parses a free-text paste and counts rejected tokens", () => {
    const { values, rejected } = parseCompetitorValueSurvey("120, 150\n90 200; abc -5");
    expect(values).toEqual([120, 150, 90, 200]);
    expect(rejected).toBe(2); // "abc" and "-5"
  });

  it("summarizes responses with the median and reports usage counts", () => {
    expect(summarizeCompetitorValueSurvey([100, 300, 200])).toEqual({
      value: 200,
      used: 3,
      rejected: 0,
    });
    // Even count averages the two central order statistics.
    expect(summarizeCompetitorValueSurvey([100, 200, 300, 400])?.value).toBe(250);
    // Rejects non-finite and negative entries but keeps the rest.
    const summary = summarizeCompetitorValueSurvey([50, Number.NaN, -3, 150]);
    expect(summary).toEqual({ value: 100, used: 2, rejected: 2 });
    expect(summarizeCompetitorValueSurvey([])).toBeNull();
    expect(summarizeCompetitorValueSurvey([-1, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it("applies the survey median to one segment's competitor value and stays schema-valid", () => {
    const added = addCompetitor(plgCollaborationTemplate, "Rival");
    const competitorId = added.competitors[added.competitors.length - 1].id;
    const segmentId = added.model.segments[0].id;
    const otherSegmentId = added.model.segments[1]?.id;

    const applied = applyCompetitorValueSurvey(added, competitorId, segmentId, [90, 210, 150]);
    const competitor = applied.competitors.find((entry) => entry.id === competitorId);
    expect(competitor?.valueBySegment[segmentId]).toBe(150);
    // Other segments are untouched by a per-segment survey.
    if (otherSegmentId) {
      expect(competitor?.valueBySegment[otherSegmentId]).toBe(
        added.competitors.find((entry) => entry.id === competitorId)?.valueBySegment[
          otherSegmentId
        ],
      );
    }
    expect(scenarioSchema.safeParse(applied).success).toBe(true);
  });

  it("leaves the scenario unchanged when no usable response is provided", () => {
    const added = addCompetitor(plgCollaborationTemplate, "Rival");
    const competitorId = added.competitors[added.competitors.length - 1].id;
    const segmentId = added.model.segments[0].id;
    const unchanged = applyCompetitorValueSurvey(added, competitorId, segmentId, [Number.NaN, -1]);
    expect(unchanged).toBe(added);
  });
});
