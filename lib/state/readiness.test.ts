import { describe, expect, it } from "vitest";

import { evaluateScenarioReadiness, MODEL_LIMITS, summarizeReadiness } from "./readiness";
import { scenarioSchema } from "./schemas";
import { salesLedB2bTemplate } from "./templates";

describe("scenario readiness (M-15)", () => {
  it("the shipped sales template surfaces at most warnings on guessed provenance", () => {
    const scenario = scenarioSchema.parse(salesLedB2bTemplate);
    const checks = evaluateScenarioReadiness(scenario);
    const summary = summarizeReadiness(checks);
    expect(summary.counts.blocker).toBe(0);
    // Templates ship with 'guess' provenance to model an early-stage founder;
    // that should read as a warning, not a blocker.
    expect(summary.counts.warning).toBeGreaterThan(0);
    expect(summary.overall).toBe("warning");
  });

  it("flags a blocker when the active design has no tiers", () => {
    const scenario = scenarioSchema.parse({
      ...salesLedB2bTemplate,
      designs: salesLedB2bTemplate.designs.map((design, index) =>
        index === 0 ? { ...design, tiers: [] } : design,
      ),
      status: "draft",
    });
    const checks = evaluateScenarioReadiness(scenario);
    expect(checks.some((check) => check.id === "tiers-min")).toBe(true);
    expect(summarizeReadiness(checks).overall).toBe("blocker");
  });

  it("flags a status/blocker mismatch when a 'ready' scenario has open blockers", () => {
    const scenario = scenarioSchema.parse({
      ...salesLedB2bTemplate,
      designs: salesLedB2bTemplate.designs.map((design, index) =>
        index === 0 ? { ...design, tiers: [] } : design,
      ),
      status: "draft",
    });
    // Cannot ship a truly `ready` scenario with no tiers through the schema —
    // its refine rejects it — but we can hand-build the check list and confirm
    // the readiness aggregator would surface both.
    const withStatusMismatch = { ...scenario, status: "ready" as const };
    const checks = evaluateScenarioReadiness(withStatusMismatch);
    expect(checks.some((check) => check.id === "status-mismatch")).toBe(true);
  });

  it("ships a non-empty model-limits list", () => {
    expect(MODEL_LIMITS.length).toBeGreaterThan(0);
    for (const entry of MODEL_LIMITS) {
      expect(entry.id).toBeTruthy();
      expect(entry.title).toBeTruthy();
      expect(entry.body.length).toBeGreaterThan(20);
    }
  });
});
