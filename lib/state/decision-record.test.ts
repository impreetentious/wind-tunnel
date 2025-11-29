import { describe, expect, it } from "vitest";

import { plgCollaborationTemplate } from "./templates/plg-collaboration";
import { buildPricingDecisionRecord } from "./decision-record";
import { addCompetitor, setCompetitorPrice } from "./positioning";

describe("pricing decision record", () => {
  it("composes a deterministic, engine-backed Markdown artifact", () => {
    const record = buildPricingDecisionRecord(plgCollaborationTemplate, "2026-07-17", 200);

    expect(record.markdown).toContain("# Pricing Decision Record — PLG collaboration tool");
    expect(record.markdown).toContain("Generated 2026-07-17 · Seed 240715 · USD");
    expect(record.markdown).toContain("## Assumptions and provenance");
    expect(record.markdown).toContain("## Simulated economics");
    expect(record.markdown).toContain("## Sensitivity and validation priorities");
    expect(record.markdown).toContain("## Deterministic critic");
    expect(record.markdown).toContain("## Alternatives considered");
    expect(record.markdown).toContain("Baseline packaging");
    expect(record.markdown).toContain("guess, low confidence");
    expect(record.markdown).toContain("Results are conditional on the assumptions");
    expect(record.economics?.mrr).toBeGreaterThan(0);
    expect(record.uncertainty?.drawCount).toBe(200);
    expect(record.markdown).toBe(
      buildPricingDecisionRecord(plgCollaborationTemplate, "2026-07-17", 200).markdown,
    );
  });

  it("includes fielded PSM evidence only when the scenario carries a study", () => {
    const withStudy = {
      ...plgCollaborationTemplate,
      research: {
        vanWestendorp: {
          source: "survey" as const,
          responses: [
            { tooCheap: 10, cheap: 20, expensive: 40, tooExpensive: 60 },
            { tooCheap: 20, cheap: 30, expensive: 50, tooExpensive: 70 },
          ],
        },
      },
    };

    expect(buildPricingDecisionRecord(withStudy, "2026-07-17", 200).markdown).toContain(
      "## Van Westendorp research",
    );
    expect(
      buildPricingDecisionRecord(plgCollaborationTemplate, "2026-07-17", 200).markdown,
    ).not.toContain("## Van Westendorp research");
  });

  it("includes competitive positioning only when competitors are active", () => {
    const withCompetitor = setCompetitorPrice(
      addCompetitor(plgCollaborationTemplate, "Alternative"),
      "alternative",
      20,
    );

    expect(buildPricingDecisionRecord(withCompetitor, "2026-07-17", 200).markdown).toContain(
      "## Competitive positioning",
    );
    expect(
      buildPricingDecisionRecord(plgCollaborationTemplate, "2026-07-17", 200).markdown,
    ).not.toContain("## Competitive positioning");
  });
});
