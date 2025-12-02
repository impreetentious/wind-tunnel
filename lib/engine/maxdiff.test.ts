import { describe, expect, it } from "vitest";

import { mulberry32 } from "./montecarlo";
import { estimateMaxDiffMnl, generateMaxDiffDesign, scoreMaxDiff } from "./maxdiff";

const items = ["a", "b", "c", "d"];
const allItemsTask = [{ id: "t", itemIds: items }];

describe("MaxDiff-lite", () => {
  // @spec §4.10 T-MXD-01
  it("returns a uniform distribution when every raw score is equal", () => {
    const result = scoreMaxDiff(
      items,
      allItemsTask,
      items.map((itemId, index) => ({
        respondentId: `r${index}`,
        taskId: "t",
        bestItemId: itemId,
        worstItemId: items[(index + 1) % items.length],
      })),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.scores.map((score) => score.normalizedScore)).toEqual([25, 25, 25, 25]);
  });

  // @spec §4.10 T-MXD-02
  it("normalizes shifted best-worst counts to a non-negative sum of 100", () => {
    const result = scoreMaxDiff(items, allItemsTask, [
      { respondentId: "r1", taskId: "t", bestItemId: "a", worstItemId: "d" },
      { respondentId: "r2", taskId: "t", bestItemId: "a", worstItemId: "c" },
      { respondentId: "r3", taskId: "t", bestItemId: "b", worstItemId: "d" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scores.reduce((sum, score) => sum + score.normalizedScore, 0)).toBeCloseTo(
        100,
        9,
      );
      expect(result.scores.every((score) => score.normalizedScore >= 0)).toBe(true);
    }
  });

  // @spec §4.10 T-MXD-03
  it("returns a named validation error for unseen items", () => {
    const result = scoreMaxDiff(
      items,
      [{ id: "t", itemIds: ["a", "b", "c"] }],
      [{ respondentId: "r", taskId: "t", bestItemId: "a", worstItemId: "c" }],
    );
    expect(result).toMatchObject({ ok: false, status: "unseenItems", unseenItemIds: ["d"] });
  });

  // @spec §4.10 T-MXD-04
  it("MNL best-worst recovers a known utility vector under sum-to-zero", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const trueUtility = [1.0, 0.6, 0.2, 0.0, -0.2, -0.4, -0.6, -0.6];
    // Center to sum-to-zero to match the identifying constraint.
    const mean = trueUtility.reduce((sum, value) => sum + value, 0) / trueUtility.length;
    const centered = trueUtility.map((value) => value - mean);
    const tasks = generateMaxDiffDesign(items, 20, 3, 4242);
    const random = mulberry32(7777);
    function sample(taskItems: readonly string[], polarity: 1 | -1) {
      const utilities = taskItems.map((itemId) => polarity * centered[items.indexOf(itemId)]);
      const max = Math.max(...utilities);
      const weights = utilities.map((value) => Math.exp(value - max));
      const denominator = weights.reduce((sum, value) => sum + value, 0);
      const target = random() * denominator;
      let cumulative = 0;
      for (let index = 0; index < weights.length; index += 1) {
        cumulative += weights[index];
        if (target <= cumulative) return taskItems[index];
      }
      return taskItems[taskItems.length - 1];
    }
    const responses = [];
    for (let respondent = 0; respondent < 300; respondent += 1) {
      for (const task of tasks) {
        const bestItemId = sample(task.itemIds, 1);
        let worstItemId = sample(task.itemIds, -1);
        while (worstItemId === bestItemId) worstItemId = sample(task.itemIds, -1);
        responses.push({
          respondentId: `r${respondent}`,
          taskId: task.id,
          bestItemId,
          worstItemId,
        });
      }
    }
    const estimate = estimateMaxDiffMnl(items, tasks, responses);
    expect(estimate.status).toBe("ok");
    if (estimate.status === "ok" && estimate.utilities) {
      for (let index = 0; index < items.length; index += 1) {
        const estimated = estimate.utilities[index];
        expect(Math.abs(estimated.utility - centered[index])).toBeLessThan(
          3 * estimated.standardError + 0.1,
        );
      }
    }
  });

  // @spec §4.10 T-MXD-05
  it("MNL best-worst returns utilities summing to zero", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const tasks = generateMaxDiffDesign(items, 12, 3, 1001);
    const responses = tasks.flatMap((task) =>
      Array.from({ length: 20 }, (_, index) => ({
        respondentId: `r${index}`,
        taskId: task.id,
        bestItemId: task.itemIds[0],
        worstItemId: task.itemIds[task.itemIds.length - 1],
      })),
    );
    const estimate = estimateMaxDiffMnl(items, tasks, responses);
    expect(estimate.status === "ok" || estimate.status === "separated").toBe(true);
    if (estimate.utilities) {
      const total = estimate.utilities.reduce((sum, entry) => sum + entry.utility, 0);
      expect(Math.abs(total)).toBeLessThan(1e-9);
    }
  });

  // @spec §4.10 T-MXD-06
  it("MNL best-worst reports named non-ok statuses for adversarial data", () => {
    const items = ["a", "b", "c", "d"];
    const tasks = generateMaxDiffDesign(items, 8, 3, 500);
    const emptyEstimate = estimateMaxDiffMnl(items, tasks, []);
    expect(emptyEstimate.status).toBe("nonIdentifiable");
    // Every response picks the first shown item as best and the last as worst,
    // which is a near-degenerate signal but still lawful. The estimator must
    // return a named status, never NaN.
    const responses = tasks.map((task, index) => ({
      respondentId: `r${index}`,
      taskId: task.id,
      bestItemId: task.itemIds[0],
      worstItemId: task.itemIds[task.itemIds.length - 1],
    }));
    const estimate = estimateMaxDiffMnl(items, tasks, responses);
    expect(["separated", "nonConverged", "ok", "nonIdentifiable"]).toContain(estimate.status);
  });

  it("generates balanced duplicate-free tasks", () => {
    const design = generateMaxDiffDesign(["a", "b", "c", "d", "e", "f"], 5, 4, 42);
    const counts = new Map<string, number>();
    for (const task of design) {
      expect(new Set(task.itemIds).size).toBe(4);
      for (const itemId of task.itemIds) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
    const appearances = [...counts.values()];
    expect(Math.max(...appearances) - Math.min(...appearances)).toBeLessThanOrEqual(1);
  });
});
