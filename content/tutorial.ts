/**
 * @spec §15 M-13 in-app worked tutorial ("defend this decision" walkthrough).
 *
 * Content-only module: the tutorial script lives here, and the overlay in
 * `components/tutorial-overlay.tsx` renders it. Splitting content from UI lets
 * the copy be reviewed on its own (owner review workflow) and keeps this
 * module engine-pure — no React, no DOM, no state.
 */

export type TutorialSurface = "model" | "design" | "simulate" | "analyze" | "positioning" | "share";

export interface TutorialStep {
  id: string;
  /** Which top-level surface this step focuses on (used to jump the tabs). */
  surface: TutorialSurface;
  title: string;
  body: string;
  /** Optional "look here" anchor: a `data-tour="..."` attribute in the DOM. */
  anchor?: string;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "intro",
    surface: "model",
    title: "You are defending a pricing decision — not asking for one",
    body: "Wind Tunnel takes your explicit buyer assumptions and shows what they imply for revenue, capture rate, and cannibalization. The tutorial walks the full loop with the sales-led B2B template so the outputs are grounded.",
  },
  {
    id: "segments",
    surface: "model",
    title: "Segments carry the assumptions that drive everything downstream",
    body: "Each segment has a size band, a WTP band, and a within-segment spread σ. The Model workbench shows how a single number moves every KPI — that is exactly the leverage the linter and Monte Carlo will highlight later.",
    anchor: "model-segment-panel",
  },
  {
    id: "features",
    surface: "model",
    title: "Feature values are allocation shares of a segment's total WTP",
    body: "Instead of guessing $/feature, you split total WTP into shares that sum to 1. This keeps the math grounded in a total you can defend and makes the segment × feature matrix comparable across scenarios.",
    anchor: "model-feature-allocation",
  },
  {
    id: "design",
    surface: "design",
    title: "Tiers are feature fences, not walls of features",
    body: "A tier is defined by which features it lets buyers pay for. Wind Tunnel automatically enumerates the tier + add-on subsets and picks the utility-maximizing one for every buyer type — no per-feature hand-waving.",
    anchor: "design-tier-panel",
  },
  {
    id: "simulate",
    surface: "simulate",
    title: "The value waterfall shows where potential value goes",
    body: "Potential = Revenue + Own-buyer surplus + Fencing gap + Unserved + Competitor loss. If the waterfall is dominated by fencing gap, tighter fences would help; if it is dominated by unserved value, the low tier is under-configured.",
    anchor: "simulate-waterfall",
  },
  {
    id: "uncertainty",
    surface: "analyze",
    title: "The tornado ranks assumptions by their MRR sensitivity",
    body: "The tornado plots each assumption's ±band's effect on P50 MRR. Cross-reference the top drivers with the provenance column: assumptions tagged 'guess' at the top of the tornado are your validation to-do list.",
    anchor: "uncertainty-tornado",
  },
  {
    id: "elasticity",
    surface: "analyze",
    title: "Elasticity tells you which tier is close to a revenue peak",
    body: "Own-price demand elasticity is always ≤ 0 at a healthy envelope; revenue elasticity crosses zero at a local revenue peak. The substitution heatmap shows where buyers who leave a tier go — critical for cannibalization.",
    anchor: "elasticity-table",
  },
  {
    id: "price-search",
    surface: "analyze",
    title: "Price search finds a local optimum — not the answer",
    body: "The joint optimizer runs coordinate descent from perturbations of the current design. It labels every result 'local optimum', keeps the per-tier sweep as the primary lens, and lets you Apply-to-active only after you have read the diagnostics.",
    anchor: "optimizer-result",
  },
  {
    id: "positioning",
    surface: "positioning",
    title: "Competitors compete on value AND price — the map shows both",
    body: "The segment-scoped Pareto map plots Pareto-non-dominated competitors and zero-utility rays. Any tier below and left of a competitor is directly dominated: use the survey shortcut to import stated competitor values instead of guessing.",
    anchor: "positioning-map",
  },
  {
    id: "share",
    surface: "share",
    title: "The Decision Record is the artifact you defend the decision with",
    body: "Share → Decision Record generates a Markdown/print-CSS PDF: assumptions with provenance, the design, simulated economics, sensitivity, linter findings, and alternatives. It is what a stakeholder review reads — not the tool.",
    anchor: "share-record",
  },
];

export interface TutorialState {
  active: boolean;
  stepIndex: number;
}

export const INITIAL_TUTORIAL_STATE: TutorialState = { active: false, stepIndex: 0 };

/** Selects the tutorial step at `stepIndex`, clamped to the valid range. */
export function currentTutorialStep(state: TutorialState): TutorialStep | null {
  if (!state.active) return null;
  return TUTORIAL_STEPS[Math.max(0, Math.min(state.stepIndex, TUTORIAL_STEPS.length - 1))] ?? null;
}

export function advanceTutorial(state: TutorialState): TutorialState {
  if (!state.active) return state;
  const next = state.stepIndex + 1;
  if (next >= TUTORIAL_STEPS.length) return { active: false, stepIndex: 0 };
  return { ...state, stepIndex: next };
}

export function restartTutorial(): TutorialState {
  return { active: true, stepIndex: 0 };
}
