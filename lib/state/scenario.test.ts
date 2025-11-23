import { compressToEncodedURIComponent } from "lz-string";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSharePayload,
  decodeShareHash,
  encodeShareHash,
  exportScenario,
  importScenario,
} from "./codec";
import {
  attachScenarioAutosave,
  createScenarioStore,
  SCENARIO_STORAGE_KEY,
} from "./scenario-store";
import {
  MAX_SCENARIO_BYTES,
  MAX_SHARE_DECOMPRESSED_BYTES,
  MAX_SHARE_HASH_CHARS,
  scenarioSchema,
} from "./schemas";
import { scenarioTemplates } from "./templates";

const templateScenario = scenarioTemplates[0].scenario;

function cloneTemplate() {
  const imported = importScenario(exportScenario(templateScenario));
  if (!imported.ok) throw new Error(imported.error);
  return imported.value;
}

describe("P3 scenario schema and codecs", () => {
  // @spec §3.3
  it("T-SCH-01 exports and imports a canonical scenario byte-for-byte", () => {
    const exported = exportScenario(templateScenario);
    const imported = importScenario(exported);

    expect(imported.ok).toBe(true);
    if (imported.ok) expect(exportScenario(imported.value)).toBe(exported);
  });

  // @spec §3.3
  it("T-SCH-02 rejects corrupted, foreign, and over-limit JSON with useful messages", () => {
    expect(importScenario("{not json")).toEqual({
      ok: false,
      error: "This is not valid scenario JSON.",
    });

    const foreign = importScenario('{"schemaVersion":999}');
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error).toContain("cannot open yet");

    const oversized = importScenario("x".repeat(MAX_SCENARIO_BYTES + 1));
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.error).toContain("2 MiB");
  });

  // @spec §3.3
  it("T-URL-01 round-trips a compact hash with unicode segment names", () => {
    const scenario = cloneTemplate();
    scenario.model.segments[0].name = "Équipe 東京 🌬️";
    const share = encodeShareHash(scenario);

    expect(share.ok).toBe(true);
    if (!share.ok) return;

    const decoded = decodeShareHash(share.value);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.model.segments[0].name).toBe("Équipe 東京 🌬️");
      expect("research" in decoded.value).toBe(false);
    }
  });

  // @spec §3.3
  it("T-URL-02 rejects an oversized hash and a compressed decompression bomb before parsing", () => {
    const oversizedHash = decodeShareHash(`#s=${"A".repeat(MAX_SHARE_HASH_CHARS + 1)}`);
    expect(oversizedHash.ok).toBe(false);
    if (!oversizedHash.ok) expect(oversizedHash.error).toContain("8 KiB");

    const bomb = compressToEncodedURIComponent(
      JSON.stringify({ schemaVersion: 1, padding: "x".repeat(MAX_SHARE_DECOMPRESSED_BYTES + 1) }),
    );
    expect(bomb.length).toBeLessThan(MAX_SHARE_HASH_CHARS);

    const decompressionBomb = decodeShareHash(`#s=${bomb}`);
    expect(decompressionBomb.ok).toBe(false);
    if (!decompressionBomb.ok) expect(decompressionBomb.error).toContain("64 KiB");
  });

  // @spec §3.3
  it("rejects compact payloads whose cross-field constraints are invalid", () => {
    const scenario = cloneTemplate();
    const { payload } = buildSharePayload(scenario);
    const malformed = compressToEncodedURIComponent(
      JSON.stringify({ ...payload, activeDesignId: "missing-design" }),
    );

    const decoded = decodeShareHash(`#s=${malformed}`);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toContain("active design");
  });

  // @spec §3.3
  it("validates all three archetype fixtures and retains research only in full JSON", () => {
    expect(scenarioTemplates).toHaveLength(3);
    for (const template of scenarioTemplates) {
      expect(scenarioSchema.safeParse(template.scenario).success).toBe(true);
    }

    const scenario = cloneTemplate();
    scenario.research = {
      vanWestendorp: {
        source: "survey",
        responses: [{ tooCheap: 4, cheap: 6, expensive: 10, tooExpensive: 15 }],
      },
    };
    const fullExport = exportScenario(scenario);
    expect(fullExport).toContain("tooExpensive");

    const compactExport = encodeShareHash(scenario);
    expect(compactExport.ok).toBe(true);
    if (compactExport.ok) expect(compactExport.value).not.toContain("tooExpensive");
  });
});

describe("P3 scenario state", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // @spec §3.3
  it("undoes and redoes a scripted edit sequence", () => {
    const store = createScenarioStore(cloneTemplate());
    store.getState().updateScenario((scenario) => ({ ...scenario, name: "Edited once" }));
    store.getState().setSettings({ seed: 77 });

    expect(store.getState().scenario.name).toBe("Edited once");
    expect(store.getState().scenario.settings.seed).toBe(77);

    store.temporal.getState().undo();
    expect(store.getState().scenario.settings.seed).toBe(240715);
    expect(store.getState().scenario.name).toBe("Edited once");

    store.temporal.getState().undo();
    expect(store.getState().scenario.name).toBe("PLG collaboration tool");

    store.temporal.getState().redo(2);
    expect(store.getState().scenario.name).toBe("Edited once");
    expect(store.getState().scenario.settings.seed).toBe(77);
  });

  // @spec §3.3
  it("autosaves a complete scenario only after the debounce interval", () => {
    vi.useFakeTimers();
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const store = createScenarioStore(cloneTemplate());
    const stopAutosave = attachScenarioAutosave(store, storage, 300);

    store.getState().updateScenario((scenario) => ({ ...scenario, name: "Persisted edit" }));
    expect(storage.getItem(SCENARIO_STORAGE_KEY)).toBeNull();

    vi.advanceTimersByTime(299);
    expect(storage.getItem(SCENARIO_STORAGE_KEY)).toBeNull();

    vi.advanceTimersByTime(1);
    const saved = storage.getItem(SCENARIO_STORAGE_KEY);
    expect(saved).not.toBeNull();
    expect(saved).toContain("Persisted edit");
    stopAutosave();
  });
});
