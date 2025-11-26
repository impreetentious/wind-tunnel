import {
  conjointWtpContrast,
  estimateConjoint,
  generateConjointDesign,
  type ConjointDesignOptions,
  type ConjointEstimate,
  type ConjointStudy,
  type ConjointTask,
} from "@/lib/engine/conjoint";

import { resizeBandAtP50 } from "./model-editing";
import type { ConjointStudyRecord, Scenario } from "./schemas";

export interface ConjointCsvError {
  line: number;
  message: string;
}

export interface ConjointCsvParseResult {
  observations: readonly ConjointStudyRecord["observations"][number][];
  errors: readonly ConjointCsvError[];
}

export const CONJOINT_DEMO_CSV = `respondent,task,alternative
r1,task-1,concept-1
r1,task-2,concept-2
r2,task-1,none
r2,task-2,concept-1`;

const requiredColumns = ["respondent", "task", "alternative"] as const;

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
 * Parses respondent/task/alternative rows. A header may name the three columns
 * in any order; headerless input must expose exactly three columns per row.
 */
export function parseConjointCsv(
  input: string,
  tasks: readonly ConjointTask[],
): ConjointCsvParseResult {
  const lines = input
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0);
  if (lines.length === 0) return { observations: [], errors: [] };

  const delimiter = lines[0].line.includes("\t") ? "\t" : ",";
  const firstFields = splitCsvLine(lines[0].line, delimiter);
  if (!firstFields) {
    return {
      observations: [],
      errors: [{ line: lines[0].number, message: "Unclosed quoted value." }],
    };
  }
  const namedColumns = new Map<(typeof requiredColumns)[number], number>();
  firstFields.forEach((field, index) => {
    const key = normalizeHeader(field);
    if (key === "respondent" || key === "respondentid") namedColumns.set("respondent", index);
    else if (key === "task" || key === "taskid") namedColumns.set("task", index);
    else if (key === "alternative" || key === "alternativeid" || key === "chosen")
      namedColumns.set("alternative", index);
  });
  const hasHeader = namedColumns.size > 0;
  const columnIndexes = hasHeader
    ? requiredColumns.map((column) => namedColumns.get(column))
    : requiredColumns.map((_, index) => index);
  const errors: ConjointCsvError[] = [];
  if (hasHeader && columnIndexes.some((index) => index === undefined)) {
    errors.push({
      line: lines[0].number,
      message: "Header must name respondent, task, and alternative columns.",
    });
    return { observations: [], errors };
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const observations: ConjointStudyRecord["observations"][number][] = [];
  for (const entry of lines.slice(hasHeader ? 1 : 0)) {
    const fields = splitCsvLine(entry.line, delimiter);
    if (!fields) {
      errors.push({ line: entry.number, message: "Unclosed quoted value." });
      continue;
    }
    if (!hasHeader && fields.length !== 3) {
      errors.push({ line: entry.number, message: "Expected exactly three columns." });
      continue;
    }
    const [respondentId, taskId, alternativeId] = columnIndexes.map((index) =>
      (fields[index ?? -1] ?? "").trim(),
    );
    if (!respondentId || !taskId || !alternativeId) {
      errors.push({ line: entry.number, message: "Every column needs a non-empty value." });
      continue;
    }
    const task = taskById.get(taskId);
    if (!task) {
      errors.push({ line: entry.number, message: `Unknown task “${taskId}”.` });
      continue;
    }
    if (!task.alternatives.some((alternative) => alternative.id === alternativeId)) {
      errors.push({
        line: entry.number,
        message: `Task “${taskId}” does not include alternative “${alternativeId}”.`,
      });
      continue;
    }
    observations.push({ respondentId, taskId, chosenAlternativeId: alternativeId });
  }

  return { observations, errors };
}

export function conjointCsv(observations: readonly ConjointStudyRecord["observations"][number][]) {
  return [
    "respondent,task,alternative",
    ...observations.map(
      (observation) =>
        `${observation.respondentId},${observation.taskId},${observation.chosenAlternativeId}`,
    ),
  ].join("\n");
}

/** Builds a durable Conjoint record from the design + typed responses. */
export function makeConjointStudy(
  design: ReturnType<typeof generateConjointDesign>,
  study: Pick<ConjointStudy, "attributes" | "numericPrice">,
  observations: readonly ConjointStudyRecord["observations"][number][],
): ConjointStudyRecord {
  return {
    attributes: study.attributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      levels: [...attribute.levels],
    })),
    tasks: design.tasks.map((task) => ({
      id: task.id,
      alternatives: task.alternatives.map((alternative) => ({
        id: alternative.id,
        ...(alternative.levels ? { levels: { ...alternative.levels } } : {}),
        ...(alternative.price !== undefined ? { price: alternative.price } : {}),
        ...(alternative.none ? { none: true as const } : {}),
      })),
    })),
    observations: [...observations],
    numericPrice: study.numericPrice,
  };
}

/** Rehydrates the record into the engine-facing study shape. */
export function conjointStudyForEngine(record: ConjointStudyRecord): ConjointStudy {
  return {
    attributes: record.attributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      levels: attribute.levels,
    })),
    tasks: record.tasks.map((task) => ({
      id: task.id,
      alternatives: task.alternatives.map((alternative) => ({
        id: alternative.id,
        ...(alternative.levels ? { levels: alternative.levels } : {}),
        ...(alternative.price !== undefined ? { price: alternative.price } : {}),
        ...(alternative.none ? { none: true as const } : {}),
      })),
    })),
    observations: record.observations,
    numericPrice: record.numericPrice,
  };
}

export function estimateConjointRecord(record: ConjointStudyRecord): ConjointEstimate {
  return estimateConjoint(conjointStudyForEngine(record));
}

export function scenarioWithConjointStudy(
  scenario: Scenario,
  study: ConjointStudyRecord | undefined,
): Scenario {
  return {
    ...scenario,
    research: {
      ...scenario.research,
      ...(study ? { conjoint: study } : { conjoint: undefined }),
    },
  };
}

/** A demo mapping row: apply attribute contrasts to a segment's feature allocation. */
export interface ConjointBridgeMapping {
  segmentId: string;
  entries: readonly {
    attributeId: string;
    featureId: string;
    referenceLevel: string;
    targetLevel: string;
  }[];
}

export interface ConjointBridgeResult {
  ok: boolean;
  scenario: Scenario;
  reason: string;
  appliedFeatureIds: readonly string[];
}

/**
 * Translates conjoint attribute contrasts into per-feature account-value increments
 * for one selected segment, renormalizes shares, and stamps `conjoint` provenance
 * with the pooled sample size. No-op unless the bridge is enabled.
 */
export function applyConjointBridge(
  scenario: Scenario,
  record: ConjointStudyRecord,
  estimate: ConjointEstimate,
  mapping: ConjointBridgeMapping,
): ConjointBridgeResult {
  if (!estimate.bridgeEnabled) {
    return {
      ok: false,
      scenario,
      reason: estimate.bridgeReason,
      appliedFeatureIds: [],
    };
  }
  const segment = scenario.model.segments.find((candidate) => candidate.id === mapping.segmentId);
  if (!segment) {
    return {
      ok: false,
      scenario,
      reason: "The selected segment is no longer available.",
      appliedFeatureIds: [],
    };
  }
  const featureIds = new Set(scenario.model.features.map((feature) => feature.id));
  const attributeIds = new Set(record.attributes.map((attribute) => attribute.id));
  const validEntries = mapping.entries.filter(
    (entry) =>
      featureIds.has(entry.featureId) &&
      attributeIds.has(entry.attributeId) &&
      entry.targetLevel !== entry.referenceLevel,
  );
  if (validEntries.length === 0) {
    return {
      ok: false,
      scenario,
      reason: "Select at least one attribute and feature pair with distinct levels.",
      appliedFeatureIds: [],
    };
  }
  const currentValues = Object.fromEntries(
    Object.entries(segment.featureAllocation).map(([featureId, share]) => [
      featureId,
      share * segment.wtpBand.p50,
    ]),
  );
  const updates = new Map<string, number>();
  for (const entry of validEntries) {
    const contrast = conjointWtpContrast(
      estimate,
      entry.attributeId,
      entry.targetLevel,
      entry.referenceLevel,
    );
    if (!contrast.enabled || contrast.deltaWtp === undefined) continue;
    updates.set(entry.featureId, (updates.get(entry.featureId) ?? 0) + contrast.deltaWtp);
  }
  if (updates.size === 0) {
    return {
      ok: false,
      scenario,
      reason: "No enabled contrasts changed the featured value.",
      appliedFeatureIds: [],
    };
  }
  const nextValues: Record<string, number> = { ...currentValues };
  for (const [featureId, delta] of updates.entries()) {
    const proposed = (currentValues[featureId] ?? 0) + delta;
    nextValues[featureId] = Math.max(0, proposed);
  }
  const total = Object.values(nextValues).reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    return {
      ok: false,
      scenario,
      reason: "The bridge would leave every feature at zero value.",
      appliedFeatureIds: [],
    };
  }
  const note = `pooled conjoint (N=${estimate.respondentCount})`;
  const provenanceUpdate = {
    kind: "conjoint" as const,
    confidence: "medium" as const,
    note,
  };
  const updatedSegments = scenario.model.segments.map((candidate) =>
    candidate.id === segment.id
      ? {
          ...candidate,
          wtpBand: resizeBandAtP50(candidate.wtpBand, total),
          featureAllocation: Object.fromEntries(
            Object.entries(nextValues).map(([featureId, value]) => [featureId, value / total]),
          ),
          provenance: {
            ...candidate.provenance,
            featureValues: Object.fromEntries(
              Object.entries(candidate.provenance.featureValues).map(([featureId, current]) => [
                featureId,
                updates.has(featureId) ? provenanceUpdate : current,
              ]),
            ),
          },
        }
      : candidate,
  );
  return {
    ok: true,
    scenario: {
      ...scenario,
      model: { ...scenario.model, segments: updatedSegments },
    },
    reason: "Applied pooled conjoint-inferred WTP under the modeled attribute levels.",
    appliedFeatureIds: [...updates.keys()],
  };
}

export type { ConjointDesignOptions };
