"use client";

import { useState } from "react";

import { DecisionRecordSurface } from "@/components/decision-record-surface";
import { PricingPageSurface } from "@/components/pricing-page-surface";
import { handleHorizontalTabKey } from "@/components/tab-keyboard";
import {
  buildSharePayload,
  encodeShareHash,
  exportScenario,
  importScenario,
  stableStringify,
} from "@/lib/state/codec";
import { scenarioStore, useScenarioStore } from "@/lib/state/scenario-store";

type ShareView = "record" | "pricing" | "transfer";
const shareViews = ["record", "pricing", "transfer"] as const;

function ScenarioTransferSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const importCurrentJson = useScenarioStore((state) => state.replaceScenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const setMessage = useScenarioStore((state) => state.setMessage);
  const [importText, setImportText] = useState("");
  const [fullExport, setFullExport] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [payloadPreview, setPayloadPreview] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(scenario.name);
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
    <section
      aria-labelledby="scenario-transfer-title"
      className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10"
    >
      <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
        Portable by design
      </p>
      <h1
        id="scenario-transfer-title"
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
          <h2 className="text-base font-semibold text-ink">Scenario name</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            This name headlines the Pricing Decision Record, its downloaded filename, and the
            pricing-page mock.
          </p>
          <label className="mt-4 block text-sm font-medium text-ink">
            Name
            <input
              aria-label="Scenario name"
              className="mt-2 w-full rounded-lg border border-line bg-canvas-raised px-3 py-2 text-sm text-ink"
              maxLength={120}
              onBlur={() => setNameDraft(scenario.name)}
              onChange={(event) => {
                const next = event.target.value;
                setNameDraft(next);
                if (next.trim().length > 0) {
                  updateScenario((current) => ({ ...current, name: next }));
                }
              }}
              value={nameDraft}
            />
          </label>
        </section>

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
          <button
            className="mt-4 min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => setPayloadPreview(stableStringify(buildSharePayload(scenario).payload))}
            type="button"
          >
            Show exactly what the link contains
          </button>
          {payloadPreview ? (
            <label className="mt-4 block text-sm font-medium text-ink">
              Exact compact-link payload
              <textarea
                className="mt-2 min-h-32 w-full rounded-lg border border-line bg-canvas-raised p-3 font-mono text-xs text-ink"
                readOnly
                value={payloadPreview}
              />
            </label>
          ) : null}
        </section>

        <section className="rounded-2xl border border-line bg-canvas p-5">
          <h2 className="text-base font-semibold text-ink">Complete JSON transfer</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            JSON preserves the whole versioned scenario, including survey artifacts. Imports are
            validated before anything replaces your current work.
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

export function ShareSurface() {
  const [view, setView] = useState<ShareView>("record");
  return (
    <section className="flex min-h-0 w-full flex-1 flex-col">
      <nav
        aria-label="Communication workbenches"
        className="no-print border-b border-line px-6 pt-5 sm:px-10"
      >
        <div className="flex gap-2" role="tablist">
          {(
            [
              ["record", "Decision Record"],
              ["pricing", "Pricing page"],
              ["transfer", "Scenario transfer"],
            ] as const
          ).map(([id, label]) => {
            const selected = view === id;
            return (
              <button
                aria-controls="share-view"
                aria-selected={selected}
                className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
                  selected ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink"
                }`}
                id={`share-${id}-tab`}
                key={id}
                onClick={() => setView(id)}
                onKeyDown={(event) =>
                  handleHorizontalTabKey(
                    event,
                    shareViews,
                    view,
                    setView,
                    (candidate) => `share-${candidate}-tab`,
                  )
                }
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {label}
              </button>
            );
          })}
        </div>
      </nav>
      <div
        aria-labelledby={`share-${view}-tab`}
        className="flex min-h-0 flex-1"
        id="share-view"
        role="tabpanel"
      >
        {view === "record" ? (
          <DecisionRecordSurface />
        ) : view === "pricing" ? (
          <PricingPageSurface />
        ) : (
          <ScenarioTransferSurface />
        )}
      </div>
    </section>
  );
}
