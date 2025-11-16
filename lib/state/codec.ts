import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

import {
  formatValidationIssues,
  isScenarioVersion,
  MAX_SCENARIO_BYTES,
  MAX_SHARE_DECOMPRESSED_BYTES,
  MAX_SHARE_HASH_CHARS,
  scenarioSchema,
  SCHEMA_VERSION,
  sharePayloadSchema,
  type Scenario,
  type SharePayload,
} from "./schemas";

export type CodecResult<T> = { ok: true; value: T } | { ok: false; error: string };

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

/** Stable JSON makes exports deterministic and round-trippable byte-for-byte. */
export function stableStringify(value: unknown) {
  return JSON.stringify(sortJson(value));
}

function parseJson(value: string): CodecResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, error: "This is not valid scenario JSON." };
  }
}

/** Migration hook. Version 1 has no predecessor, so foreign versions fail closed. */
export function migrateScenario(value: unknown): CodecResult<Scenario> {
  if (!isScenarioVersion(value)) {
    return { ok: false, error: "This file is not a Wind Tunnel scenario." };
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This scenario uses schema version ${value.schemaVersion}, which this version of Wind Tunnel cannot open yet.`,
    };
  }

  const parsed = scenarioSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: `This scenario is invalid: ${formatValidationIssues(parsed.error.issues)}`,
    };
  }
  return { ok: true, value: parsed.data };
}

export function exportScenario(scenario: Scenario) {
  return stableStringify(scenarioSchema.parse(scenario));
}

export function importScenario(json: string): CodecResult<Scenario> {
  if (byteLength(json) > MAX_SCENARIO_BYTES) {
    return {
      ok: false,
      error: "This scenario file is larger than 2 MiB. Use a smaller JSON export before importing.",
    };
  }
  const parsed = parseJson(json);
  return parsed.ok ? migrateScenario(parsed.value) : parsed;
}

export function buildSharePayload(scenario: Scenario): {
  payload: SharePayload;
  excludesResearchArtifacts: boolean;
} {
  const parsedScenario = scenarioSchema.parse(scenario);
  const { research, ...payload } = parsedScenario;
  return {
    payload: sharePayloadSchema.parse(payload),
    excludesResearchArtifacts: Object.keys(research).length > 0,
  };
}

export function scenarioFromSharePayload(payload: SharePayload): Scenario {
  return scenarioSchema.parse({ ...payload, research: {} });
}

export function encodeShareHash(scenario: Scenario): CodecResult<string> {
  const { payload } = buildSharePayload(scenario);
  const json = stableStringify(payload);
  if (byteLength(json) > MAX_SHARE_DECOMPRESSED_BYTES) {
    return {
      ok: false,
      error:
        "This scenario is too large for a compact link. Use complete JSON export/import instead.",
    };
  }

  const encoded = compressToEncodedURIComponent(json);
  if (encoded.length > MAX_SHARE_HASH_CHARS) {
    return {
      ok: false,
      error: "This scenario link would exceed 8 KiB. Use complete JSON export/import instead.",
    };
  }
  return { ok: true, value: `#s=${encoded}` };
}

export function decodeShareHash(hash: string): CodecResult<SharePayload> {
  if (!hash.startsWith("#s=")) {
    return { ok: false, error: "This link does not contain a Wind Tunnel shared scenario." };
  }

  const encoded = hash.slice(3);
  if (!encoded) {
    return { ok: false, error: "This shared scenario link is empty." };
  }
  if (encoded.length > MAX_SHARE_HASH_CHARS) {
    return {
      ok: false,
      error: "This shared scenario link is larger than 8 KiB. Ask for a JSON export instead.",
    };
  }

  let json: string;
  try {
    json = decompressFromEncodedURIComponent(encoded);
  } catch {
    return {
      ok: false,
      error: "This shared scenario link is corrupted. Ask for a JSON export instead.",
    };
  }

  if (typeof json !== "string" || json.length === 0) {
    return {
      ok: false,
      error: "This shared scenario link is corrupted. Ask for a JSON export instead.",
    };
  }
  if (byteLength(json) > MAX_SHARE_DECOMPRESSED_BYTES) {
    return {
      ok: false,
      error:
        "This shared scenario expands beyond the safe 64 KiB limit. Ask for a JSON export instead.",
    };
  }

  const parsedJson = parseJson(json);
  if (!parsedJson.ok) {
    return {
      ok: false,
      error: "This shared scenario link is corrupted. Ask for a JSON export instead.",
    };
  }
  if (!isScenarioVersion(parsedJson.value)) {
    return { ok: false, error: "This shared link is not a Wind Tunnel scenario." };
  }
  if (parsedJson.value.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This shared scenario uses schema version ${parsedJson.value.schemaVersion}, which this version cannot open yet.`,
    };
  }

  const parsedPayload = sharePayloadSchema.safeParse(parsedJson.value);
  if (!parsedPayload.success) {
    return {
      ok: false,
      error: `This shared scenario is invalid: ${formatValidationIssues(parsedPayload.error.issues)}`,
    };
  }
  const completeScenario = scenarioSchema.safeParse({ ...parsedPayload.data, research: {} });
  if (!completeScenario.success) {
    return {
      ok: false,
      error: `This shared scenario is invalid: ${formatValidationIssues(completeScenario.error.issues)}`,
    };
  }
  return { ok: true, value: parsedPayload.data };
}
