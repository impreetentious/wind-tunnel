import { lintDesign, type LinterAddOn, type LinterTier } from "@/lib/engine/linter";

import { activeDesign } from "./design-editing";
import { simulateScenarioDesign } from "./scenario-economics";
import type { Scenario } from "./schemas";

/** Runs P5's pure linter over the current persisted scenario. */
export function lintScenarioDesign(scenario: Scenario) {
  const design = activeDesign(scenario);
  if (design.tiers.length === 0) return [];
  const baseline = simulateScenarioDesign(scenario, design);
  if (!baseline) return [];

  return lintDesign({
    features: scenario.model.features,
    tiers: design.tiers as readonly LinterTier[],
    addOns: design.addOns as readonly LinterAddOn[],
    segments: scenario.model.segments.map((segment) => ({
      id: segment.id,
      name: segment.name,
      seatCount: segment.seatCount,
    })),
    baseline,
    simulate: (menu) => {
      const readout = simulateScenarioDesign(scenario, {
        ...design,
        tiers: menu.tiers.map((tier) => ({ ...tier, featureIds: [...tier.featureIds] })),
        addOns: menu.addOns.map((addOn) => ({ ...addOn, featureIds: [...addOn.featureIds] })),
      });
      if (!readout)
        throw new RangeError("A valid design is required for counterfactual simulation.");
      return readout;
    },
  });
}
