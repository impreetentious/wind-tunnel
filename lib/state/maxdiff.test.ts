import { describe, expect, it } from "vitest";

import {
  MAX_DIFF_DEMO_CSV,
  makeMaxDiffStudy,
  maxDiffCsv,
  parseMaxDiffCsv,
  scenarioWithMaxDiffStudy,
  scoreMaxDiffRecord,
} from "./maxdiff";
import { scenarioTemplates } from "./templates";

describe("MaxDiff scenario adapter", () => {
  // @spec §4.10
  it("parses headered CSV and rejects malformed rows", () => {
    const items = [
      { id: "item-a", name: "A" },
      { id: "item-b", name: "B" },
      { id: "item-c", name: "C" },
      { id: "item-d", name: "D" },
    ];
    const study = makeMaxDiffStudy(items, 2, 4, 42);
    const csv = `respondent,task,best,worst
r1,${study.tasks[0].id},${study.tasks[0].itemIds[0]},${study.tasks[0].itemIds[1]}
r1,${study.tasks[0].id},${study.tasks[0].itemIds[0]},${study.tasks[0].itemIds[0]}
r2,missing,${study.tasks[0].itemIds[0]},${study.tasks[0].itemIds[1]}`;
    const parsed = parseMaxDiffCsv(csv, study.tasks);
    expect(parsed.responses).toHaveLength(1);
    expect(parsed.errors.map((error) => error.line)).toEqual([3, 4]);
    const serialized = maxDiffCsv(parsed.responses);
    expect(serialized.split("\n")[0]).toBe("respondent,task,best,worst");
  });

  // @spec §4.10
  it("scores the durable record via the engine", () => {
    const items = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
      { id: "d", name: "D" },
    ];
    const durable = makeMaxDiffStudy(items, 4, 3, 7);
    const responses = durable.tasks.map((task, index) => ({
      respondentId: `r${index}`,
      taskId: task.id,
      bestItemId: task.itemIds[0],
      worstItemId: task.itemIds[task.itemIds.length - 1],
    }));
    const scored = scoreMaxDiffRecord({ ...durable, responses });
    expect(scored.ok).toBe(true);
    if (scored.ok) {
      expect(scored.scores.reduce((sum, score) => sum + score.normalizedScore, 0)).toBeCloseTo(
        100,
        6,
      );
    }
  });

  it("persists MaxDiff studies onto the scenario slot", () => {
    const scenario = scenarioTemplates[0].scenario;
    const items = scenario.model.features.slice(0, 4).map((feature) => ({
      id: feature.id,
      name: feature.name,
    }));
    if (items.length < 3) {
      const supplement = [
        { id: "extra-a", name: "Extra A" },
        { id: "extra-b", name: "Extra B" },
        { id: "extra-c", name: "Extra C" },
      ];
      items.push(...supplement.slice(0, 3 - items.length));
    }
    const study = makeMaxDiffStudy(items, 4, 3, 99);
    const updated = scenarioWithMaxDiffStudy(scenario, study);
    expect(updated.research.maxDiff).toEqual(study);
    expect(MAX_DIFF_DEMO_CSV.split("\n")[0]).toBe("respondent,task,best,worst");
  });
});
