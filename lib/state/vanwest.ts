import type { VanWestendorpResponse } from "@/lib/engine/vanwest";

import type { Scenario, VanWestendorpStudy } from "./schemas";

export interface VanWestendorpCsvError {
  line: number;
  message: string;
}

export interface VanWestendorpCsvParseResult {
  responses: readonly VanWestendorpResponse[];
  errors: readonly VanWestendorpCsvError[];
}

const requiredColumns = ["tooCheap", "cheap", "expensive", "tooExpensive"] as const;

export const VAN_WESTENDORP_DEMO_CSV = `too cheap,cheap,expensive,too expensive
10,20,40,60
15,25,45,65
20,30,50,70
25,35,55,75
30,40,60,80`;

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function headerColumn(value: string): (typeof requiredColumns)[number] | undefined {
  switch (normalizeHeader(value)) {
    case "toocheap":
      return "tooCheap";
    case "cheap":
      return "cheap";
    case "expensive":
      return "expensive";
    case "tooexpensive":
      return "tooExpensive";
    default:
      return undefined;
  }
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
 * Parses CSV or tab-separated PSM entries. A header may name the four required
 * columns in any order; headerless input must have exactly four price columns.
 */
export function parseVanWestendorpCsv(input: string): VanWestendorpCsvParseResult {
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
    const column = headerColumn(field);
    if (column) namedColumns.set(column, index);
  });
  const hasHeader = namedColumns.size > 0;
  const columnIndexes = hasHeader
    ? requiredColumns.map((column) => namedColumns.get(column))
    : requiredColumns.map((_, index) => index);
  const errors: VanWestendorpCsvError[] = [];
  if (hasHeader && columnIndexes.some((index) => index === undefined)) {
    errors.push({
      line: lines[0].number,
      message: "Header must name too cheap, cheap, expensive, and too expensive.",
    });
    return { responses: [], errors };
  }

  const responses: VanWestendorpResponse[] = [];
  for (const entry of lines.slice(hasHeader ? 1 : 0)) {
    const fields = splitCsvLine(entry.line, delimiter);
    if (!fields) {
      errors.push({ line: entry.number, message: "Unclosed quoted value." });
      continue;
    }
    if (!hasHeader && fields.length !== 4) {
      errors.push({ line: entry.number, message: "Expected exactly four price columns." });
      continue;
    }
    const rawValues = columnIndexes.map((index) => fields[index ?? -1]?.trim());
    const values = rawValues.map((value) => Number(value));
    if (
      rawValues.some((value) => !value) ||
      !values.every((value) => Number.isFinite(value) && value >= 0)
    ) {
      errors.push({ line: entry.number, message: "Every price must be a non-negative number." });
      continue;
    }
    responses.push({
      tooCheap: values[0],
      cheap: values[1],
      expensive: values[2],
      tooExpensive: values[3],
    });
  }

  return { responses, errors };
}

/** Serializes durable PSM rows in the documented, paste-ready order. */
export function vanWestendorpCsv(responses: readonly VanWestendorpResponse[]) {
  return [
    "too cheap,cheap,expensive,too expensive",
    ...responses.map(
      (response) =>
        `${response.tooCheap},${response.cheap},${response.expensive},${response.tooExpensive}`,
    ),
  ].join("\n");
}

/**
 * A clearly labeled teaching aid. It deterministically scales four PSM prompts
 * from each current segment's P50 account WTP; it is never a survey result.
 */
export function createIllustrativeVanWestendorpStudy(scenario: Scenario): VanWestendorpStudy {
  const multipliers = [0.78, 0.9, 1, 1.12] as const;
  const responses = scenario.model.segments.flatMap((segment) =>
    multipliers.map((multiplier) => {
      const base = segment.wtpBand.p50 * multiplier;
      return {
        tooCheap: Number((base * 0.3).toFixed(6)),
        cheap: Number((base * 0.55).toFixed(6)),
        expensive: Number((base * 1.05).toFixed(6)),
        tooExpensive: Number((base * 1.45).toFixed(6)),
      };
    }),
  );
  return { source: "illustrative", responses };
}

export function scenarioWithVanWestendorpStudy(
  scenario: Scenario,
  study: VanWestendorpStudy | undefined,
): Scenario {
  return {
    ...scenario,
    research: {
      ...scenario.research,
      ...(study ? { vanWestendorp: study } : { vanWestendorp: undefined }),
    },
  };
}
