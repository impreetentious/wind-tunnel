import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { temporal, type TemporalState } from "zundo";

import { exportScenario, importScenario, type CodecResult } from "./codec";
import { scenarioSchema, type Scenario, type ScenarioSettings } from "./schemas";

export const SCENARIO_STORAGE_KEY = "wind-tunnel.scenario.v1";
export const AUTOSAVE_DELAY_MS = 300;

export interface ScenarioStore {
  scenario: Scenario;
  message: string | null;
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
        message: null,
        updateScenario: (updater) => {
          const parsed = scenarioSchema.safeParse(updater(get().scenario));
          if (!parsed.success) {
            set({
              message: `That change was not saved: ${parsed.error.issues[0]?.message ?? "invalid scenario"}`,
            });
            return;
          }
          set({ scenario: parsed.data, message: null });
        },
        replaceScenario: (scenario, message = null) => {
          const parsed = scenarioSchema.safeParse(scenario);
          if (!parsed.success) {
            set({
              message: `That scenario was not loaded: ${parsed.error.issues[0]?.message ?? "invalid scenario"}`,
            });
            return;
          }
          set({ scenario: parsed.data, message });
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
    const scenarioToSave = state.scenario;
    timer = setTimeout(() => {
      try {
        storage.setItem(SCENARIO_STORAGE_KEY, exportScenario(scenarioToSave));
      } catch {
        store
          .getState()
          .setMessage("Browser storage is full or unavailable. Export JSON to keep this scenario.");
      }
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
    store
      .getState()
      .setMessage(
        `${describeInvalidScenario(restored) ?? "Saved scenario could not be restored."} Export or clear the saved browser data before retrying.`,
      );
    return false;
  }
  if (restored.value === null) return false;
  store.getState().replaceScenario(restored.value);
  store.temporal.getState().clear();
  return true;
}
