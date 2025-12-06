import { describe, expect, it } from "vitest";

import { activeDesign } from "./design-editing";
import { scenarioSchema } from "./schemas";
import { simulateScenarioDesign } from "./scenario-economics";
import { salesLedB2bTemplate } from "./templates";
import { projectScenarioTimeDynamics } from "./time-dynamics";

function baseScenario() {
  return scenarioSchema.parse(salesLedB2bTemplate);
}

describe("scenario time dynamics adapter (@spec §4.16)", () => {
  it("zero-default at periods=0 reproduces the §4.3 readout MRR byte-identical", () => {
    const scenario = baseScenario();
    const design = activeDesign(scenario);
    const readout = simulateScenarioDesign(scenario, design);
    expect(readout).not.toBeNull();
    if (!readout) return;
    const projected = projectScenarioTimeDynamics(scenario, readout, 0);
    expect(projected).not.toBeNull();
    if (!projected) return;
    expect(projected.points).toHaveLength(1);
    expect(projected.points[0].mrr).toBeCloseTo(readout.mrr, 8);
    expect(projected.cumulativeRevenue).toBeCloseTo(readout.mrr, 8);
  });

  it("a segment-level retention of 0.9 shrinks month-over-month MRR geometrically", () => {
    const parsed = baseScenario();
    // Attach retention only to the midmarket segment; others stay defaulted.
    const scenario = {
      ...parsed,
      model: {
        ...parsed.model,
        segments: parsed.model.segments.map((segment) =>
          segment.id === "midmarket"
            ? {
                ...segment,
                timeDynamics: {
                  trialLengthMonths: 0,
                  trialConversion: 1,
                  monthlyRetention: 0.9,
                  contractTerm: "monthly" as const,
                },
              }
            : segment,
        ),
      },
    };
    const readout = simulateScenarioDesign(scenario, activeDesign(scenario));
    const projected = projectScenarioTimeDynamics(scenario, readout, 3);
    expect(projected).not.toBeNull();
    if (!readout || !projected) return;
    const mid = projected.segments.find((row) => row.id === "midmarket");
    expect(mid).toBeDefined();
    if (!mid) return;
    const t0 = mid.points[0].mrr;
    expect(mid.points[1].mrr).toBeCloseTo(t0 * 0.9, 8);
    expect(mid.points[2].mrr).toBeCloseTo(t0 * 0.9 ** 2, 8);
    expect(mid.points[3].mrr).toBeCloseTo(t0 * 0.9 ** 3, 8);
  });
});
