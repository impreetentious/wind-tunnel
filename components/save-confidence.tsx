"use client";

import { useEffect, useState } from "react";

import { AUTOSAVE_DELAY_MS, scenarioStore, useScenarioStore } from "@/lib/state/scenario-store";

export function SaveConfidence() {
  const scenario = useScenarioStore((state) => state.scenario);
  const [saved, setSaved] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const refresh = () => {
    const state = scenarioStore.temporal.getState();
    setCanUndo(state.pastStates.length > 0);
    setCanRedo(state.futureStates.length > 0);
  };
  useEffect(() => {
    const start = window.setTimeout(() => setSaved(false), 0);
    const timer = window.setTimeout(() => {
      setSaved(true);
      refresh();
    }, AUTOSAVE_DELAY_MS + 40);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(timer);
    };
  }, [scenario]);
  return (
    <div aria-label="Save and undo status" className="flex flex-wrap items-center gap-2">
      <span
        aria-live="polite"
        className="rounded-full border border-line bg-canvas-raised px-3 py-2 text-xs font-medium text-muted"
      >
        {saved ? "Saved in this browser" : "Saving locally…"}
      </span>
      <button
        className="min-h-9 rounded-lg border border-line bg-canvas-raised px-3 text-xs font-semibold text-ink hover:border-accent disabled:opacity-50"
        disabled={!canUndo}
        onClick={() => {
          scenarioStore.temporal.getState().undo();
          refresh();
        }}
        type="button"
      >
        Undo
      </button>
      <button
        className="min-h-9 rounded-lg border border-line bg-canvas-raised px-3 text-xs font-semibold text-ink hover:border-accent disabled:opacity-50"
        disabled={!canRedo}
        onClick={() => {
          scenarioStore.temporal.getState().redo();
          refresh();
        }}
        type="button"
      >
        Redo
      </button>
    </div>
  );
}
