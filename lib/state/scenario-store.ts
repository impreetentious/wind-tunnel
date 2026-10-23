import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { temporal, type TemporalState } from "zundo";

import { exportScenario, importScenario, type CodecResult } from "./codec";
import { scenarioSchema, type Scenario, type ScenarioSettings } from "./schemas";
import { appendScenarioSnapshot, type ScenarioSnapshot } from "./scenario-diff";

export const SCENARIO_STORAGE_KEY = "wind-tunnel.scenario.v1";
export const SCENARIO_HISTORY_STORAGE_KEY = "wind-tunnel.scenario-history.v1";
export const AUTOSAVE_DELAY_MS = 300;

export type PersistenceStatus = "saved" | "saving" | "error";

export interface ScenarioStore {
  scenario: Scenario;
  selectedComparisonId: string | null;
  recoveryScenario: Scenario | null;
  selectComparison: (id: string | null) => void;
  restoreSnapshot: (snapshot: ScenarioSnapshot) => boolean;
  message: string | null;
  persistenceStatus: PersistenceStatus;
  updateScenario: (updater: (current: Scenario) => Scenario) => void;
  replaceScenario: (scenario: Scenario, message?: string | null) => void;
  setSettings: (settings: Partial<ScenarioSettings>) => void;
  setMessage: (message: string | null) => void;
}

type ScenarioHistory = Pick<ScenarioStore, "scenario">;

export interface ScenarioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readScenarioHistory(storage: ScenarioStorage): readonly ScenarioSnapshot[] {
  try {
    const source = storage.getItem(SCENARIO_HISTORY_STORAGE_KEY);
    if (!source) return [];
    const parsed: unknown = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((entry): ScenarioSnapshot[] => {
        if (!entry || typeof entry !== "object") return [];
        const candidate = entry as Partial<ScenarioSnapshot>;
        if (
          typeof candidate.id !== "string" ||
          typeof candidate.label !== "string" ||
          typeof candidate.createdAt !== "string" ||
          !Number.isFinite(Date.parse(candidate.createdAt))
        )
          return [];
        const scenario = importScenario(JSON.stringify(candidate.scenario));
        return scenario.ok
          ? [
              {
                id: candidate.id,
                label: candidate.label,
                createdAt: candidate.createdAt,
                scenario: scenario.value,
              },
            ]
          : [];
      })
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function loadScenarioHistory(storage: ScenarioStorage): readonly ScenarioSnapshot[] {
  const raw = storage.getItem(SCENARIO_HISTORY_STORAGE_KEY);
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          typeof entry.id !== "string" ||
          typeof entry.label !== "string" ||
          typeof entry.createdAt !== "string" ||
          !Number.isFinite(Date.parse(entry.createdAt)) ||
          !importScenario(JSON.stringify(entry.scenario)).ok,
      )
    )
      throw new Error("Saved history contains unsupported/corrupt data and has been preserved.");
  }
  return readScenarioHistory(storage);
}

function persistScenarioSnapshot(storage: ScenarioStorage, scenario: Scenario): void {
  const raw = storage.getItem(SCENARIO_HISTORY_STORAGE_KEY);
  if (raw) {
    const existing: unknown = JSON.parse(raw);
    if (
      !Array.isArray(existing) ||
      existing.some(
        (entry) =>
          !entry ||
          typeof entry.id !== "string" ||
          typeof entry.label !== "string" ||
          typeof entry.createdAt !== "string" ||
          !Number.isFinite(Date.parse(entry.createdAt)) ||
          !importScenario(JSON.stringify(entry.scenario)).ok,
      )
    )
      throw new Error("Saved history contains unsupported/corrupt data and has been preserved.");
  }
  const history = appendScenarioSnapshot(readScenarioHistory(storage), {
    id: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: scenario.name,
    createdAt: new Date().toISOString(),
    scenario,
  });
  storage.setItem(SCENARIO_HISTORY_STORAGE_KEY, JSON.stringify(history));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wind-tunnel:history"));
}

export type ScenarioStoreApi = StoreApi<ScenarioStore> & {
  temporal: StoreApi<TemporalState<ScenarioHistory>>;
};

export function createBlankScenario(): Scenario {
  return scenarioSchema.parse({
    schemaVersion: 1,
    id: "blank-scenario",
    name: "Untitled scenario",
    status: "draft",
    model: { features: [], segments: [] },
    designs: [{ id: "blank-design", name: "Initial design", tiers: [], addOns: [] }],
    activeDesignId: "blank-design",
    competitors: [],
    research: {},
    settings: { seed: 240715, currency: "USD", theme: "system", locale: "en-US" },
  });
}

function describeInvalidScenario(result: CodecResult<Scenario>) {
  return result.ok ? null : result.error;
}

export function createScenarioStore(
  initialScenario: Scenario = createBlankScenario(),
): ScenarioStoreApi {
  const store = createStore<ScenarioStore>()(
    temporal<ScenarioStore, [], [], ScenarioHistory>(
      (set, get) => ({
        scenario: scenarioSchema.parse(initialScenario),
        selectedComparisonId: null,
        recoveryScenario: null,
        selectComparison: (id) => set({ selectedComparisonId: id }),
        restoreSnapshot: (snapshot) => {
          const candidate = importScenario(JSON.stringify(snapshot.scenario));
          if (!candidate.ok) {
            set({ message: `Snapshot was not restored: ${candidate.error}` });
            return false;
          }
          const recovery = scenarioSchema.parse(get().scenario);
          set({
            scenario: candidate.value,
            recoveryScenario: recovery,
            message:
              "Snapshot restored. Undo recovers the previous scenario; export remains available if storage fails.",
          });
          return true;
        },
        message: null,
        persistenceStatus: "saved",
        updateScenario: (updater) => {
          const parsed = scenarioSchema.safeParse(updater(get().scenario));
          if (!parsed.success) {
            set({
              message: `That change was not saved: ${parsed.error.issues[0]?.message ?? "invalid scenario"}`,
            });
            return;
          }
          set({ scenario: parsed.data, recoveryScenario: null, message: null });
        },
        replaceScenario: (scenario, message = null) => {
          const parsed = scenarioSchema.safeParse(scenario);
          if (!parsed.success) {
            set({
              message: `That scenario was not loaded: ${parsed.error.issues[0]?.message ?? "invalid scenario"}`,
            });
            return;
          }
          set({ scenario: parsed.data, recoveryScenario: null, message });
        },
        setSettings: (settings) => {
          get().updateScenario((scenario) => ({
            ...scenario,
            settings: { ...scenario.settings, ...settings },
          }));
        },
        setMessage: (message) => set({ message }),
      }),
      {
        limit: 100,
        partialize: (state) => ({ scenario: state.scenario }),
        equality: (past, current) => past.scenario === current.scenario,
      },
    ),
  );
  return store as ScenarioStoreApi;
}

export const scenarioStore = createScenarioStore();

export function useScenarioStore<T>(selector: (state: ScenarioStore) => T) {
  return useStore(scenarioStore, selector);
}

export function loadPersistedScenario(storage: ScenarioStorage): CodecResult<Scenario | null> {
  let persisted: string | null;
  try {
    persisted = storage.getItem(SCENARIO_STORAGE_KEY);
  } catch {
    return {
      ok: false,
      error: "Browser storage is unavailable, so this scenario cannot be restored.",
    };
  }
  if (persisted === null) return { ok: true, value: null };
  return importScenario(persisted);
}

/**
 * Browser-only persistence hook. It deliberately serializes the canonical
 * full scenario, never the compact share payload, and waits for edits to settle.
 */
export function attachScenarioAutosave(
  store: ScenarioStoreApi,
  storage: ScenarioStorage,
  delayMs = AUTOSAVE_DELAY_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.scenario === previous.scenario) return;
    if (timer) clearTimeout(timer);
    store.setState({ persistenceStatus: "saving" });
    const scenarioToSave = state.scenario;
    timer = setTimeout(() => {
      try {
        storage.setItem(SCENARIO_STORAGE_KEY, exportScenario(scenarioToSave));
      } catch {
        store.setState({ persistenceStatus: "error" });
        store
          .getState()
          .setMessage(
            "Browser storage is full or unavailable. Download JSON to keep this scenario.",
          );
        return;
      }
      try {
        persistScenarioSnapshot(storage, scenarioToSave);
      } catch {
        store.setState({ persistenceStatus: "saved" });
        store
          .getState()
          .setMessage("Scenario saved, but browser storage could not retain its local history.");
        return;
      }
      store.setState({ persistenceStatus: "saved" });
    }, delayMs);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

export function restoreScenarioFromStorage(store: ScenarioStoreApi, storage: ScenarioStorage) {
  const restored = loadPersistedScenario(storage);
  if (!restored.ok) {
    store.setState({ persistenceStatus: "error" });
    store
      .getState()
      .setMessage(
        `${describeInvalidScenario(restored) ?? "Saved scenario could not be restored."} The saved browser data was left unchanged; download it from Scenario transfer before editing, or clear the site's storage.`,
      );
    return false;
  }
  if (restored.value === null) return false;
  store.getState().replaceScenario(restored.value);
  store.temporal.getState().clear();
  return true;
}
