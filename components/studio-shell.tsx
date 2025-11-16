"use client";

import { useEffect, useState } from "react";

import {
  decodeShareHash,
  encodeShareHash,
  exportScenario,
  importScenario,
  scenarioFromSharePayload,
} from "@/lib/state/codec";
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

function TabPreview({ tab }: { tab: Exclude<Tab, "Share"> }) {
  const messages: Record<
    Exclude<Tab, "Share">,
    { eyebrow: string; title: string; body: string }
  > = {
    Model: {
      eyebrow: "Start with what you believe",
      title: "Describe the buyers before you price them.",
      body: "Segments, willingness to pay, feature value, and evidence provenance will live here.",
    },
    Design: {
      eyebrow: "Build a menu",
      title: "Turn value into tiers and fences.",
      body: "The packaging canvas will let buyers self-select across tiers, free plans, and add-ons.",
    },
    Simulate: {
      eyebrow: "Run the wind tunnel",
      title: "Watch assumptions become outcomes.",
      body: "The closed-form engine, conversion, revenue, and value waterfall land in the next phase.",
    },
    Analyze: {
      eyebrow: "Validate what matters",
      title: "Find the assumptions worth testing first.",
      body: "Uncertainty, price sensitivity, and the decision record will make the trade-offs inspectable.",
    },
  };

  const message = messages[tab];

  return (
    <section
      aria-labelledby="workbench-title"
      className="grid min-h-[28rem] place-items-center px-6 py-14 text-center sm:px-12"
    >
      <div className="max-w-xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          {message.eyebrow}
        </p>
        <h1
          id="workbench-title"
          className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl"
        >
          {message.title}
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-base leading-7 text-muted">{message.body}</p>
        <div className="mt-10 rounded-2xl border border-dashed border-line bg-canvas px-5 py-4 text-left shadow-sm">
          <p className="text-sm font-medium text-ink">P3 scenario foundation</p>
          <p className="mt-1 text-sm leading-6 text-muted">
            Versioned scenario data, local autosave, undo, complete JSON transfer, and compact share
            links are ready for the model and design surfaces.
          </p>
        </div>
      </div>
    </section>
  );
}

function SharePanel() {
  const scenario = useScenarioStore((state) => state.scenario);
  const importCurrentJson = useScenarioStore((state) => state.replaceScenario);
  const setMessage = useScenarioStore((state) => state.setMessage);
  const [importText, setImportText] = useState("");
  const [fullExport, setFullExport] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const researchCount = Object.keys(scenario.research).length;

  const createShareLink = () => {
    const result = encodeShareHash(scenario);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    const base = window.location.href.split("#")[0];
    setShareLink(`${base}${result.value}`);
    setMessage(
      researchCount > 0
        ? "Compact link created. It excludes survey and research records; use JSON export for the complete scenario."
        : "Compact link created.",
    );
  };

  const importJson = () => {
    const result = importScenario(importText);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    importCurrentJson(result.value, "Scenario imported. It will now autosave in this browser.");
    scenarioStore.temporal.getState().clear();
    setImportText("");
    setFullExport(null);
    setShareLink(null);
  };

  return (
    <section aria-labelledby="share-title" className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10">
      <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
        Portable by design
      </p>
      <h1
        id="share-title"
        className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
      >
        Scenario storage and sharing
      </h1>
      <p className="mt-4 max-w-2xl leading-7 text-muted">
        Your complete scenario autosaves in this browser. Use JSON when you need a full handoff; use
        a compact link when model and packaging settings are enough.
      </p>

      <div className="mt-8 grid gap-5">
        <section className="rounded-2xl border border-line bg-canvas p-5">
          <h2 className="text-base font-semibold text-ink">Compact share link</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Includes model, designs, competitors, seed, currency, and theme. It never includes
            respondent-level research data
            {researchCount > 0
              ? ` (${researchCount} research artifact slot${researchCount === 1 ? "" : "s"} is excluded).`
              : "."}
          </p>
          <button
            className="mt-4 min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong"
            onClick={createShareLink}
            type="button"
          >
            Create compact link
          </button>
          {shareLink ? (
            <label className="mt-4 block text-sm font-medium text-ink">
              Compact link
              <input
                className="mt-2 w-full rounded-lg border border-line bg-canvas-raised px-3 py-2 text-sm text-ink"
                readOnly
                value={shareLink}
              />
            </label>
          ) : null}
        </section>

        <section className="rounded-2xl border border-line bg-canvas p-5">
          <h2 className="text-base font-semibold text-ink">Complete JSON transfer</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            JSON preserves the whole versioned scenario, including future survey artifacts. Imports
            are validated before anything replaces your current work.
          </p>
          <button
            className="mt-4 min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => setFullExport(exportScenario(scenario))}
            type="button"
          >
            Show complete JSON export
          </button>
          {fullExport ? (
            <label className="mt-4 block text-sm font-medium text-ink">
              Complete scenario JSON
              <textarea
                className="mt-2 min-h-32 w-full rounded-lg border border-line bg-canvas-raised p-3 font-mono text-xs text-ink"
                readOnly
                value={fullExport}
              />
            </label>
          ) : null}

          <label className="mt-5 block text-sm font-medium text-ink">
            Import complete scenario JSON
            <textarea
              className="mt-2 min-h-32 w-full rounded-lg border border-line bg-canvas-raised p-3 font-mono text-xs text-ink"
              onChange={(event) => setImportText(event.target.value)}
              placeholder='{ "schemaVersion": 1, … }'
              value={importText}
            />
          </label>
          <button
            className="mt-3 min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={importText.trim().length === 0}
            onClick={importJson}
            type="button"
          >
            Import JSON
          </button>
        </section>
      </div>
    </section>
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
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
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
          className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-amber bg-amber-soft px-4 py-3 text-sm text-ink"
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
          className="overflow-x-auto border-b border-line px-2 pt-2"
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
                  role="tab"
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
          {activeTab === "Share" ? <SharePanel /> : <TabPreview tab={activeTab} />}
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 px-2 pt-4 text-xs text-muted">
        <p>Private by design · No accounts · No telemetry</p>
        <p>Wind Tunnel v{version}</p>
      </footer>
    </main>
  );
}
