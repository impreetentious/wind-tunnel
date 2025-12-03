import { describe, expect, it } from "vitest";

import {
  addInteraction,
  canAddInteraction,
  removeInteraction,
  setInteractionFraction,
} from "./interactions";
import { scenarioSchema } from "./schemas";
import { plgCollaborationTemplate } from "./templates";

/**
 * @spec §4.1 — the state layer that edits non-additive interactions. Every
 * result must stay schema-valid and reject invalid pairs without throwing.
 */
describe("interaction state layer", () => {
  const [a, b, c] = plgCollaborationTemplate.model.features;

  it("adds, updates, and removes a pair while staying schema-valid", () => {
    const added = addInteraction(plgCollaborationTemplate, a.id, b.id, 0.2);
    expect(added.model.interactions).toHaveLength(1);
    expect(added.model.interactions[0]).toMatchObject({
      featureIds: [a.id, b.id],
      valueFraction: 0.2,
    });
    expect(scenarioSchema.safeParse(added).success).toBe(true);

    // Order-independent update of the same unordered pair.
    const updated = setInteractionFraction(added, b.id, a.id, -0.4);
    expect(updated.model.interactions[0].valueFraction).toBe(-0.4);

    const removed = removeInteraction(updated, a.id, b.id);
    expect(removed.model.interactions).toHaveLength(0);
    expect(scenarioSchema.safeParse(removed).success).toBe(true);
  });

  it("clamps the value fraction into [-1, 1]", () => {
    const added = addInteraction(plgCollaborationTemplate, a.id, b.id, 5);
    expect(added.model.interactions[0].valueFraction).toBe(1);
    const lowered = setInteractionFraction(added, a.id, b.id, -9);
    expect(lowered.model.interactions[0].valueFraction).toBe(-1);
  });

  it("no-ops on a self-pair, an unknown feature, or a duplicate pair", () => {
    expect(addInteraction(plgCollaborationTemplate, a.id, a.id, 0.1)).toBe(
      plgCollaborationTemplate,
    );
    expect(addInteraction(plgCollaborationTemplate, a.id, "ghost", 0.1)).toBe(
      plgCollaborationTemplate,
    );
    const once = addInteraction(plgCollaborationTemplate, a.id, c.id, 0.1);
    expect(addInteraction(once, c.id, a.id, 0.3)).toBe(once);
  });

  it("reports capacity from feature count", () => {
    expect(canAddInteraction(plgCollaborationTemplate)).toBe(true);
  });
});
