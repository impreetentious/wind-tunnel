import { describe, expect, it } from "vitest";

import {
  addAddOn,
  addTier,
  createDesign,
  duplicateActiveDesign,
  renameActiveDesign,
  toggleAddOnFeature,
  toggleFreeTier,
  toggleTierFeature,
} from "./design-editing";
import { scenarioSchema } from "./schemas";
import { plgCollaborationTemplate } from "./templates";

describe("P5 design editing", () => {
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
