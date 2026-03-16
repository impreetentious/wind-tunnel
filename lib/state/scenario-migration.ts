import {
  simulateMigration,
  type MigrationInput,
  type MigrationReadout,
} from "@/lib/engine/migration";
import { expandOffers } from "@/lib/engine/offers";

import { activeDesign } from "./design-editing";
import { offerExpansionForSegment } from "./scenario-economics";
import type { Scenario } from "./schemas";

/**
 * @spec §4.18 — adapts the durable scenario to the repricing engine.
 *
 * The incumbent plan is not a special data shape: it is a *tier of another design in the same
 * scenario*. That is what makes "current design vs proposed design" a first-class comparison
 * (the §15 M-10 diff already knows how to describe it) and it means the incumbent's value and
 * effective price are computed by the same `expandOffers` path as every other offer — usage
 * lines, credit packs, per-seat multiplication and all. A migration readout can never disagree
 * with the simulator about what the legacy plan costs.
 */
export function migrationInputForScenario(scenario: Scenario): MigrationInput | null {
  const migration = scenario.migration;
  if (!migration) return null;
  const incumbentDesign = scenario.designs.find(
    (design) => design.id === migration.incumbentDesignId,
  );
  if (!incumbentDesign) return null;
  const proposedDesign = activeDesign(scenario);
  // Repricing a design against itself is not a migration; there is nothing to move to.
  if (proposedDesign.id === incumbentDesign.id) return null;

  const segments = migration.base.flatMap((row) => {
    const segment = scenario.model.segments.find((entry) => entry.id === row.segmentId);
    if (!segment) return [];
    const incumbentTier = incumbentDesign.tiers.find((tier) => tier.id === row.incumbentTierId);
    if (!incumbentTier) return [];

    const incumbentOffers = expandOffers(
      offerExpansionForSegment(scenario, incumbentDesign, segment),
    );
    const incumbent = incumbentOffers.find(
      (offer) => offer.owner === "own" && offer.id === `tier:${incumbentTier.id}`,
    );
    if (!incumbent) return [];

    return [
      {
        id: segment.id,
        name: segment.name,
        baseCount: row.baseCount,
        sigma: segment.withinSegmentSigma,
        switchingCost: row.switchingCost,
        incumbent: {
          id: incumbentTier.id,
          name: incumbentTier.name,
          value: incumbent.value,
          effectivePrice: incumbent.effectivePrice,
        },
        proposedOffers: expandOffers(offerExpansionForSegment(scenario, proposedDesign, segment)),
      },
    ];
  });

  return segments.length === 0 ? null : { policy: migration.policy, segments };
}

export function simulateScenarioMigration(scenario: Scenario): MigrationReadout | null {
  const input = migrationInputForScenario(scenario);
  return input ? simulateMigration(input) : null;
}

/** The design the migration is moving *from*, when one is configured and resolvable. */
export function incumbentDesign(scenario: Scenario) {
  if (!scenario.migration) return null;
  return (
    scenario.designs.find((design) => design.id === scenario.migration?.incumbentDesignId) ?? null
  );
}
