import { generateMaxDiffDesign, scoreMaxDiff, type MaxDiffResult } from "@/lib/engine/maxdiff";

import type { MaxDiffStudyRecord, Scenario } from "./schemas";

export interface MaxDiffCsvError {
  line: number;
  message: string;
}

export interface MaxDiffCsvParseResult {
  responses: readonly MaxDiffStudyRecord["responses"][number][];
  errors: readonly MaxDiffCsvError[];
}

export const MAX_DIFF_DEMO_CSV = `respondent,task,best,worst
r1,maxdiff-1,item-a,item-c
r1,maxdiff-2,item-b,item-d
r2,maxdiff-1,item-a,item-b`;

const requiredColumns = ["respondent", "task", "best", "worst"] as const;

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function splitCsvLine(line: string, delimiter: string) {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      fields.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current.trim());
  return quoted ? undefined : fields;
}

/**
 * Parses respondent/task/best/worst rows. A header may name the four columns in
 * any order; headerless input must expose exactly four columns per row.
 */
export function parseMaxDiffCsv(
  input: string,
  tasks: readonly MaxDiffStudyRecord["tasks"][number][],
): MaxDiffCsvParseResult {
  const lines = input
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0);
  if (lines.length === 0) return { responses: [], errors: [] };

  const delimiter = lines[0].line.includes("\t") ? "\t" : ",";
  const firstFields = splitCsvLine(lines[0].line, delimiter);
  if (!firstFields) {
    return {
      responses: [],
      errors: [{ line: lines[0].number, message: "Unclosed quoted value." }],
    };
  }
  const namedColumns = new Map<(typeof requiredColumns)[number], number>();
  firstFields.forEach((field, index) => {
    const key = normalizeHeader(field);
    if (key === "respondent" || key === "respondentid") namedColumns.set("respondent", index);
    else if (key === "task" || key === "taskid") namedColumns.set("task", index);
    else if (key === "best" || key === "bestitem" || key === "bestitemid")
      namedColumns.set("best", index);
    else if (key === "worst" || key === "worstitem" || key === "worstitemid")
      namedColumns.set("worst", index);
  });
  const hasHeader = namedColumns.size > 0;
  const columnIndexes = hasHeader
    ? requiredColumns.map((column) => namedColumns.get(column))
    : requiredColumns.map((_, index) => index);
  const errors: MaxDiffCsvError[] = [];
  if (hasHeader && columnIndexes.some((index) => index === undefined)) {
    errors.push({
      line: lines[0].number,
      message: "Header must name respondent, task, best, and worst columns.",
    });
    return { responses: [], errors };
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const responses: MaxDiffStudyRecord["responses"][number][] = [];
  for (const entry of lines.slice(hasHeader ? 1 : 0)) {
    const fields = splitCsvLine(entry.line, delimiter);
    if (!fields) {
      errors.push({ line: entry.number, message: "Unclosed quoted value." });
      continue;
    }
    if (!hasHeader && fields.length !== 4) {
      errors.push({ line: entry.number, message: "Expected exactly four columns." });
      continue;
    }
    const [respondentId, taskId, bestItemId, worstItemId] = columnIndexes.map((index) =>
      (fields[index ?? -1] ?? "").trim(),
    );
    if (!respondentId || !taskId || !bestItemId || !worstItemId) {
      errors.push({ line: entry.number, message: "Every column needs a non-empty value." });
      continue;
    }
    if (bestItemId === worstItemId) {
      errors.push({
        line: entry.number,
        message: "Best and worst must be different items.",
      });
      continue;
    }
    const task = taskById.get(taskId);
    if (!task) {
      errors.push({ line: entry.number, message: `Unknown task “${taskId}”.` });
      continue;
    }
    if (!task.itemIds.includes(bestItemId) || !task.itemIds.includes(worstItemId)) {
      errors.push({
        line: entry.number,
        message: `Task “${taskId}” must show both items.`,
      });
      continue;
    }
    responses.push({ respondentId, taskId, bestItemId, worstItemId });
  }

  return { responses, errors };
}

export function maxDiffCsv(responses: readonly MaxDiffStudyRecord["responses"][number][]) {
  return [
    "respondent,task,best,worst",
    ...responses.map(
      (response) =>
        `${response.respondentId},${response.taskId},${response.bestItemId},${response.worstItemId}`,
    ),
  ].join("\n");
}

export function makeMaxDiffStudy(
  items: readonly MaxDiffStudyRecord["items"][number][],
  taskCount: number,
  itemsPerTask: number,
  seed: number,
  responses: readonly MaxDiffStudyRecord["responses"][number][] = [],
): MaxDiffStudyRecord {
  const tasks = generateMaxDiffDesign(
    items.map((item) => item.id),
    taskCount,
    itemsPerTask,
    seed,
  );
  return {
    items: items.map((item) => ({ id: item.id, name: item.name })),
    tasks: tasks.map((task) => ({ id: task.id, itemIds: [...task.itemIds] })),
    responses: [...responses],
  };
}

export function scoreMaxDiffRecord(record: MaxDiffStudyRecord): MaxDiffResult {
  return scoreMaxDiff(
    record.items.map((item) => item.id),
    record.tasks,
    record.responses,
  );
}

export function scenarioWithMaxDiffStudy(
  scenario: Scenario,
  study: MaxDiffStudyRecord | undefined,
): Scenario {
  return {
    ...scenario,
    research: {
      ...scenario.research,
      ...(study ? { maxDiff: study } : { maxDiff: undefined }),
    },
  };
}
