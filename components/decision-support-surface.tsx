"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { MODEL_LIMITS, evaluateScenarioReadiness, summarizeReadiness } from "@/lib/state/readiness";
import { diffScenarios, type ScenarioSnapshot } from "@/lib/state/scenario-diff";
import {
  buildStoredZip,
  downloadBlob,
  renderSlideBundle,
  svgElementToPngBlob,
} from "@/lib/state/svg-export";
import { loadScenarioHistory, useScenarioStore } from "@/lib/state/scenario-store";
import { scenarioTemplates } from "@/lib/state/templates";

function VersionHistory() {
  const scenario = useScenarioStore((state) => state.scenario);
  const [history, setHistory] = useState<readonly ScenarioSnapshot[]>([]);
  useEffect(() => {
    const refresh = () => setHistory(loadScenarioHistory(window.localStorage));
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
      {history.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No saved snapshots yet. Make a valid edit and wait for autosave.
        </p>
      ) : (
        <ol className="mt-4 grid gap-3">
          {history.slice(0, 6).map((snapshot) => {
            const changes = diffScenarios(snapshot.scenario, scenario);
            return (
              <li className="rounded-xl border border-line bg-canvas-raised p-3" key={snapshot.id}>
                <div className="flex flex-wrap justify-between gap-2">
                  <strong className="text-sm text-ink">{snapshot.label}</strong>
                  <time className="text-xs text-muted">
                    {new Date(snapshot.createdAt).toLocaleString(scenario.settings.locale)}
                  </time>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {changes.length === 0
                    ? "Matches the current scenario."
                    : `${changes.length} changed field${changes.length === 1 ? "" : "s"}: ${changes
                        .slice(0, 3)
                        .map((change) => change.path)
                        .join(", ")}${changes.length > 3 ? "…" : ""}`}
                </p>
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);
  const title = `${scenario.name} decision snapshot`;
  const savePng = async () => {
    try {
      const svg = svgRef.current;
      if (!svg) return;
      downloadBlob(
        await svgElementToPngBlob(svg, { background: "#ffffff" }),
        "wind-tunnel-decision-snapshot.png",
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PNG export failed.");
    }
  };
  const saveSlides = async () => {
    try {
      const svg = svgRef.current;
      if (!svg) return;
      const png = await svgElementToPngBlob(svg, { background: "#ffffff" });
      const index = renderSlideBundle({
        title,
        caption: "Static decision snapshot exported locally from Wind Tunnel.",
        slides: [
          {
            heading: "Pricing decision snapshot",
            svgMarkup: '<img alt="Pricing decision snapshot" src="slide-01.png" />',
            note: "Review assumptions and model limits before circulation.",
          },
        ],
      });
      const bundle = buildStoredZip([
        {
          name: "slide-01.png",
          data: new Uint8Array(await png.arrayBuffer()),
        },
        { name: "index.html", data: new TextEncoder().encode(index) },
      ]);
      const bundleBytes = Uint8Array.from(bundle);
      downloadBlob(
        new Blob([bundleBytes.buffer], { type: "application/zip" }),
        "wind-tunnel-decision-slides.zip",
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Slide export failed.");
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-canvas p-5">
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Board-ready export
      </p>
      <h3 className="mt-1 text-xl font-semibold text-ink">Take the decision record with you</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        PNG creates a crisp image; the slide bundle is a ZIP containing the PNG and a self-contained
        printable index. Both stay on this device.
      </p>
      <svg
        aria-label="Decision snapshot graphic"
        className="mt-4 w-full rounded-xl border border-line bg-canvas-raised"
        ref={svgRef}
        role="img"
        viewBox="0 0 720 240"
      >
        <rect fill="#f8fafc" height="240" width="720" />
        <text fill="#17201d" fontFamily="system-ui" fontSize="24" fontWeight="700" x="32" y="52">
          {title}
        </text>
        <text fill="#51605a" fontFamily="system-ui" fontSize="16" x="32" y="86">
          Scenario evidence, not a pricing recommendation
        </text>
        <rect fill="#e2f3ee" height="92" rx="12" width="200" x="32" y="116" />
        <text fill="#17201d" fontFamily="system-ui" fontSize="14" x="52" y="148">
          Currency
        </text>
        <text fill="#17201d" fontFamily="system-ui" fontSize="26" fontWeight="700" x="52" y="184">
          {scenario.settings.currency}
        </text>
        <rect fill="#e2f3ee" height="92" rx="12" width="200" x="260" y="116" />
        <text fill="#17201d" fontFamily="system-ui" fontSize="14" x="280" y="148">
          Segments
        </text>
        <text fill="#17201d" fontFamily="system-ui" fontSize="26" fontWeight="700" x="280" y="184">
          {scenario.model.segments.length}
        </text>
        <rect fill="#e2f3ee" height="92" rx="12" width="200" x="488" y="116" />
        <text fill="#17201d" fontFamily="system-ui" fontSize="14" x="508" y="148">
          Active design
        </text>
        <text fill="#17201d" fontFamily="system-ui" fontSize="18" fontWeight="700" x="508" y="184">
          {scenario.designs.find((design) => design.id === scenario.activeDesignId)?.name ?? "—"}
        </text>
      </svg>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong"
          onClick={savePng}
          type="button"
        >
          Export PNG
        </button>
        <button
          className="min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent"
          onClick={saveSlides}
          type="button"
        >
          Export slide bundle
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-amber" role="alert">
          {error}
        </p>
      ) : null}
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
