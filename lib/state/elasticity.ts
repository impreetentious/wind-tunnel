import { computeSegmentElasticity, type SegmentElasticityReadout } from "@/lib/engine/elasticity";
import { expandOffers } from "@/lib/engine/offers";

import { activeDesign } from "./design-editing";
import { offerExpansionForSegment } from "./scenario-economics";
import type { Scenario } from "./schemas";

export interface ScenarioSegmentElasticity {
  segmentId: string;
  segmentName: string;
  readout: SegmentElasticityReadout;
}

/**
 * Adapts the active design to the §4.13 elasticity engine, one readout per
 * segment. It reuses `offerExpansionForSegment` so the offers whose shares are
 * differentiated are byte-identical to the ones Simulate prices, and the
 * elasticity table is therefore local to the exact envelope the user sees.
 */
export function elasticityForScenario(
  scenario: Scenario,
): readonly ScenarioSegmentElasticity[] | null {
  if (scenario.model.segments.length === 0) return null;
  const design = activeDesign(scenario);
  return scenario.model.segments.map((segment) => ({
    segmentId: segment.id,
    segmentName: segment.name,
    readout: computeSegmentElasticity({
      segmentId: segment.id,
      sigma: segment.withinSegmentSigma,
      offers: expandOffers(offerExpansionForSegment(scenario, design, segment)),
    }),
  }));
}
