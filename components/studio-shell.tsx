"use client";

import { useEffect, useState } from "react";

import { DesignSurface } from "@/components/design-surface";
import { ModelSurface } from "@/components/model-surface";
import { AnalyzeSurface } from "@/components/analyze-surface";
import { ShareSurface } from "@/components/share-surface";
import { handleHorizontalTabKey } from "@/components/tab-keyboard";
import { WindTunnelSurface } from "@/components/wind-tunnel-surface";
import { decodeShareHash, scenarioFromSharePayload } from "@/lib/state/codec";
import {
  attachScenarioAutosave,
  restoreScenarioFromStorage,
  scenarioStore,
  useScenarioStore,
} from "@/lib/state/scenario-store";
import type { ScenarioSettings } from "@/lib/state/schemas";

const tabs = ["Model", "Design", "Simulate", "Analyze", "Share"] as const;

type EffectiveTheme = "light" | "dark";
type Tab = (typeof tabs)[number];

function WindMark() {
  return (
    <svg aria-hidden="true" className="h-8 w-8 text-accent" fill="none" viewBox="0 0 32 32">
      <path
        d="M4 11.5h13.5c3.3 0 5.5-1.8 5.5-4.1C23 5.1 21.4 4 19.3 4c-1.8 0-3.2.8-4 2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <path
        d="M4 16h19.2c3.1 0 4.8 1.4 4.8 3.6 0 2.2-1.9 3.9-4.4 3.9-1.6 0-3-.6-3.8-1.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <path
        d="M4 20.5h9.2c2.8 0 4.5 1.4 4.5 3.8 0 2.1-1.7 3.7-4.1 3.7-1.3 0-2.5-.5-3.2-1.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}

function ThemeToggle({
  theme,
  effectiveTheme,
  onChange,
}: {
  theme: ScenarioSettings["theme"];
  effectiveTheme: EffectiveTheme;
  onChange: (theme: ScenarioSettings["theme"]) => void;
}) {
  const nextTheme: ScenarioSettings["theme"] =
    theme === "system"
      ? effectiveTheme === "light"
        ? "dark"
        : "light"
      : theme === "dark"
        ? "light"
        : "system";

  return (
    <button
      aria-label={`Switch to ${nextTheme} theme`}
      aria-pressed={effectiveTheme === "dark"}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-canvas-raised px-3 text-sm font-medium text-ink shadow-sm hover:border-accent"
      onClick={() => onChange(nextTheme)}
      type="button"
    >
      <span aria-hidden="true" className="text-base leading-none">
        {effectiveTheme === "light" ? "☼" : "◐"}
      </span>
      <span className="capitalize">{theme}</span>
    </button>
  );
}

function readSystemTheme(): EffectiveTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function StudioShell({ version }: { version: string }) {
  const [activeTab, setActiveTab] = useState<Tab>("Model");
  const settings = useScenarioStore((state) => state.scenario.settings);
  const message = useScenarioStore((state) => state.message);
  const setSettings = useScenarioStore((state) => state.setSettings);
  const setMessage = useScenarioStore((state) => state.setMessage);
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>("light");
  const effectiveTheme = settings.theme === "system" ? systemTheme : settings.theme;

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => setSystemTheme(readSystemTheme());
    syncSystemTheme();
    media?.addEventListener?.("change", syncSystemTheme);
    return () => media?.removeEventListener?.("change", syncSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const decoded = decodeShareHash(hash);
      if (decoded.ok) {
        scenarioStore
          .getState()
          .replaceScenario(
            scenarioFromSharePayload(decoded.value),
            "Shared scenario loaded. Compact links do not include research records.",
          );
        scenarioStore.temporal.getState().clear();
      } else {
        setMessage(decoded.error);
      }
    } else {
      restoreScenarioFromStorage(scenarioStore, window.localStorage);
    }
    return attachScenarioAutosave(scenarioStore, window.localStorage);
  }, [setMessage]);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
      <a className="skip-link no-print" href="#workbench-panel">
        Skip to active workbench
      </a>
      <header className="no-print flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <WindMark />
          <div>
            <p className="text-lg font-semibold tracking-[-0.03em] text-ink">Wind Tunnel</p>
            <p className="text-xs text-muted">Pricing &amp; packaging studio</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-soft px-3 py-2 text-xs font-semibold tracking-[0.08em] text-amber uppercase">
            Seed · {settings.seed}
          </span>
          <ThemeToggle
            effectiveTheme={effectiveTheme}
            onChange={(theme) => setSettings({ theme })}
            theme={settings.theme}
          />
        </div>
      </header>

      {message ? (
        <div
          className="no-print mt-4 flex items-start justify-between gap-4 rounded-xl border border-amber bg-amber-soft px-4 py-3 text-sm text-ink"
          role="alert"
        >
          <p>{message}</p>
          <button
            aria-label="Dismiss message"
            className="text-sm font-semibold text-amber hover:text-ink"
            onClick={() => setMessage(null)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="mt-5 flex flex-1 flex-col overflow-hidden rounded-3xl border border-line bg-canvas-raised shadow-[var(--shadow)]">
        <nav
          aria-label="Studio sections"
          className="no-print overflow-x-auto border-b border-line px-2 pt-2"
        >
          <div aria-label="Wind Tunnel sections" className="flex min-w-max gap-1" role="tablist">
            {tabs.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  aria-controls="workbench-panel"
                  aria-selected={isActive}
                  className={`rounded-t-xl px-4 py-3 text-sm font-semibold ${
                    isActive
                      ? "bg-accent-soft text-accent-strong"
                      : "text-muted hover:bg-canvas hover:text-ink"
                  }`}
                  id={`${tab.toLowerCase()}-tab`}
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(event) =>
                    handleHorizontalTabKey(
                      event,
                      tabs,
                      activeTab,
                      setActiveTab,
                      (candidate) => `${candidate.toLowerCase()}-tab`,
                    )
                  }
                  role="tab"
                  tabIndex={isActive ? 0 : -1}
                  type="button"
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </nav>
        <div
          aria-labelledby={`${activeTab.toLowerCase()}-tab`}
          className="flex flex-1"
          id="workbench-panel"
          role="tabpanel"
          tabIndex={0}
        >
          {activeTab === "Model" ? (
            <ModelSurface />
          ) : activeTab === "Design" ? (
            <DesignSurface />
          ) : activeTab === "Simulate" ? (
            <WindTunnelSurface />
          ) : activeTab === "Analyze" ? (
            <AnalyzeSurface />
          ) : activeTab === "Share" ? (
            <ShareSurface />
          ) : null}
        </div>
      </section>

      <footer className="no-print flex flex-wrap items-center justify-between gap-2 px-2 pt-4 text-xs text-muted">
        <p>Private by design · No accounts · No telemetry</p>
        <p>Wind Tunnel v{version}</p>
      </footer>
    </main>
  );
}
