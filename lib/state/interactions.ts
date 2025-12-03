import type { Scenario } from "./schemas";

type Interaction = Scenario["model"]["interactions"][number];

const MAX_INTERACTIONS = 12;

function pairKey(a: string, b: string) {
  return [a, b].sort().join("|");
}

function samePair(interaction: Interaction, a: string, b: string) {
  return pairKey(interaction.featureIds[0], interaction.featureIds[1]) === pairKey(a, b);
}

function withInteractions(scenario: Scenario, interactions: readonly Interaction[]): Scenario {
  return { ...scenario, model: { ...scenario.model, interactions: [...interactions] } };
}

export function canAddInteraction(scenario: Scenario) {
  return (
    scenario.model.features.length >= 2 && scenario.model.interactions.length < MAX_INTERACTIONS
  );
}

/**
 * Adds a non-additive pair interaction (§4.1.1). No-ops when the two features
 * are identical, either is unknown, the pair already exists, or the interaction
 * cap is reached — the schema would reject those anyway, and a silent no-op
 * keeps the editor from throwing away an in-progress edit.
 */
export function addInteraction(
  scenario: Scenario,
  featureA: string,
  featureB: string,
  valueFraction = 0,
): Scenario {
  if (featureA === featureB) return scenario;
  const known = new Set(scenario.model.features.map((feature) => feature.id));
  if (!known.has(featureA) || !known.has(featureB)) return scenario;
  if (scenario.model.interactions.length >= MAX_INTERACTIONS) return scenario;
  if (
    scenario.model.interactions.some((interaction) => samePair(interaction, featureA, featureB))
  ) {
    return scenario;
  }
  const clamped = Math.max(-1, Math.min(1, valueFraction));
  return withInteractions(scenario, [
    ...scenario.model.interactions,
    { featureIds: [featureA, featureB], valueFraction: clamped },
  ]);
}

export function setInteractionFraction(
  scenario: Scenario,
  featureA: string,
  featureB: string,
  valueFraction: number,
): Scenario {
  if (!Number.isFinite(valueFraction)) return scenario;
  const clamped = Math.max(-1, Math.min(1, valueFraction));
  return withInteractions(
    scenario,
    scenario.model.interactions.map((interaction) =>
      samePair(interaction, featureA, featureB)
        ? { ...interaction, valueFraction: clamped }
        : interaction,
    ),
  );
}

export function removeInteraction(
  scenario: Scenario,
  featureA: string,
  featureB: string,
): Scenario {
  return withInteractions(
    scenario,
    scenario.model.interactions.filter((interaction) => !samePair(interaction, featureA, featureB)),
  );
}
