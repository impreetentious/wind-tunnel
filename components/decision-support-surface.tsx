"use client";

import { useEffect, useMemo, useState } from "react";

import { exportScenario } from "@/lib/state/codec";
import { buildPricingDecisionRecord } from "@/lib/state/decision-record";
import { MODEL_LIMITS, evaluateScenarioReadiness, summarizeReadiness } from "@/lib/state/readiness";
import { diffScenarios, type ScenarioSnapshot } from "@/lib/state/scenario-diff";
import {
  buildStoredZip,
  downloadBlob,
  renderSlideBundle,
  svgElementToPngBlob,
  decisionSnapshot,
} from "@/lib/state/svg-export";
import { loadScenarioHistory, useScenarioStore } from "@/lib/state/scenario-store";
import { scenarioTemplates } from "@/lib/state/templates";

function VersionHistory() {
  const scenario = useScenarioStore((state) => state.scenario);
  const [history, setHistory] = useState<readonly ScenarioSnapshot[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const restore = useScenarioStore((state) => state.restoreSnapshot);
  const recovery = useScenarioStore((state) => state.recoveryScenario);
  useEffect(() => {
    const refresh = () => {
      try {
        setHistory(loadScenarioHistory(window.localStorage));
        setHistoryError(null);
      } catch (error) {
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Browser history is unavailable. Current data can still be exported.",
        );
      }
    };
    refresh();
    window.addEventListener("wind-tunnel:history", refresh);
    return () => window.removeEventListener("wind-tunnel:history", refresh);
  }, []);
  return (
    <section className="rounded-2xl border border-line bg-canvas p-5">
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Version history
      </p>
      <h3 className="mt-1 text-xl font-semibold text-ink">What changed in this browser</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        Autosave keeps the last 20 changed scenario snapshots locally. Nothing is uploaded. Select a
        snapshot to read the structural difference from the current scenario.
      </p>
      {historyError && <p role="alert">{historyError}</p>}
      {recovery && (
        <p role="status">
          The scenario from before restore remains available in memory. Undo restores it; export is
          available if browser storage fails.
          <button
            type="button"
            onClick={() =>
              downloadBlob(
                new Blob([exportScenario(recovery)], { type: "application/json" }),
                "wind-tunnel-scenario.json",
              )
            }
          >
            Export pre-restore scenario
          </button>
        </p>
      )}
      {history.length > 6 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show six recent snapshots" : "Show all saved snapshots"}
        </button>
      )}
      {history.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No saved snapshots yet. Make a valid edit and wait for autosave.
        </p>
      ) : (
        <ol className="mt-4 grid gap-3">
          {history.slice(0, expanded ? history.length : 6).map((snapshot) => {
            const changes = diffScenarios(snapshot.scenario, scenario);
            return (
              <li className="rounded-xl border border-line bg-canvas-raised p-3" key={snapshot.id}>
                <details>
                  <summary>
                    <strong>{snapshot.label}</strong> ·{" "}
                    <time>
                      {new Date(snapshot.createdAt).toLocaleString(scenario.settings.locale)}
                    </time>{" "}
                    · {changes.length} changed fields
                  </summary>
                  {changes.length === 0 ? (
                    <p>Matches the current scenario.</p>
                  ) : (
                    <dl>
                      {changes.map((change) => (
                        <div key={change.path}>
                          <dt>{change.path}</dt>
                          <dd>
                            <code>{change.before ?? "absent"}</code> →{" "}
                            <code>{change.after ?? "absent"}</code>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <button type="button" onClick={() => restore(snapshot)}>
                    Restore snapshot
                  </button>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function ReadinessCard() {
  const scenario = useScenarioStore((state) => state.scenario);
  const checks = evaluateScenarioReadiness(scenario);
  const summary = summarizeReadiness(checks);
  return (
    <section className="rounded-2xl border border-line bg-canvas p-5" data-tour="share-readiness">
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Decision readiness
      </p>
      <h3 className="mt-1 text-xl font-semibold text-ink">
        {summary.overall === "ok"
          ? "Ready to defend"
          : summary.overall === "warning"
            ? "Usable with caveats"
            : "Not ready to defend"}
      </h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        {summary.counts.blocker} blockers · {summary.counts.warning} warnings · {summary.counts.ok}{" "}
        checks passed. This is a deterministic evidence checklist, not an approval.
      </p>
      {checks.length ? (
        <ul className="mt-4 grid gap-2">
          {checks.map((check) => (
            <li className="rounded-lg border border-line bg-canvas-raised p-3" key={check.id}>
              <p className="text-sm font-semibold text-ink">
                {check.level.toUpperCase()} · {check.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">{check.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-lg bg-accent-soft p-3 text-sm text-ink">
          No derived blockers or warnings are currently firing. Keep the model-limit disclosures in
          the record.
        </p>
      )}
    </section>
  );
}

function ExportActions() {
  const scenario = useScenarioStore((state) => state.scenario);
  const challenger = useScenarioStore((state) => state.selectedComparisonId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(
    () =>
      decisionSnapshot(
        buildPricingDecisionRecord(scenario, "Current scenario", undefined, challenger),
        evaluateScenarioReadiness(scenario),
      ),
    [scenario, challenger],
  );
  const capture = () => {
    const frozen = structuredClone(scenario);
    const record = buildPricingDecisionRecord(
      frozen,
      new Date().toISOString(),
      undefined,
      challenger,
    );
    const graphic = decisionSnapshot(record, evaluateScenarioReadiness(frozen));
    return {
      record,
      graphic,
      svg: new DOMParser().parseFromString(graphic.markup, "image/svg+xml")
        .documentElement as unknown as SVGSVGElement,
    };
  };
  const savePng = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const frozen = capture();
      if (!frozen.graphic.canPng)
        throw new Error(
          "Complete evidence exceeds PNG size limits. Export the complete slide bundle or existing JSON instead.",
        );
      const png = await svgElementToPngBlob(frozen.svg, { background: "#ffffff" });
      downloadBlob(png, "wind-tunnel-decision-snapshot.png");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PNG export failed.");
    } finally {
      setBusy(false);
    }
  };
  const saveSlides = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const frozen = capture();
      const entries = [];
      if (frozen.graphic.canPng) {
        const png = await svgElementToPngBlob(frozen.svg, { background: "#ffffff" });
        entries.push({ name: "slide-01.png", data: new Uint8Array(await png.arrayBuffer()) });
      }
      const index = renderSlideBundle({
        title: `${frozen.record.scenario.name} decision snapshot`,
        caption: "Modeled decision evidence captured locally.",
        slides: frozen.graphic.canPng
          ? [
              {
                heading: "Pricing decision snapshot",
                svgMarkup: '<img alt="Pricing decision snapshot" src="slide-01.png" />',
              },
            ]
          : [],
        evidence: frozen.record.markdown,
        structuredEvidence: frozen.record,
      });
      entries.push({ name: "index.html", data: new TextEncoder().encode(index) });
      const bundle = Uint8Array.from(buildStoredZip(entries));
      downloadBlob(
        new Blob([bundle.buffer], { type: "application/zip" }),
        "wind-tunnel-decision-slides.zip",
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Slide export failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-canvas p-5">
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Board-ready export
      </p>
      <h3 className="mt-1 text-xl font-semibold text-ink">Take the decision record with you</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        PNG and the complete printable slide bundle capture the same decision evidence. Both stay on
        this device.
      </p>
      {preview.canPng ? (
        <div className="mt-4 w-full" dangerouslySetInnerHTML={{ __html: preview.markup }} />
      ) : (
        <p>
          Complete evidence is available in the printable bundle; the PNG would exceed its size
          limit.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={savePng}
          className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent"
        >
          Export PNG
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={saveSlides}
          className="min-h-10 rounded-lg border border-line px-4 text-sm font-semibold"
        >
          Export slide bundle
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function OutcomeLedExample() {
  const replaceScenario = useScenarioStore((state) => state.replaceScenario);
  const example = scenarioTemplates.find((template) => template.id === "sales-led-b2b");
  if (!example) return null;
  return (
    <section className="rounded-2xl border border-line bg-canvas p-5">
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">Worked path</p>
      <h3 className="mt-1 text-xl font-semibold text-ink">
        Start with an outcome, then trace the assumptions
      </h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        Load the sales-led B2B example, open the Worked example control in the header, and follow
        the path from buyer segments → fences → value waterfall → sensitivity → Decision Record. It
        is a local fixture; replacing the current scenario is explicit.
      </p>
      <button
        className="mt-4 min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent"
        onClick={() =>
          replaceScenario(
            example.scenario,
            "Worked sales-led B2B example loaded. Open Worked example in the header to follow the outcome-led path.",
          )
        }
        type="button"
      >
        Load worked example
      </button>
    </section>
  );
}

export function DecisionSupportSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const readiness = useMemo(
    () => summarizeReadiness(evaluateScenarioReadiness(scenario)),
    [scenario],
  );
  return (
    <section
      className="mx-auto grid w-full max-w-5xl gap-5 px-6 py-8 sm:px-10"
      aria-label="Decision support"
    >
      <header className="rounded-2xl border border-line bg-accent-soft p-5">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Decision support
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">
          From a changed assumption to a defensible consequence
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          The record now pairs a locally persisted edit history, readiness status, and exportable
          visual with clear limits. Current readiness: {readiness.overall}.
        </p>
      </header>
      <OutcomeLedExample />
      <div className="grid gap-5 lg:grid-cols-2">
        <ReadinessCard />
        <VersionHistory />
      </div>
      <ExportActions />
      <section className="rounded-2xl border border-line bg-canvas p-5">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Model limits
        </p>
        <h3 className="mt-1 text-xl font-semibold text-ink">Read before sharing a conclusion</h3>
        <ul className="mt-4 grid gap-3">
          {MODEL_LIMITS.map((limit) => (
            <li className="rounded-xl border border-line bg-canvas-raised p-3" key={limit.id}>
              <p className="text-sm font-semibold text-ink">{limit.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted">{limit.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
