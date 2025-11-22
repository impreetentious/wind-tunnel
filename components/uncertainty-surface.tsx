"use client";

import { useMemo, useState } from "react";

import { MAX_MONTE_CARLO_DRAWS, MIN_MONTE_CARLO_DRAWS } from "@/lib/engine/montecarlo";
import type { MonteCarloResult, MonteCarloTornadoDriver } from "@/lib/engine/types";
import {
  runScenarioMonteCarlo,
  uncertaintyParametersForScenario,
  type ScenarioUncertaintyParameter,
} from "@/lib/state/scenario-economics";
import { useScenarioStore } from "@/lib/state/scenario-store";

type ChartMode = "chart" | "table";

const drawCounts = [200, 500, 1_000, 2_000, 5_000] as const;
const EPSILON = 1e-9;

function formatCurrency(value: number, currency: string, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(value);
}

function formatSignedCurrency(value: number, currency: string) {
  if (Math.abs(value) < 0.005) return formatCurrency(0, currency);
  return `${value > 0 ? "+" : "−"}${formatCurrency(Math.abs(value), currency)}`;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function ChartToggle({ mode, onChange }: { mode: ChartMode; onChange: (mode: ChartMode) => void }) {
  const isTable = mode === "table";
  return (
    <button
      aria-pressed={isTable}
      className="min-h-9 rounded-lg border border-line bg-canvas-raised px-3 text-xs font-semibold text-ink hover:border-accent"
      onClick={() => onChange(isTable ? "chart" : "table")}
      type="button"
    >
      {isTable ? "Show tornado chart" : "View tornado as table"}
    </button>
  );
}

function PercentileBand({
  label,
  p10,
  p50,
  p90,
  currency,
}: {
  label: string;
  p10: number;
  p50: number;
  p90: number;
  currency: string;
}) {
  return (
    <section aria-label={`${label} MRR percentile band`} className="rounded-2xl bg-accent-soft p-5">
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        MRR uncertainty
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">{label}</h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        {[
          { label: "P10", value: p10 },
          { label: "P50", value: p50 },
          { label: "P90", value: p90 },
        ].map((percentile) => (
          <div className="border-t border-line pt-3" key={percentile.label}>
            <dt className="text-xs font-medium text-muted">{percentile.label} monthly MRR</dt>
            <dd
              className="mt-1 text-lg font-semibold tracking-[-0.02em] tabular-nums text-ink"
              data-testid={percentile.label === "P50" ? "monte-carlo-p50" : undefined}
            >
              {formatCurrency(percentile.value, currency)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm leading-6 text-muted">
        These are empirical percentiles across the sampled assumptions—not confidence intervals.
      </p>
    </section>
  );
}

function DistributionTable({
  distributions,
  currency,
}: {
  distributions: MonteCarloResult["distributions"];
  currency: string;
}) {
  return (
    <section
      aria-labelledby="design-distributions-title"
      className="rounded-2xl border border-line bg-canvas p-5"
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Design distributions
      </p>
      <h2
        className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink"
        id="design-distributions-title"
      >
        Every design receives the same draws
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        The P10/P50/P90 band is reported separately for each saved design, using the same indexed
        buyer assumptions for a fair comparison.
      </p>
      <div className="mt-5 overflow-x-auto">
        <table
          className="w-full min-w-[34rem] border-collapse text-left text-sm"
          aria-label="Design MRR distributions"
        >
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Design</th>
              <th className="px-3 py-2 text-right font-semibold">P10</th>
              <th className="px-3 py-2 text-right font-semibold">P50</th>
              <th className="px-3 py-2 text-right font-semibold">P90</th>
              <th className="px-3 py-2 text-right font-semibold">Mean</th>
            </tr>
          </thead>
          <tbody>
            {distributions.map((distribution) => (
              <tr className="border-b border-line/70" key={distribution.designId}>
                <td className="px-3 py-3 font-medium text-ink">{distribution.label}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatCurrency(distribution.percentiles.p10, currency)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatCurrency(distribution.percentiles.p50, currency)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatCurrency(distribution.percentiles.p90, currency)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatCurrency(distribution.percentiles.mean, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WinRates({
  comparisons,
  designs,
}: {
  comparisons: MonteCarloResult["comparisons"];
  designs: MonteCarloResult["distributions"];
}) {
  const labelById = new Map(designs.map((design) => [design.designId, design.label]));
  if (comparisons.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-canvas p-5">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Paired comparison
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
          Add an alternative to compare
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Duplicate the active design in Design to see a paired win rate. Both menus will receive
          the same buyer-assumption draw vector.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="win-rate-title"
      className="rounded-2xl border border-line bg-canvas p-5"
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Paired comparison
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink" id="win-rate-title">
        Which alternative wins more often?
      </h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {comparisons.map((comparison) => (
          <article
            className="rounded-xl border border-line bg-canvas-raised p-4"
            key={comparison.challengerDesignId}
          >
            <p className="text-sm font-semibold text-ink">
              {labelById.get(comparison.challengerDesignId)} vs{" "}
              {labelById.get(comparison.referenceDesignId)}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
              {formatPercent(comparison.challengerWinRate)}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted">
              challenger wins · {formatCount(comparison.challengerWins)} wins,{" "}
              {formatCount(comparison.ties)} ties
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function TornadoChart({
  drivers,
  currency,
}: {
  drivers: readonly MonteCarloTornadoDriver[];
  currency: string;
}) {
  const maxDelta = Math.max(...drivers.map((driver) => driver.maximumAbsoluteDelta), EPSILON);
  const rowHeight = 31;
  const height = 28 + drivers.length * rowHeight;

  return (
    <figure className="mt-6 overflow-x-auto" data-testid="tornado-chart">
      <svg
        aria-label="Tornado sensitivity chart showing low and high assumption effects on monthly recurring revenue"
        className="min-w-[38rem]"
        height={height}
        role="img"
        viewBox={`0 0 620 ${height}`}
        width="100%"
      >
        <line stroke="var(--line)" strokeWidth="1" x1="350" x2="350" y1="10" y2={height - 8} />
        <text fill="var(--muted)" fontSize="11" textAnchor="end" x="340" y="14">
          Lower assumption
        </text>
        <text fill="var(--muted)" fontSize="11" x="360" y="14">
          Higher assumption
        </text>
        {drivers.map((driver, index) => {
          const y = 27 + index * rowHeight;
          const lowX = 350 + (driver.lowDelta / maxDelta) * 230;
          const highX = 350 + (driver.highDelta / maxDelta) * 230;
          return (
            <g key={driver.parameterId}>
              <text fill="var(--ink)" fontSize="12" x="4" y={y + 11}>
                {driver.label}
              </text>
              <rect
                fill="#0072b2"
                height="9"
                rx="2"
                width={Math.abs(350 - lowX)}
                x={Math.min(350, lowX)}
                y={y}
              />
              <rect
                fill="#d55e00"
                height="9"
                rx="2"
                width={Math.abs(350 - highX)}
                x={Math.min(350, highX)}
                y={y + 12}
              />
              <text fill="var(--muted)" fontSize="10" textAnchor="end" x="608" y={y + 10}>
                {formatSignedCurrency(driver.lowDelta, currency)} /{" "}
                {formatSignedCurrency(driver.highDelta, currency)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[#0072b2]" />
          P10 assumption
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[#d55e00]" />
          P90 assumption
        </span>
        <span>Each bar moves one input while every other input stays at P50.</span>
      </figcaption>
    </figure>
  );
}

function TornadoTable({
  drivers,
  currency,
}: {
  drivers: readonly MonteCarloTornadoDriver[];
  currency: string;
}) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table
        className="w-full min-w-[42rem] border-collapse text-left text-sm"
        aria-label="Tornado sensitivity table"
      >
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Assumption</th>
            <th className="px-3 py-2 text-right font-semibold">Base MRR</th>
            <th className="px-3 py-2 text-right font-semibold">P10 MRR change</th>
            <th className="px-3 py-2 text-right font-semibold">P90 MRR change</th>
            <th className="px-3 py-2 text-right font-semibold">Largest swing</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((driver) => (
            <tr className="border-b border-line/70" key={driver.parameterId}>
              <td className="px-3 py-3 font-medium text-ink">{driver.label}</td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {formatCurrency(driver.baseMrr, currency)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {formatSignedCurrency(driver.lowDelta, currency)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {formatSignedCurrency(driver.highDelta, currency)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {formatCurrency(driver.maximumAbsoluteDelta, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TornadoPanel({
  drivers,
  currency,
}: {
  drivers: readonly MonteCarloTornadoDriver[];
  currency: string;
}) {
  const [mode, setMode] = useState<ChartMode>("chart");
  return (
    <section
      aria-labelledby="tornado-title"
      className="rounded-2xl border border-line bg-canvas p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Sensitivity
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink" id="tornado-title">
            Which assumption moves MRR most?
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Drivers are sorted by their largest one-at-a-time MRR movement from the active
            design&apos;s P50 baseline.
          </p>
        </div>
        <ChartToggle mode={mode} onChange={setMode} />
      </div>
      {mode === "chart" ? (
        <TornadoChart currency={currency} drivers={drivers} />
      ) : (
        <TornadoTable currency={currency} drivers={drivers} />
      )}
    </section>
  );
}

function provenanceAdvice(parameter: ScenarioUncertaintyParameter) {
  const { provenance } = parameter;
  const source = `${provenance.confidence}-confidence ${provenance.kind}`;
  if (provenance.kind === "guess")
    return `Recorded as a ${source}; turn it into an interview or survey-backed estimate first.`;
  if (provenance.kind === "interview")
    return `Recorded as a ${source}; test it with a broader sample before treating it as a market estimate.`;
  if (provenance.kind === "survey")
    return `Recorded as a ${source}; review sample fit and the band before relying on it.`;
  if (provenance.kind === "conjoint")
    return `Recorded as a ${source}; revisit the study fit and segment mapping.`;
  return provenance.note
    ? `Recorded as a ${source}; re-check the cited benchmark: ${provenance.note}`
    : `Recorded as a ${source}; re-check the source before using it in a decision.`;
}

function ValidationTodoList({
  drivers,
  parameters,
  currency,
}: {
  drivers: readonly MonteCarloTornadoDriver[];
  parameters: readonly ScenarioUncertaintyParameter[];
  currency: string;
}) {
  const parameterById = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  const materialDrivers = drivers.filter((driver) => driver.maximumAbsoluteDelta > EPSILON);
  return (
    <section
      aria-labelledby="validation-todos-title"
      className="rounded-2xl border border-line bg-canvas p-5"
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Validation queue
      </p>
      <h2
        className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink"
        id="validation-todos-title"
      >
        Validate the assumptions with the biggest consequence
      </h2>
      {materialDrivers.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-muted">
          None of the current assumption bands moves active-design MRR. Widen a genuinely uncertain
          band only when it reflects a real evidence gap.
        </p>
      ) : (
        <ol className="mt-5 grid gap-3">
          {materialDrivers.map((driver, index) => {
            const parameter = parameterById.get(driver.parameterId);
            return (
              <li
                className="rounded-xl border border-line bg-canvas-raised p-4"
                key={driver.parameterId}
              >
                <p className="text-sm font-semibold text-ink">
                  {index + 1}. Validate {driver.label}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Its stated P10/P90 range moves monthly MRR by up to{" "}
                  {formatCurrency(driver.maximumAbsoluteDelta, currency)}.{" "}
                  {parameter
                    ? provenanceAdvice(parameter)
                    : "Review the evidence behind this assumption."}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function EmptyUncertainty() {
  return (
    <section className="grid min-h-[28rem] place-items-center px-6 py-14 text-center sm:px-12">
      <div className="max-w-xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Analyze uncertainty
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
          Add buyer assumptions to test their range.
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-base leading-7 text-muted">
          Start from a template or add a segment in Model. The uncertainty view samples the P10/P90
          size and WTP bands without simulating individual buyers again.
        </p>
      </div>
    </section>
  );
}

export function UncertaintySurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const setSettings = useScenarioStore((state) => state.setSettings);
  const [drawCount, setDrawCount] = useState<number>(1_000);
  const parameters = useMemo(() => uncertaintyParametersForScenario(scenario), [scenario]);
  const result = useMemo(() => runScenarioMonteCarlo(scenario, drawCount), [scenario, drawCount]);
  const activeDistribution = result?.distributions.find(
    (distribution) => distribution.designId === scenario.activeDesignId,
  );

  if (!result || !activeDistribution) return <EmptyUncertainty />;

  return (
    <section aria-labelledby="analyze-title" className="w-full px-5 py-7 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
            Analyze uncertainty
          </p>
          <h1
            className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
            id="analyze-title"
          >
            Stress-test the assumptions behind this menu
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted">
            This samples only the model&apos;s P10/P90 size and WTP bands. Buyer heterogeneity, tier
            prices, and fences stay fixed inside each closed-form run.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-canvas-raised p-3">
          <label className="text-sm font-medium text-ink">
            Simulation seed
            <input
              aria-label="Simulation seed"
              className="ml-2 min-h-10 w-28 rounded-lg border border-line bg-canvas px-3 text-sm tabular-nums text-ink"
              max={4_294_967_295}
              min={0}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 0 && value <= 4_294_967_295) {
                  setSettings({ seed: value });
                }
              }}
              step={1}
              type="number"
              value={scenario.settings.seed}
            />
          </label>
          <label className="text-sm font-medium text-ink">
            Draws
            <select
              aria-label="Monte Carlo draw count"
              className="ml-2 min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm text-ink"
              onChange={(event) => setDrawCount(Number(event.target.value))}
              value={drawCount}
            >
              {drawCounts.map((count) => (
                <option key={count} value={count}>
                  {formatCount(count)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {formatCount(result.drawCount)} deterministic uncertainty draws updated for seed{" "}
        {result.seed}.
      </p>

      <div className="mt-7 space-y-6">
        <PercentileBand
          currency={scenario.settings.currency}
          label={activeDistribution.label}
          p10={activeDistribution.percentiles.p10}
          p50={activeDistribution.percentiles.p50}
          p90={activeDistribution.percentiles.p90}
        />
        <DistributionTable
          currency={scenario.settings.currency}
          distributions={result.distributions}
        />
        <WinRates comparisons={result.comparisons} designs={result.distributions} />
        <TornadoPanel currency={scenario.settings.currency} drivers={result.tornado} />
        <ValidationTodoList
          currency={scenario.settings.currency}
          drivers={result.tornado}
          parameters={parameters}
        />
      </div>
      <p className="mt-6 text-xs text-muted">
        {formatCount(result.drawCount)} seeded draws · allowed range{" "}
        {formatCount(MIN_MONTE_CARLO_DRAWS)}–{formatCount(MAX_MONTE_CARLO_DRAWS)}
      </p>
    </section>
  );
}
