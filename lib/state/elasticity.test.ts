import { describe, expect, it } from "vitest";

import { elasticityForScenario } from "./elasticity";
import { scenarioSchema } from "./schemas";
import { createBlankScenario } from "./scenario-store";
import { plgCollaborationTemplate } from "./templates";

/**
 * @spec §4.13 — the state adapter over the elasticity engine. It must yield one
 * regime-local readout per segment derived from the same offer expansion the
 * simulator prices, and honor the σ = 0 degenerate branch.
 */
describe("elasticity state adapter", () => {
  it("returns one regime-local readout per segment with non-positive own-price elasticities", () => {
    const readouts = elasticityForScenario(plgCollaborationTemplate);
    expect(readouts).not.toBeNull();
    expect(readouts).toHaveLength(plgCollaborationTemplate.model.segments.length);

    for (const { segmentId, readout } of readouts!) {
      expect(readout.segmentId).toBe(segmentId);
      expect(readout.regimeLocal).toBe(true);
      expect(readout.degenerate).toBe(false);
      for (const offer of readout.activeOfferElasticities) {
        if (offer.ownPriceDemandElasticity !== undefined) {
          expect(offer.ownPriceDemandElasticity).toBeLessThanOrEqual(1e-9);
        }
      }
      // Every substitution endpoint names an offer present in the selection.
      const offerIds = new Set(readout.selection.offers.map((offer) => offer.id));
      for (const entry of readout.substitution) {
        expect(offerIds.has(entry.fromOfferId)).toBe(true);
        expect(offerIds.has(entry.toOfferId)).toBe(true);
      }
    }
  });

  it("reports the σ = 0 degenerate branch instead of Dirac derivatives", () => {
    const scenario = scenarioSchema.parse({
      ...plgCollaborationTemplate,
      model: {
        ...plgCollaborationTemplate.model,
        segments: plgCollaborationTemplate.model.segments.map((segment, index) =>
          index === 0 ? { ...segment, withinSegmentSigma: 0 } : segment,
        ),
      },
    });
    const readouts = elasticityForScenario(scenario);
    const degenerate = readouts!.find((entry) => entry.segmentId === scenario.model.segments[0].id);
    expect(degenerate?.readout.degenerate).toBe(true);
    expect(degenerate?.readout.activeOfferElasticities).toHaveLength(0);
    expect(degenerate?.readout.substitution).toHaveLength(0);
  });

  it("returns null when the scenario has no segments", () => {
    expect(elasticityForScenario(createBlankScenario())).toBeNull();
  });
});
