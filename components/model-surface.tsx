"use client";

import { useMemo, useState, type KeyboardEvent } from "react";

import { GlossaryPopover } from "@/components/glossary-popover";
import type { EconomicsReadout } from "@/lib/engine/types";
import {
  editAllocationShare,
  editDirectFeatureValue,
  editP50CenteredBand,
  type BandField,
  type QuantileBand,
} from "@/lib/state/model-editing";
import { scenarioStore, useScenarioStore } from "@/lib/state/scenario-store";
import { simulateScenarioDesign } from "@/lib/state/scenario-economics";
import { scenarioTemplates } from "@/lib/state/templates";
import type { Scenario } from "@/lib/state/schemas";

type Segment = Scenario["model"]["segments"][number];
type Provenance = Segment["provenance"]["prospectCount"];
type MatrixMode = "allocation" | "direct";

const emptyProvenance = { kind: "guess", confidence: "low" } as const;

function formatCurrency(value: number, currency: string, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function modelReadout(scenario: Scenario): EconomicsReadout | null {
  const design = scenario.designs.find((candidate) => candidate.id === scenario.activeDesignId);
  if (!design || design.tiers.length === 0 || scenario.model.segments.length === 0) return null;

  return simulateScenarioDesign(scenario, design);
}

function ModelKpiRail({ scenario }: { scenario: Scenario }) {
  const readout = useMemo(() => modelReadout(scenario), [scenario]);

  if (!readout) {
    return (
      <aside
        className="rounded-2xl border border-dashed border-line bg-canvas px-5 py-4"
        aria-label="Model KPI preview"
      >
        <p className="text-sm font-semibold text-ink">Model KPI preview</p>
        <p className="mt-1 text-sm leading-6 text-muted">
          Add segments and at least one tier, or choose a template, to see the live economics.
        </p>
      </aside>
    );
  }

  const metrics = [
    ["MRR", formatCurrency(readout.mrr, scenario.settings.currency)],
    ["Paid conversion", formatPercent(readout.paidConversion)],
    ["ARPA", formatCurrency(readout.arpa, scenario.settings.currency)],
    ["Capture rate", formatPercent(readout.captureRate)],
    ["Potential value", formatCurrency(readout.potential, scenario.settings.currency)],
  ];

  return (
    <aside
      aria-label="Live model KPI preview"
      className="rounded-2xl border border-line bg-accent-soft p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Live model preview</p>
        <p className="text-xs text-muted">
          Active design ·{" "}
          {scenario.designs.find((design) => design.id === scenario.activeDesignId)?.name}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-5">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-muted">{label}</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-5 text-muted">
        These are direct outputs from the current buyer assumptions and active offer menu. Charts
        land with the wind-tunnel reveal.
      </p>
    </aside>
  );
}

function P50BandEditor({
  accessibleName,
  glossaryTerm,
  label,
  unit,
  band,
  onChange,
}: {
  accessibleName: string;
  glossaryTerm?: "wtp" | "confidenceBand";
  label: string;
  unit: string;
  band: QuantileBand;
  onChange: (next: QuantileBand) => void;
}) {
  const [invalidDraft, setInvalidDraft] = useState<Partial<Record<BandField, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const onFieldChange = (field: BandField, raw: string) => {
    const result = editP50CenteredBand(band, field, Number(raw));
    if (!result.ok) {
      setInvalidDraft((current) => ({ ...current, [field]: raw }));
      setError(result.error);
      return;
    }
    setInvalidDraft({});
    setError(null);
    onChange(result.value);
  };

  return (
    <fieldset className="rounded-xl border border-line bg-canvas p-4">
      <legend className="px-1 text-sm font-semibold text-ink">
        {label}
        {glossaryTerm ? <GlossaryPopover term={glossaryTerm} /> : null}
      </legend>
      <p className="-mt-1 text-xs leading-5 text-muted">
        P50 is the base. Changing an endpoint mirrors the other side to keep the band P50-centred.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {(["p10", "p50", "p90"] as const).map((field) => (
          <label className="text-xs font-medium text-muted" key={field}>
            {field.toUpperCase()} <span className="font-normal">({unit})</span>
            <input
              aria-label={`${accessibleName} ${field.toUpperCase()} (${unit})`}
              aria-invalid={error ? true : undefined}
              className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-2 text-sm font-semibold tabular-nums text-ink"
              inputMode="decimal"
              min="0.000001"
              onChange={(event) => onFieldChange(field, event.target.value)}
              step="any"
              type="number"
              value={invalidDraft[field] ?? String(band[field])}
            />
          </label>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-xs font-medium text-amber" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function WtpDensityStrip({ segment, currency }: { segment: Segment; currency: string }) {
  const sigma = Math.max(0.08, segment.withinSegmentSigma);
  const points = Array.from({ length: 41 }, (_, index) => {
    const x = (index / 40) * 100;
    const z = (index / 40) * 6 - 3;
    const width = sigma / 0.4;
    const y = 31 - Math.exp(-(z * z) / (2 * width * width)) * 24;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div className="mt-4 rounded-xl bg-accent-soft px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">
          Buyer-value density <GlossaryPopover term="spread" />
        </p>
        <p className="text-xs text-muted">σ {segment.withinSegmentSigma.toFixed(2)}</p>
      </div>
      <svg
        aria-label={`${segment.name} willingness-to-pay density around a ${formatCurrency(segment.wtpBand.p50, currency)} median`}
        className="mt-2 h-10 w-full text-accent"
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 100 36"
      >
        <path d={`M0,36 L${points} L100,36 Z`} fill="currentColor" fillOpacity="0.16" />
        <polyline fill="none" points={points} stroke="currentColor" strokeWidth="1.8" />
        <line
          stroke="currentColor"
          strokeDasharray="2 2"
          strokeWidth="1"
          x1="50"
          x2="50"
          y1="4"
          y2="35"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted">
        <span>{formatCurrency(segment.wtpBand.p10, currency)}</span>
        <span>Median {formatCurrency(segment.wtpBand.p50, currency)}</span>
        <span>{formatCurrency(segment.wtpBand.p90, currency)}</span>
      </div>
    </div>
  );
}

function ProvenanceControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Provenance;
  onChange: (next: Provenance) => void;
}) {
  return (
    <fieldset className="rounded-xl border border-line bg-canvas p-3">
      <legend className="px-1 text-xs font-semibold text-ink">
        {label} <GlossaryPopover term="provenance" />
      </legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Source
          <select
            className="mt-1 min-h-9 w-full rounded-lg border border-line bg-canvas-raised px-2 text-sm text-ink"
            onChange={(event) =>
              onChange({ ...value, kind: event.target.value as Provenance["kind"] })
            }
            value={value.kind}
          >
            <option value="guess">Guess</option>
            <option value="interview">Interview</option>
            <option value="survey">Survey</option>
            <option value="conjoint">Conjoint</option>
            <option value="benchmark">Benchmark</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Confidence
          <select
            className="mt-1 min-h-9 w-full rounded-lg border border-line bg-canvas-raised px-2 text-sm text-ink"
            onChange={(event) =>
              onChange({ ...value, confidence: event.target.value as Provenance["confidence"] })
            }
            value={value.confidence}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      {value.kind === "benchmark" ? (
        <label className="mt-2 block text-xs text-muted">
          Source note
          <input
            className="mt-1 min-h-9 w-full rounded-lg border border-line bg-canvas-raised px-2 text-sm text-ink"
            onChange={(event) => onChange({ ...value, note: event.target.value || undefined })}
            placeholder="Source or link description"
            value={value.note ?? ""}
          />
        </label>
      ) : null}
    </fieldset>
  );
}

function spreadPreset(sigma: number) {
  if (sigma === 0.25) return "low";
  if (sigma === 0.5) return "medium";
  if (sigma === 0.9) return "high";
  return "custom";
}

function SegmentCard({ segment, scenario }: { segment: Segment; scenario: Scenario }) {
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const updateSegment = (updater: (current: Segment) => Segment) => {
    updateScenario((current) => ({
      ...current,
      model: {
        ...current.model,
        segments: current.model.segments.map((candidate) =>
          candidate.id === segment.id ? updater(candidate) : candidate,
        ),
      },
    }));
  };

  return (
    <article className="rounded-2xl border border-line bg-canvas-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Buyer segment
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">{segment.name}</h2>
        </div>
        <label className="text-xs font-medium text-muted">
          Seats per account
          <input
            aria-label={`${segment.name} seats per account`}
            className="mt-1 block min-h-10 w-28 rounded-lg border border-line bg-canvas px-2 text-sm font-semibold tabular-nums text-ink"
            min="1"
            onChange={(event) => {
              const seatCount = Number(event.target.value);
              if (Number.isInteger(seatCount) && seatCount >= 1) {
                updateSegment((current) => ({ ...current, seatCount }));
              }
            }}
            type="number"
            value={segment.seatCount}
          />
        </label>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <P50BandEditor
            accessibleName={`${segment.name} market size confidence band`}
            band={segment.prospectBand}
            glossaryTerm="confidenceBand"
            label="Market size confidence band"
            onChange={(prospectBand) => updateSegment((current) => ({ ...current, prospectBand }))}
            unit="accounts"
          />
          <div className="mt-3">
            <ProvenanceControl
              label="Market-size provenance"
              onChange={(prospectCount) =>
                updateSegment((current) => ({
                  ...current,
                  provenance: { ...current.provenance, prospectCount },
                }))
              }
              value={segment.provenance.prospectCount}
            />
          </div>
        </div>
        <div>
          <P50BandEditor
            accessibleName={`${segment.name} account-level WTP confidence band`}
            band={segment.wtpBand}
            glossaryTerm="wtp"
            label="Account-level WTP confidence band"
            onChange={(wtpBand) => updateSegment((current) => ({ ...current, wtpBand }))}
            unit={scenario.settings.currency}
          />
          <WtpDensityStrip currency={scenario.settings.currency} segment={segment} />
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="text-xs font-medium text-muted">
              Within-segment spread <GlossaryPopover term="spread" />
              <select
                aria-label={`${segment.name} buyer spread preset`}
                className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas px-2 text-sm text-ink"
                onChange={(event) => {
                  const values: Record<string, number> = { low: 0.25, medium: 0.5, high: 0.9 };
                  const sigma = values[event.target.value];
                  if (sigma !== undefined)
                    updateSegment((current) => ({ ...current, withinSegmentSigma: sigma }));
                }}
                value={spreadPreset(segment.withinSegmentSigma)}
              >
                <option value="low">Low variation</option>
                <option value="medium">Medium variation</option>
                <option value="high">High variation</option>
                <option value="custom">Custom ({segment.withinSegmentSigma.toFixed(2)})</option>
              </select>
            </label>
            <label className="text-xs font-medium text-muted">
              σ
              <input
                aria-label={`${segment.name} buyer spread sigma`}
                className="mt-1 block min-h-10 w-20 rounded-lg border border-line bg-canvas px-2 text-sm font-semibold tabular-nums text-ink"
                max="2"
                min="0.05"
                onChange={(event) => {
                  const withinSegmentSigma = Number(event.target.value);
                  if (
                    Number.isFinite(withinSegmentSigma) &&
                    withinSegmentSigma >= 0.05 &&
                    withinSegmentSigma <= 2
                  ) {
                    updateSegment((current) => ({ ...current, withinSegmentSigma }));
                  }
                }}
                step="0.01"
                type="number"
                value={segment.withinSegmentSigma}
              />
            </label>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">
            This describes variation between buyers, not how uncertain you are about the base WTP
            assumption.
          </p>
          <div className="mt-3">
            <ProvenanceControl
              label="WTP provenance"
              onChange={(willingnessToPay) =>
                updateSegment((current) => ({
                  ...current,
                  provenance: { ...current.provenance, willingnessToPay },
                }))
              }
              value={segment.provenance.willingnessToPay}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function moveMatrixFocus(
  event: KeyboardEvent<HTMLInputElement>,
  row: number,
  column: number,
  rowCount: number,
  columnCount: number,
) {
  const directions: Record<string, readonly [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const direction = directions[event.key];
  if (!direction) return;
  const nextRow = row + direction[0];
  const nextColumn = column + direction[1];
  if (nextRow < 0 || nextRow >= rowCount || nextColumn < 0 || nextColumn >= columnCount) return;
  const next = document.querySelector<HTMLInputElement>(
    `[data-model-matrix-cell="${nextRow}-${nextColumn}"]`,
  );
  if (next) {
    event.preventDefault();
    next.focus();
  }
}

function ValueMatrix({ scenario }: { scenario: Scenario }) {
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const [mode, setMode] = useState<MatrixMode>("allocation");
  const [error, setError] = useState<string | null>(null);
  const { features, segments } = scenario.model;

  const applyScenarioEdit = (result: ReturnType<typeof editAllocationShare>) => {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    updateScenario(() => result.value);
  };

  if (features.length === 0 || segments.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="value-matrix-title"
      className="mt-6 rounded-2xl border border-line bg-canvas-raised p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Value model
          </p>
          <h2
            className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink"
            id="value-matrix-title"
          >
            Feature value matrix
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Allocate each segment’s total WTP across the catalog, or switch to direct dollar values.
            Arrow keys move through matrix cells.
          </p>
        </div>
        <div
          aria-label="Matrix editing mode"
          className="inline-flex rounded-lg border border-line bg-canvas p-1"
        >
          <button
            aria-pressed={mode === "allocation"}
            className={`min-h-9 rounded-md px-3 text-sm font-semibold ${mode === "allocation" ? "bg-accent-soft text-accent" : "text-muted"}`}
            onClick={() => setMode("allocation")}
            type="button"
          >
            Allocation shares
          </button>
          <button
            aria-pressed={mode === "direct"}
            className={`min-h-9 rounded-md px-3 text-sm font-semibold ${mode === "direct" ? "bg-accent-soft text-accent" : "text-muted"}`}
            onClick={() => setMode("direct")}
            type="button"
          >
            Direct values
          </button>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-left">
          <caption className="sr-only">
            {mode === "allocation" ? "Feature allocation shares" : "Direct feature values"} by
            segment
          </caption>
          <thead>
            <tr>
              <th
                className="border-b border-line px-3 py-3 text-xs font-semibold text-muted"
                scope="col"
              >
                Feature
              </th>
              {segments.map((segment) => (
                <th
                  className="border-b border-line px-3 py-3 text-xs font-semibold text-ink"
                  key={segment.id}
                  scope="col"
                >
                  <span className="block">{segment.name}</span>
                  <span className="mt-1 block font-normal text-muted">
                    {mode === "allocation"
                      ? `Total ${formatCurrency(segment.wtpBand.p50, scenario.settings.currency)}`
                      : "$/account/month"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((feature, row) => (
              <tr key={feature.id}>
                <th
                  className="border-b border-line px-3 py-3 text-sm font-medium text-ink"
                  scope="row"
                >
                  {feature.name}
                </th>
                {segments.map((segment, column) => {
                  const allocation = segment.featureAllocation[feature.id];
                  const value =
                    mode === "allocation"
                      ? Number((allocation * 100).toFixed(3))
                      : Number((allocation * segment.wtpBand.p50).toFixed(2));
                  return (
                    <td className="border-b border-line px-3 py-3" key={segment.id}>
                      <label className="sr-only" htmlFor={`matrix-${row}-${column}`}>
                        {feature.name} value for {segment.name}
                      </label>
                      <div className="relative">
                        <input
                          data-model-matrix-cell={`${row}-${column}`}
                          id={`matrix-${row}-${column}`}
                          aria-label={`${feature.name} value for ${segment.name}`}
                          className="min-h-10 w-28 rounded-lg border border-line bg-canvas px-2 pr-7 text-sm font-semibold tabular-nums text-ink"
                          inputMode="decimal"
                          min="0"
                          onChange={(event) => {
                            const numericValue = Number(event.target.value);
                            if (!Number.isFinite(numericValue)) return;
                            applyScenarioEdit(
                              mode === "allocation"
                                ? editAllocationShare(
                                    scenario,
                                    segment.id,
                                    feature.id,
                                    numericValue,
                                  )
                                : editDirectFeatureValue(
                                    scenario,
                                    segment.id,
                                    feature.id,
                                    numericValue,
                                  ),
                            );
                          }}
                          onKeyDown={(event) =>
                            moveMatrixFocus(event, row, column, features.length, segments.length)
                          }
                          step={mode === "allocation" ? "0.1" : "0.01"}
                          type="number"
                          value={value}
                        />
                        <span className="pointer-events-none absolute top-2.5 right-2 text-xs text-muted">
                          {mode === "allocation" ? "%" : scenario.settings.currency}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? (
        <p className="mt-3 text-sm font-medium text-amber" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mt-4 text-xs leading-5 text-muted">
        {mode === "allocation"
          ? "Each edit rebalances the other features for that segment, keeping allocations at exactly 100%."
          : "Editing direct values recomputes the segment’s P50 total and preserves the confidence-band width."}
      </p>
    </section>
  );
}

function TemplatePicker({ onStartBlank }: { onStartBlank: () => void }) {
  const replaceScenario = useScenarioStore((state) => state.replaceScenario);

  const chooseTemplate = (template: (typeof scenarioTemplates)[number]) => {
    replaceScenario(
      template.scenario,
      `${template.title} loaded. Its assumptions are illustrative.`,
    );
    scenarioStore.temporal.getState().clear();
  };

  return (
    <section
      aria-labelledby="template-picker-title"
      className="mx-auto max-w-5xl px-6 py-10 sm:px-10"
    >
      <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
        First decision
      </p>
      <h1
        className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
        id="template-picker-title"
      >
        Choose a starting scenario
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted">
        Start from an archetype to see the wind tunnel immediately, or build a blank model. Template
        values are illustrative guesses, not market evidence.
      </p>
      <div className="mt-7 grid gap-4 md:grid-cols-3">
        {scenarioTemplates.map((template) => (
          <article
            className="flex flex-col rounded-2xl border border-line bg-canvas p-5"
            key={template.id}
          >
            <h2 className="text-lg font-semibold text-ink">{template.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-muted">{template.description}</p>
            <button
              className="mt-5 min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong"
              onClick={() => chooseTemplate(template)}
              type="button"
            >
              Use this template
            </button>
          </article>
        ))}
      </div>
      <button
        className="mt-5 min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent"
        onClick={onStartBlank}
        type="button"
      >
        Start a blank model
      </button>
    </section>
  );
}

function addFeature(scenario: Scenario): Scenario {
  const index = scenario.model.features.length + 1;
  const id = `feature-${index}`;
  return {
    ...scenario,
    model: {
      ...scenario.model,
      features: [...scenario.model.features, { id, name: `Feature ${index}` }],
      segments: scenario.model.segments.map((segment) => ({
        ...segment,
        featureAllocation: { ...segment.featureAllocation, [id]: 0 },
        provenance: {
          ...segment.provenance,
          featureValues: { ...segment.provenance.featureValues, [id]: emptyProvenance },
        },
      })),
    },
  };
}

function addSegment(scenario: Scenario): Scenario | null {
  if (scenario.model.features.length === 0) return null;
  const index = scenario.model.segments.length + 1;
  const id = `segment-${index}`;
  const allocation = 1 / scenario.model.features.length;
  return {
    ...scenario,
    model: {
      ...scenario.model,
      segments: [
        ...scenario.model.segments,
        {
          id,
          name: `Segment ${index}`,
          prospectBand: { p10: 100, p50: 150, p90: 225 },
          seatCount: 5,
          wtpBand: { p10: 50, p50: 75, p90: 112.5 },
          withinSegmentSigma: 0.5,
          featureAllocation: Object.fromEntries(
            scenario.model.features.map((feature) => [feature.id, allocation]),
          ),
          provenance: {
            prospectCount: emptyProvenance,
            willingnessToPay: emptyProvenance,
            featureValues: Object.fromEntries(
              scenario.model.features.map((feature) => [feature.id, emptyProvenance]),
            ),
          },
        },
      ],
    },
  };
}

function BlankModelActions({ scenario }: { scenario: Scenario }) {
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const setMessage = useScenarioStore((state) => state.setMessage);

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <button
        className="min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
        disabled={scenario.model.features.length >= 12}
        onClick={() => updateScenario(addFeature)}
        type="button"
      >
        Add feature
      </button>
      <button
        className="min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
        disabled={scenario.model.segments.length >= 6}
        onClick={() => {
          const next = addSegment(scenario);
          if (next) updateScenario(() => next);
          else setMessage("Add at least one feature before creating a buyer segment.");
        }}
        type="button"
      >
        Add segment
      </button>
    </div>
  );
}

export function ModelSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const [blankStarted, setBlankStarted] = useState(false);
  const isFirstRun =
    !blankStarted && scenario.model.features.length === 0 && scenario.model.segments.length === 0;

  if (isFirstRun) return <TemplatePicker onStartBlank={() => setBlankStarted(true)} />;

  return (
    <section aria-labelledby="model-title" className="w-full px-5 py-7 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
            Model the buyers
          </p>
          <h1
            className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
            id="model-title"
          >
            Make the assumptions visible
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted">
            Separate uncertainty about the market from variation between buyers. The active design
            responds to every valid model edit.
          </p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-amber-soft px-3 py-2 text-xs font-semibold tracking-[0.08em] text-amber uppercase">
            {scenario.model.segments.length} / 6 segments
          </span>
          <span className="rounded-full bg-accent-soft px-3 py-2 text-xs font-semibold tracking-[0.08em] text-accent uppercase">
            {scenario.model.features.length} / 12 features
          </span>
        </div>
      </div>

      <div className="mt-6">
        <ModelKpiRail scenario={scenario} />
      </div>
      <BlankModelActions scenario={scenario} />

      {scenario.model.segments.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-canvas p-8 text-center">
          <p className="font-semibold text-ink">
            Start with a buyer segment once the catalog has a feature.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">
            A template is the quickest way to learn the model; blank scenarios stay in draft until
            the model and design are ready.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-5">
          {scenario.model.segments.map((segment) => (
            <SegmentCard key={segment.id} scenario={scenario} segment={segment} />
          ))}
        </div>
      )}
      <ValueMatrix scenario={scenario} />
    </section>
  );
}
