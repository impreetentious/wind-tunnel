import { lintDesign, type LinterAddOn, type LinterTier } from "@/lib/engine/linter";

import { activeDesign } from "./design-editing";
import { formatMoney, formatPercent } from "./formatting";
import { evaluateScenarioDiscount } from "./scenario-discount";
import { simulateScenarioDesign } from "./scenario-economics";
import { simulateScenarioMigration } from "./scenario-migration";
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
      // §4.17: the U rules read the segment's own usage band, so an unmetered scenario
      // reaches them with nothing to look at.
      usageBands: segment.usageBands,
    })),
    usageMetrics: scenario.model.usageMetrics,
    // §4.18: `undefined` on a greenfield scenario, which is what keeps the M rules silent.
    migration: simulateScenarioMigration(scenario) ?? undefined,
    // §4.19: `undefined` when the design permits no discount, which keeps the P rules silent.
    discount: evaluateScenarioDiscount(scenario) ?? undefined,
    baseline,
    formatMoney: (value) =>
      formatMoney(Math.abs(value), scenario.settings.currency, scenario.settings.locale),
    formatPercent: (value) => formatPercent(value, scenario.settings.locale),
    simulate: (menu) => {
      // The linter hands back its own readonly view of the menu; the durable design shape is
      // mutable, so every array the counterfactual carries forward is copied — including the
      // §4.15 usage lines and §4.17 packs, which must survive the round trip or a metered
      // counterfactual would silently reprice itself as a flat one.
      const toOffer = <T extends LinterTier>(offer: T) => ({
        ...offer,
        featureIds: [...offer.featureIds],
        ...(offer.usagePricing ? { usagePricing: [...offer.usagePricing] } : {}),
        ...(offer.creditPacks ? { creditPacks: [...offer.creditPacks] } : {}),
      });
      const readout = simulateScenarioDesign(scenario, {
        ...design,
        tiers: menu.tiers.map(toOffer),
        addOns: menu.addOns.map(toOffer),
      });
      if (!readout)
        throw new RangeError("A valid design is required for counterfactual simulation.");
      return readout;
    },
  });
}
