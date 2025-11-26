import { mulberry32 } from "./montecarlo";

export interface MaxDiffTask {
  id: string;
  itemIds: readonly string[];
}

export interface MaxDiffResponse {
  respondentId: string;
  taskId: string;
  bestItemId: string;
  worstItemId: string;
}

export interface MaxDiffScore {
  itemId: string;
  appearances: number;
  bestCount: number;
  worstCount: number;
  rawScore: number;
  normalizedScore: number;
}

export type MaxDiffResult =
  | { ok: true; scores: readonly MaxDiffScore[] }
  | {
      ok: false;
      status: "unseenItems" | "invalidResponse";
      error: string;
      unseenItemIds?: readonly string[];
    };

export function scoreMaxDiff(
  itemIds: readonly string[],
  tasks: readonly MaxDiffTask[],
  responses: readonly MaxDiffResponse[],
): MaxDiffResult {
  if (
    itemIds.length < 2 ||
    itemIds.some((itemId) => !itemId) ||
    new Set(itemIds).size !== itemIds.length
  ) {
    throw new RangeError("MaxDiff item IDs must contain at least two non-empty unique values.");
  }
  const itemSet = new Set(itemIds);
  const taskById = new Map<string, MaxDiffTask>();
  for (const task of tasks) {
    if (
      !task.id ||
      taskById.has(task.id) ||
      task.itemIds.length < 2 ||
      new Set(task.itemIds).size !== task.itemIds.length ||
      task.itemIds.some((itemId) => !itemSet.has(itemId))
    ) {
      throw new RangeError("Every MaxDiff task needs a unique ID and distinct known items.");
    }
    taskById.set(task.id, task);
  }
  const counts = new Map(itemIds.map((itemId) => [itemId, { appearances: 0, best: 0, worst: 0 }]));
  for (const response of responses) {
    const task = taskById.get(response.taskId);
    if (
      !task ||
      response.bestItemId === response.worstItemId ||
      !task.itemIds.includes(response.bestItemId) ||
      !task.itemIds.includes(response.worstItemId)
    ) {
      return {
        ok: false,
        status: "invalidResponse",
        error: `Response for task “${response.taskId}” must choose distinct displayed best and worst items.`,
      };
    }
    for (const itemId of task.itemIds) {
      const count = counts.get(itemId);
      if (count) count.appearances += 1;
    }
    const best = counts.get(response.bestItemId);
    const worst = counts.get(response.worstItemId);
    if (best) best.best += 1;
    if (worst) worst.worst += 1;
  }
  const unseenItemIds = itemIds.filter((itemId) => (counts.get(itemId)?.appearances ?? 0) === 0);
  if (unseenItemIds.length > 0) {
    return {
      ok: false,
      status: "unseenItems",
      unseenItemIds,
      error: `No observed task exposure for: ${unseenItemIds.join(", ")}.`,
    };
  }
  const raw = itemIds.map((itemId) => {
    const count = counts.get(itemId)!;
    return (count.best - count.worst) / count.appearances;
  });
  const minimum = Math.min(...raw);
  const shifted = raw.map((value) => value - minimum);
  const total = shifted.reduce((sum, value) => sum + value, 0);
  return {
    ok: true,
    scores: itemIds.map((itemId, index) => {
      const count = counts.get(itemId)!;
      return {
        itemId,
        appearances: count.appearances,
        bestCount: count.best,
        worstCount: count.worst,
        rawScore: raw[index],
        normalizedScore: total === 0 ? 100 / itemIds.length : (shifted[index] / total) * 100,
      };
    }),
  };
}

function shuffle<T>(values: T[], random: () => number) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

export function generateMaxDiffDesign(
  itemIds: readonly string[],
  taskCount: number,
  itemsPerTask: number,
  seed: number,
) {
  if (itemIds.length < itemsPerTask || itemsPerTask < 3 || itemsPerTask > 5) {
    throw new RangeError("MaxDiff tasks show 3–5 distinct items from a large-enough item list.");
  }
  if (
    !(Number.isInteger(taskCount) && taskCount > 0 && taskCount * itemsPerTask >= itemIds.length)
  ) {
    throw new RangeError(
      "MaxDiff task count must be positive and expose every item at least once.",
    );
  }
  if (new Set(itemIds).size !== itemIds.length || itemIds.some((itemId) => !itemId)) {
    throw new RangeError("MaxDiff item IDs must be non-empty and unique.");
  }
  const slots = taskCount * itemsPerTask;
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const random = mulberry32((seed + attempt * 0x9e3779b9) >>> 0);
    const sequence = shuffle(
      Array.from({ length: slots }, (_, index) => itemIds[index % itemIds.length]),
      random,
    );
    const tasks = Array.from({ length: taskCount }, (_, index) => ({
      id: `maxdiff-${index + 1}`,
      itemIds: sequence.slice(index * itemsPerTask, (index + 1) * itemsPerTask),
    }));
    if (tasks.every((task) => new Set(task.itemIds).size === task.itemIds.length)) return tasks;
  }
  throw new RangeError("Could not generate a balanced duplicate-free MaxDiff design.");
}
