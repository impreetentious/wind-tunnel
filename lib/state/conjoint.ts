import {
  conjointWtpContrast,
  estimateConjoint,
  generateConjointDesign,
  type ConjointAlternative,
  type ConjointDesignOptions,
  type ConjointEstimate,
  type ConjointStudy,
  type ConjointTask,
} from "@/lib/engine/conjoint";
import { mulberry32 } from "@/lib/engine/montecarlo";

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

/**
 * Shipped synthetic CBC teaching dataset (§6 P7d-2 / E2E-08): 3 attributes × 3 levels
 * plus a numeric account-month price and a "none" alternative. Choices are sampled
 * from `SYNTHETIC_CONJOINT_TRUE_BETA` under the same MNL the estimator fits, so a
 * correct estimator recovers the generating coefficients within 3·SE. The design and
 * the sampler are both seeded, so the study is byte-identical on every load and costs
 * no bundle weight — it is generated, not embedded.
 */
export const SYNTHETIC_CONJOINT_ATTRIBUTES = [
  { id: "speed", name: "Speed", levels: ["low", "medium", "high"] },
  { id: "support", name: "Support", levels: ["self", "priority", "dedicated"] },
  { id: "security", name: "Security", levels: ["basic", "sso", "audit"] },
] as const;

/** Effects-coded speed(2), support(2), security(2), then numeric price, then none. */
export const SYNTHETIC_CONJOINT_TRUE_BETA = [0.4, 0.1, 0.3, -0.2, -0.1, 0.25, -0.03, -0.5] as const;

export const SYNTHETIC_CONJOINT_DESIGN_SEED = 1708;
export const SYNTHETIC_CONJOINT_CHOICE_SEED = 987654321;
export const SYNTHETIC_CONJOINT_RESPONDENTS = 120;
export const SYNTHETIC_CONJOINT_PRICE_LEVELS = [10, 30, 50];

function syntheticEncoded(alternative: ConjointAlternative) {
  if (alternative.none) return [0, 0, 0, 0, 0, 0, 0, 1];
  const encoded: number[] = [];
  for (const attribute of SYNTHETIC_CONJOINT_ATTRIBUTES) {
    const levels: readonly string[] = attribute.levels;
    const index = levels.indexOf(alternative.levels?.[attribute.id] ?? "");
    encoded.push(index === 0 ? 1 : index === 2 ? -1 : 0, index === 1 ? 1 : index === 2 ? -1 : 0);
  }
  encoded.push(alternative.price ?? 0, 0);
  return encoded;
}

function syntheticChoice(task: ConjointTask, random: () => number) {
  const utilities = task.alternatives.map((alternative) =>
    syntheticEncoded(alternative).reduce(
      (sum, value, index) => sum + value * SYNTHETIC_CONJOINT_TRUE_BETA[index],
      0,
    ),
  );
  const max = Math.max(...utilities);
  const weights = utilities.map((utility) => Math.exp(utility - max));
  const target = random() * weights.reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index];
    if (target <= cumulative) return task.alternatives[index].id;
  }
  return task.alternatives.at(-1)?.id ?? "none";
}

/** Builds the shipped synthetic CBC study deterministically. */
export function buildSyntheticConjointStudy(
  respondents = SYNTHETIC_CONJOINT_RESPONDENTS,
): ConjointStudyRecord {
  const attributes = SYNTHETIC_CONJOINT_ATTRIBUTES.map((attribute) => ({
    id: attribute.id,
    name: attribute.name,
    levels: [...attribute.levels],
  }));
  const design = generateConjointDesign({
    attributes,
    taskCount: 18,
    alternativesPerTask: 3,
    priceLevels: [...SYNTHETIC_CONJOINT_PRICE_LEVELS],
    includeNone: true,
    seed: SYNTHETIC_CONJOINT_DESIGN_SEED,
  });
  const random = mulberry32(SYNTHETIC_CONJOINT_CHOICE_SEED);
  const observations: ConjointStudyRecord["observations"][number][] = [];
  for (let respondent = 0; respondent < respondents; respondent += 1) {
    for (const task of design.tasks) {
      observations.push({
        respondentId: `r${respondent + 1}`,
        taskId: task.id,
        chosenAlternativeId: syntheticChoice(task, random),
      });
    }
  }
  return makeConjointStudy(design, { attributes, numericPrice: true }, observations);
}

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
