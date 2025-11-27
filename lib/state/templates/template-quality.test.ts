import { describe, expect, it } from "vitest";

import { simulateScenarioDesign } from "../scenario-economics";
import { scenarioTemplates } from "./index";

describe("worked template quality", () => {
  for (const template of scenarioTemplates) {
    it(`${template.title} opens with decision-useful economics`, () => {
      const design = template.scenario.designs.find(
        (candidate) => candidate.id === template.scenario.activeDesignId,
      );
      expect(design).toBeDefined();
      if (!design) throw new Error("A validated template must have an active design.");
      const result = simulateScenarioDesign(template.scenario, design);
      expect(result).not.toBeNull();
      if (!result) throw new Error("A worked template must have buyer segments.");

      const diagnostic = {
        mrr: result.mrr,
        paidConversion: result.paidConversion,
        captureRate: result.captureRate,
      };
      if (!(result.mrr > 1 && result.paidConversion > 0.01 && result.captureRate > 0.001)) {
        throw new Error(
          `${template.title} is not decision-useful on first load: ${JSON.stringify(diagnostic)}`,
        );
      }
      expect(Math.abs(result.conservationResidual)).toBeLessThan(1e-6);

      if (template.id === "plg-collaboration") {
        expect(result.segments[0].selection.shares["tier:team-tier"]).toBeGreaterThan(0.1);
        expect(result.segments[1].selection.shares["tier:business-tier"]).toBeGreaterThan(0.1);
      }
    });
  }
});
