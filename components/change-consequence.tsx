"use client";

import { diffScenarios } from "@/lib/state/scenario-diff";
import { scenarioStore, useScenarioStore } from "@/lib/state/scenario-store";

const consequenceByCategory = {
  settings: "formatting and reproducible simulation settings",
  model: "buyer assumptions and every downstream simulation",
  segments: "buyer selection, confidence bands, and the decision record",
  features: "offer value, fences, and the active design",
  designs: "the active menu, linter, simulation, and decision record",
  tiers: "the active menu, revenue simulation, and decision record",
  addOns: "the active menu, revenue simulation, and decision record",
  competitors: "the positioning comparison and decision record",
  interactions: "feature value and the active design simulation",
  usageMetrics: "metered effective prices and usage analysis",
  migration: "the installed-base migration matrix and revenue bridge",
  research: "evidence status and the decision record",
} as const;

/**
 * Makes the latest valid edit legible at the workbench boundary. The actual
 * source of truth remains the scenario store; this is an explanatory trace,
 * not an additional derived-state store.
 */
export function ChangeConsequence() {
  const scenario = useScenarioStore((state) => state.scenario);
  const previous = scenarioStore.temporal.getState().pastStates.at(-1)?.scenario;
  const latest = previous ? diffScenarios(previous, scenario)[0] : undefined;

  return (
    <p aria-live="polite" className="text-sm text-muted">
      <span className="font-semibold text-ink">Change → consequence:</span>{" "}
      {latest
        ? `${latest.path} changed; it refreshes ${consequenceByCategory[latest.category]}.`
        : "make a valid edit to trace its downstream consequence."}
    </p>
  );
}
