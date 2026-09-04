import { describe, expect, it } from "vitest";

import {
  activeDesign,
  addAddOn,
  addTier,
  createDesign,
  duplicateActiveDesign,
  removeTier,
  renameActiveDesign,
  selectActiveDesign,
  toggleAddOnFeature,
  toggleFreeTier,
  toggleTierFeature,
} from "./design-editing";
import { scenarioSchema, type Scenario } from "./schemas";
import { plgCollaborationTemplate } from "./templates";

/** The active design with a §4.19 floor on its first tier. */
function withDiscountPolicy(): { scenario: Scenario; tierId: string } {
  const base = scenarioSchema.parse(plgCollaborationTemplate);
  const tierId = activeDesign(base).tiers[0].id;
  return {
    tierId,
    scenario: scenarioSchema.parse({
      ...base,
      designs: base.designs.map((design) =>
        design.id === base.activeDesignId
          ? { ...design, discountPolicies: [{ tierId, floorFraction: 0.2 }] }
          : design,
      ),
    }),
  };
}

describe("design editing", () => {
  it("creates, duplicates, and renames independently addressable designs", () => {
    const created = createDesign(plgCollaborationTemplate, "Experiment");
    expect(created.activeDesignId).toBe("experiment");
    expect(created.designs).toHaveLength(2);

    const duplicated = duplicateActiveDesign(created);
    const renamed = renameActiveDesign(duplicated, "Experiment B");
    expect(renamed.designs).toHaveLength(3);
    expect(renamed.designs.find((design) => design.id === renamed.activeDesignId)?.name).toBe(
      "Experiment B",
    );
    expect(scenarioSchema.safeParse(renamed).success).toBe(true);
  });

  it("edits tiers, a free tier, fences, and add-ons within their schema limits", () => {
    const blankDesign = createDesign(plgCollaborationTemplate, "Blank packaging");
    const free = toggleFreeTier(blankDesign, true);
    const firstPaid = addTier(free);
    const secondPaid = addTier(firstPaid);
    const active = secondPaid.designs.find((design) => design.id === secondPaid.activeDesignId)!;
    const withFence = toggleTierFeature(secondPaid, active.tiers[1].id, "workspace");
    const withAddOn = addAddOn(withFence);
    const addOn = withAddOn.designs.find((design) => design.id === withAddOn.activeDesignId)!
      .addOns[0];
    const untouchedSingleFeature = toggleAddOnFeature(withAddOn, addOn.id, "workspace");

    expect(
      untouchedSingleFeature.designs.find(
        (design) => design.id === untouchedSingleFeature.activeDesignId,
      )!.addOns[0].featureIds,
    ).toEqual(["workspace"]);
    expect(scenarioSchema.safeParse(untouchedSingleFeature).success).toBe(true);
  });
});

// Tier ids are referenced from two other places in the durable shape, and both are schema
// cross-validated. An edit that leaves either reference dangling is not a partial success — the
// store parses the whole scenario, so the whole edit is discarded and the button reads as broken.
describe("design editing keeps tier references intact", () => {
  it("re-points discount policies onto the copied tiers when a design is duplicated", () => {
    const { scenario, tierId } = withDiscountPolicy();
    const duplicated = duplicateActiveDesign(scenario);
    const parsed = scenarioSchema.safeParse(duplicated);
    expect(parsed.success).toBe(true);

    const copy = activeDesign(duplicated);
    expect(copy.discountPolicies).toHaveLength(1);
    expect(copy.discountPolicies?.[0].tierId).toBe(`${tierId}-copy`);
    expect(copy.tiers.some((tier) => tier.id === copy.discountPolicies?.[0].tierId)).toBe(true);
    expect(copy.discountPolicies?.[0].floorFraction).toBe(0.2);
    // The source design keeps its own policy pointed at its own tier.
    const source = duplicated.designs.find((design) => design.id === scenario.activeDesignId)!;
    expect(source.discountPolicies?.[0].tierId).toBe(tierId);
  });

  it("drops the discount policy written against a removed tier", () => {
    const { scenario, tierId } = withDiscountPolicy();
    const removed = removeTier(scenario, tierId);
    expect(scenarioSchema.safeParse(removed).success).toBe(true);
    expect(activeDesign(removed).tiers.some((tier) => tier.id === tierId)).toBe(false);
    // The last policy is dropped to `undefined`, not to an empty array: absent is what the
    // schema and the discount surface both read as "list price is the achieved price".
    expect(activeDesign(removed).discountPolicies).toBeUndefined();
  });

  it("keeps unrelated discount policies when one tier is removed", () => {
    const { scenario, tierId } = withDiscountPolicy();
    const design = activeDesign(scenario);
    const otherTierId = design.tiers[1].id;
    const withBoth = scenarioSchema.parse({
      ...scenario,
      designs: scenario.designs.map((candidate) =>
        candidate.id === design.id
          ? {
              ...candidate,
              discountPolicies: [
                { tierId, floorFraction: 0.2 },
                { tierId: otherTierId, floorFraction: 0.3 },
              ],
            }
          : candidate,
      ),
    });
    const removed = removeTier(withBoth, tierId);
    expect(scenarioSchema.safeParse(removed).success).toBe(true);
    expect(activeDesign(removed).discountPolicies).toEqual([
      { tierId: otherTierId, floorFraction: 0.3 },
    ]);
  });

  it("drops installed-base rows sitting on a tier removed from the incumbent design", () => {
    const base = scenarioSchema.parse(plgCollaborationTemplate);
    const incumbentId = base.activeDesignId;
    const incumbentTierId = activeDesign(base).tiers[0].id;
    const withProposal = scenarioSchema.parse(createDesign(base, "Proposal"));
    const withMigration = scenarioSchema.parse({
      ...withProposal,
      migration: {
        policy: "grandfather",
        incumbentDesignId: incumbentId,
        base: withProposal.model.segments.map((segment) => ({
          segmentId: segment.id,
          incumbentTierId,
          baseCount: 100,
          switchingCost: 0,
        })),
      },
    });
    // Editing the incumbent design directly is what makes its tier ids reachable from `removeTier`.
    const editingIncumbent = scenarioSchema.parse(selectActiveDesign(withMigration, incumbentId));
    const removed = removeTier(editingIncumbent, incumbentTierId);
    expect(scenarioSchema.safeParse(removed).success).toBe(true);
    expect(removed.migration?.base).toEqual([]);

    // A tier removed from some *other* design leaves the installed base alone.
    const editingProposal = scenarioSchema.parse(
      selectActiveDesign(withMigration, withProposal.activeDesignId),
    );
    const untouched = removeTier(editingProposal, activeDesign(editingProposal).tiers[0].id);
    expect(untouched.migration?.base).toHaveLength(withMigration.migration!.base.length);
  });
});
