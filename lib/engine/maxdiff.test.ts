import { describe, expect, it } from "vitest";

import { generateMaxDiffDesign, scoreMaxDiff } from "./maxdiff";

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
