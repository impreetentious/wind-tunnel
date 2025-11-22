import { describe, expect, it } from "vitest";

import { scenarioSchema } from "./schemas";
import {
  simulateScenarioDesign,
  runScenarioMonteCarlo,
  uncertaintyParametersForScenario,
} from "./scenario-economics";
import { salesLedB2bTemplate } from "./templates";

function deterministicSalesScenario() {
  return scenarioSchema.parse({
    ...salesLedB2bTemplate,
    model: {
      ...salesLedB2bTemplate.model,
      segments: salesLedB2bTemplate.model.segments.map((segment) => ({
        ...segment,
        prospectBand: {
          p10: segment.prospectBand.p50,
          p50: segment.prospectBand.p50,
          p90: segment.prospectBand.p50,
        },
        wtpBand: {
          p10: segment.wtpBand.p50,
          p50: segment.wtpBand.p50,
          p90: segment.wtpBand.p50,
        },
      })),
    },
  });
}

describe("P7a scenario uncertainty adapter", () => {
  // @spec §4.8
  it("maps size and WTP bands through the existing closed-form scenario simulation", () => {
    const scenario = deterministicSalesScenario();
    const parameters = uncertaintyParametersForScenario(scenario);
    const result = runScenarioMonteCarlo(scenario, 200);
    const design = scenario.designs.find((candidate) => candidate.id === scenario.activeDesignId);

    expect(parameters.map((parameter) => parameter.id)).toEqual([
      "midmarket:prospect-count",
      "midmarket:willingness-to-pay",
      "enterprise-buyers:prospect-count",
      "enterprise-buyers:willingness-to-pay",
    ]);
    expect(result).not.toBeNull();
    expect(design).toBeDefined();
    if (!result || !design) throw new Error("Expected a ready scenario result.");

    const analytic = simulateScenarioDesign(scenario, design);
    expect(analytic).not.toBeNull();
    if (!analytic) throw new Error("Expected an analytic scenario result.");

    expect(result.distributions[0].percentiles).toMatchObject({
      p10: analytic.mrr,
      p50: analytic.mrr,
      p90: analytic.mrr,
    });
    expect(result.distributions[0].percentiles.mean).toBeCloseTo(analytic.mrr, 9);
    expect(result.tornado.every((driver) => driver.maximumAbsoluteDelta === 0)).toBe(true);
  });
});
