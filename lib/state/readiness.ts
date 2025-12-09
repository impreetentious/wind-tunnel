/**
 * @spec §15 M-15 decision-readiness summary + model-limit disclosures.
 *
 * A deterministic checklist that reads a Scenario and reports whether it is
 * ready to be defended in a stakeholder review. Every check is a cited fact,
 * not a judgment call; the summary is what the Decision Record includes at
 * the top of the "assumptions" section so a reader can see at a glance where
 * evidence is thin. This lives in `lib/state/` because it consumes the durable
 * Zod-parsed shape (not the engine).
 */

import type { Scenario } from "./schemas";

export type ReadinessLevel = "ok" | "warning" | "blocker";

export interface ReadinessCheck {
  id: string;
  level: ReadinessLevel;
  title: string;
  detail: string;
}

const MIN_SEGMENTS = 2;
const RECOMMENDED_FEATURES = 3;
const BAND_MIN_WIDTH_RATIO = 1.1;
const BAND_MAX_WIDTH_RATIO = 6;

function bandWidthRatio(band: { p10: number; p90: number }): number {
  if (band.p10 === 0) return band.p90 === 0 ? 1 : Infinity;
  return band.p90 / band.p10;
}

export function evaluateScenarioReadiness(scenario: Scenario): readonly ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  if (scenario.model.segments.length < MIN_SEGMENTS) {
    checks.push({
      id: "segments-min",
      level: "blocker",
      title: `Add at least ${MIN_SEGMENTS} segments`,
      detail:
        "Screening (§4.1) needs at least two segments — otherwise every buyer picks the same offer and the menu tells you nothing new.",
    });
  }

  if (scenario.model.features.length < RECOMMENDED_FEATURES) {
    checks.push({
      id: "features-min",
      level: "warning",
      title: `Only ${scenario.model.features.length} features in the catalog`,
      detail:
        "A menu with fewer than three features cannot fence meaningfully — the linter will read every tier as either dominated or free-tier-leaking.",
    });
  }

  const activeDesign = scenario.designs.find((design) => design.id === scenario.activeDesignId);
  if (activeDesign && activeDesign.tiers.length === 0) {
    checks.push({
      id: "tiers-min",
      level: "blocker",
      title: "The active design has no tiers",
      detail: "Add at least one paid tier before running the simulation.",
    });
  }

  const guessProvenanceCount = scenario.model.segments.reduce((count, segment) => {
    const provenance = segment.provenance;
    let localCount = 0;
    if (provenance.prospectCount.kind === "guess") localCount += 1;
    if (provenance.willingnessToPay.kind === "guess") localCount += 1;
    for (const feature of Object.values(provenance.featureValues)) {
      if (feature.kind === "guess") localCount += 1;
    }
    return count + localCount;
  }, 0);
  if (guessProvenanceCount > 0) {
    checks.push({
      id: "provenance-guess",
      level: "warning",
      title: `${guessProvenanceCount} assumptions still tagged 'guess'`,
      detail:
        "The tornado tells you which of these to validate first. Tagged provenance is what the Decision Record uses to explain why you believe each number.",
    });
  }

  for (const segment of scenario.model.segments) {
    const wtpRatio = bandWidthRatio(segment.wtpBand);
    if (Number.isFinite(wtpRatio) && wtpRatio > BAND_MAX_WIDTH_RATIO) {
      checks.push({
        id: `wtp-band-wide-${segment.id}`,
        level: "warning",
        title: `${segment.name}: WTP P10/P90 spread is ${wtpRatio.toFixed(1)}×`,
        detail:
          "A very wide P10/P90 band is fine as an admission of uncertainty, but if it is above ~6× the tornado will point at this segment above all else. Narrow the band with an interview or a benchmark before defending the decision.",
      });
    } else if (Number.isFinite(wtpRatio) && wtpRatio < BAND_MIN_WIDTH_RATIO) {
      checks.push({
        id: `wtp-band-narrow-${segment.id}`,
        level: "warning",
        title: `${segment.name}: WTP band is essentially deterministic`,
        detail:
          "A near-zero P10/P90 spread implies certainty the underlying data does not support. Widen the band so the uncertainty engine has something to sample.",
      });
    }
  }

  if (scenario.status === "ready" && checks.some((check) => check.level === "blocker")) {
    checks.push({
      id: "status-mismatch",
      level: "warning",
      title: "Scenario status is 'ready' but blockers remain",
      detail:
        "Downgrade the scenario to 'draft' or fix the blockers above — a 'ready' record misleads reviewers about the maturity of the underlying assumptions.",
    });
  }

  return checks;
}

/**
 * Aggregate summary consumers can render as a top-line status: the highest
 * severity present, plus counts by severity. Callers use this to render a
 * traffic-light dot in the Share surface.
 */
export function summarizeReadiness(checks: readonly ReadinessCheck[]): {
  overall: ReadinessLevel;
  counts: Record<ReadinessLevel, number>;
} {
  const counts: Record<ReadinessLevel, number> = { ok: 0, warning: 0, blocker: 0 };
  for (const check of checks) counts[check.level] += 1;
  const overall: ReadinessLevel =
    counts.blocker > 0 ? "blocker" : counts.warning > 0 ? "warning" : "ok";
  return { overall, counts };
}

/**
 * A short, deliberately blunt list of what Wind Tunnel does **not** model.
 * This is the "model-limit disclosure" surface: a stakeholder who reads the
 * Decision Record should see these limits up front so they know the shape of
 * the tool. The list is fixed content, not a derived diagnostic.
 */
export const MODEL_LIMITS: readonly { id: string; title: string; body: string }[] = [
  {
    id: "single-period",
    title: "Single-period screening by default",
    body: "The core engine is a snapshot of buyer choice under a menu. The M-02 extension adds a paid trial and month-over-month retention as opt-in, deterministic overlays — not a stochastic churn hazard, and not annual-vs-monthly discounting.",
  },
  {
    id: "assumption-driven",
    title: "Assumptions in, consequences out — no live data",
    body: "Wind Tunnel runs entirely on the assumptions you enter. It never pulls billing, CRM, or usage data. The sensitivity and research surfaces exist so you can move an assumption from 'guess' to 'evidence' one number at a time.",
  },
  {
    id: "additive-value",
    title: "Feature values are additive by default",
    body: "The default engine sums per-feature values into an offer value. The §4.1.1 extension supports complements and substitutes as pair adjustments, but the model is not a full non-additive utility surface — it is honestly the simplest thing that captures the interaction most menus need.",
  },
  {
    id: "single-currency",
    title: "One currency per scenario",
    body: "A scenario carries a single currency; multi-currency A/B is done by keeping two scenarios. The i18n layer changes how numbers render, not what they mean.",
  },
  {
    id: "no-cash-timing",
    title: "MRR, not cash",
    body: "The economics readout is monthly recurring revenue. Annual contracts are spread evenly across their term; the tool does not model up-front cash, deferred revenue, or discounting.",
  },
];
