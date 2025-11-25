"use client";

import { useMemo, useState } from "react";

import { lognormalPdf, lognormalQuantile, scaleDistribution } from "@/lib/engine/stats";
import type { ExpandedOffer, SegmentEconomicsReadout } from "@/lib/engine/types";
import { selectActiveDesign } from "@/lib/state/design-editing";
import { formatRecordMoney, formatRecordPercent } from "@/lib/state/decision-record";
import { runScenarioMonteCarlo, simulateScenarioDesign } from "@/lib/state/scenario-economics";
import { useScenarioStore } from "@/lib/state/scenario-store";
import type { Scenario } from "@/lib/state/schemas";

const EPSILON = 1e-9;
const mechanismColors = ["#0072b2", "#009e73", "#d55e00", "#cc79a7", "#e69f00"];

function utility(offer: ExpandedOffer, scale: number) {
  return scale * offer.value - offer.effectivePrice;
}

function mechanismDomain(segment: SegmentEconomicsReadout) {
  const distribution = scaleDistribution(segment.sigma);
  const densityEnd = segment.sigma === 0 ? 2 : lognormalQuantile(0.99, distribution);
  const finiteBreakpoints = segment.selection.active
    .flatMap((interval) => [interval.lower, interval.upper])
    .filter((value) => Number.isFinite(value) && value > 0);
  const xMax = Math.max(2, densityEnd, ...finiteBreakpoints) * 1.05;
  const values = segment.selection.offers.flatMap((offer) => [
    utility(offer, 0),
    utility(offer, xMax),
  ]);
  return {
    xMax,
    yMin: Math.min(0, ...values),
    yMax: Math.max(1, ...values),
  };
}

function MechanismChart({ segment }: { segment: SegmentEconomicsReadout }) {
  const { xMax, yMin, yMax } = mechanismDomain(segment);
  const left = 8;
  const right = 96;
  const top = 8;
  const bottom = 59;
  const x = (value: number) => left + (Math.max(0, Math.min(xMax, value)) / xMax) * (right - left);
  const y = (value: number) =>
    bottom - ((value - yMin) / Math.max(EPSILON, yMax - yMin)) * (bottom - top);
  const breakpoints = segment.selection.active
    .map((interval) => interval.lower)
    .filter((value) => Number.isFinite(value) && value > 0 && value <= xMax);
  const distribution = scaleDistribution(segment.sigma);
  const density = Array.from({ length: 64 }, (_, index) => {
    const scale = (index / 63) * xMax;
    return { scale, value: segment.sigma === 0 ? 0 : lognormalPdf(scale, distribution) };
  });
  const maxDensity = Math.max(EPSILON, ...density.map((point) => point.value));
  const densityPoints = density
    .map(
      (point) =>
        `${x(point.scale).toFixed(2)},${(77 - (point.value / maxDensity) * 10).toFixed(2)}`,
    )
    .join(" ");

  return (
    <figure className="mt-5 overflow-x-auto" data-testid="mechanism-chart">
      <svg
        aria-label="Utility lines, active upper envelope, indifference breakpoints, and buyer density"
        className="min-w-[42rem]"
        role="img"
        viewBox="0 0 100 82"
        width="100%"
      >
        <line stroke="var(--line)" strokeWidth="0.5" x1={left} x2={right} y1={y(0)} y2={y(0)} />
        <line stroke="var(--line)" strokeWidth="0.5" x1={left} x2={left} y1={top} y2={bottom} />
        {segment.selection.offers.map((offer, index) => (
          <line
            key={offer.id}
            opacity="0.38"
            stroke={
              offer.owner === "outside"
                ? "var(--muted)"
                : mechanismColors[index % mechanismColors.length]
            }
            strokeWidth="0.55"
            x1={x(0)}
            x2={x(xMax)}
            y1={y(utility(offer, 0))}
            y2={y(utility(offer, xMax))}
          />
        ))}
        {segment.selection.active.map((interval, index) => {
          const start = Math.max(0, interval.lower);
          const end = Math.min(xMax, interval.upper);
          if (!(end > start)) return null;
          return (
            <line
              data-testid={`mechanism-envelope-${index}`}
              key={`${interval.offer.id}:${start}`}
              stroke="var(--accent-strong)"
              strokeLinecap="round"
              strokeWidth="1.8"
              x1={x(start)}
              x2={x(end)}
              y1={y(utility(interval.offer, start))}
              y2={y(utility(interval.offer, end))}
            />
          );
        })}
        {breakpoints.map((breakpoint, index) => (
          <g key={`${breakpoint}:${index}`}>
            <line
              stroke="var(--amber)"
              strokeDasharray="1.5 1.5"
              strokeWidth="0.55"
              x1={x(breakpoint)}
              x2={x(breakpoint)}
              y1={top}
              y2="78"
            />
            <text
              data-testid={`mechanism-breakpoint-${index}`}
              fill="var(--amber)"
              fontSize="3.3"
              textAnchor="middle"
              x={x(breakpoint)}
              y="64"
            >
              ε {breakpoint.toFixed(3)}
            </text>
          </g>
        ))}
        {segment.sigma === 0 ? (
          <line stroke="var(--accent)" strokeWidth="1.2" x1={x(1)} x2={x(1)} y1="67" y2="78" />
        ) : (
          <polyline fill="none" points={densityPoints} stroke="var(--accent)" strokeWidth="0.9" />
        )}
        <text fill="var(--muted)" fontSize="3.5" x={left} y="5">
          Utility
        </text>
        <text fill="var(--muted)" fontSize="3.5" textAnchor="end" x={right} y="81">
          Buyer value scale ε
        </text>
      </svg>
      <figcaption className="mt-2 text-xs leading-5 text-muted">
        Thin lines are all alternatives; the heavy line is the exact upper envelope. The density
        strip shows where buyers sit along ε.
      </figcaption>
    </figure>
  );
}

function MechanismTable({ segment }: { segment: SegmentEconomicsReadout }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table
        className="w-full min-w-[42rem] border-collapse text-left text-sm"
        aria-label="Mechanism envelope table"
      >
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Active choice</th>
            <th className="px-3 py-2 text-right font-semibold">Value</th>
            <th className="px-3 py-2 text-right font-semibold">Account price</th>
            <th className="px-3 py-2 text-right font-semibold">Entry ε</th>
            <th className="px-3 py-2 text-right font-semibold">Exit ε</th>
            <th className="px-3 py-2 text-right font-semibold">Buyer share</th>
          </tr>
        </thead>
        <tbody>
          {segment.selection.active.map((interval, index) => (
            <tr className="border-b border-line/70" key={`${interval.offer.id}:${index}`}>
              <th className="px-3 py-3 font-medium text-ink" scope="row">
                {interval.offer.name}
              </th>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {interval.offer.value.toFixed(2)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {interval.offer.effectivePrice.toFixed(2)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {Number.isFinite(interval.lower) ? Math.max(0, interval.lower).toFixed(6) : "−∞"}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {Number.isFinite(interval.upper) ? interval.upper.toFixed(6) : "∞"}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {formatRecordPercent(interval.share)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MechanismSurface({ scenario }: { scenario: Scenario }) {
  const design = scenario.designs.find((candidate) => candidate.id === scenario.activeDesignId);
  const readout = design ? simulateScenarioDesign(scenario, design) : null;
  const [segmentId, setSegmentId] = useState(scenario.model.segments[0]?.id ?? "");
  const [table, setTable] = useState(false);
  const segment =
    readout?.segments.find((candidate) => candidate.id === segmentId) ?? readout?.segments[0];
  const segmentName = scenario.model.segments.find(
    (candidate) => candidate.id === segment?.id,
  )?.name;

  if (!segment)
    return (
      <p className="rounded-xl border border-line p-5 text-sm text-muted">
        Add a buyer segment to inspect the mechanism.
      </p>
    );
  return (
    <section
      className="rounded-2xl border border-line bg-canvas p-5"
      aria-labelledby="mechanism-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Mechanism view
          </p>
          <h2
            className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink"
            id="mechanism-title"
          >
            Inspect the screening envelope
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Utility lines, exact indifference points, and buyer density come from the same envelope
            result used by every KPI.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="text-sm font-medium text-ink">
            Segment
            <select
              className="ml-2 min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm text-ink"
              onChange={(event) => setSegmentId(event.target.value)}
              value={segment.id}
            >
              {scenario.model.segments.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-pressed={table}
            className="min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => setTable((current) => !current)}
            type="button"
          >
            {table ? "Show mechanism chart" : "View mechanism as table"}
          </button>
        </div>
      </div>
      <p className="mt-4 text-sm font-semibold text-ink">{segmentName ?? segment.id}</p>
      {table ? <MechanismTable segment={segment} /> : <MechanismChart segment={segment} />}
    </section>
  );
}

function signedMoney(value: number, currency: string) {
  if (Math.abs(value) <= EPSILON) return formatRecordMoney(0, currency);
  return `${value > 0 ? "+" : "−"}${formatRecordMoney(Math.abs(value), currency)}`;
}

function signedPercent(value: number) {
  if (Math.abs(value) <= EPSILON) return formatRecordPercent(0);
  return `${value > 0 ? "+" : "−"}${formatRecordPercent(Math.abs(value))}`;
}

function BuyerChoiceSummary({
  readout,
  segmentNames,
}: {
  readout: NonNullable<ReturnType<typeof simulateScenarioDesign>>;
  segmentNames: ReadonlyMap<string, string>;
}) {
  return (
    <div className="mt-4 grid gap-3">
      {readout.segments.map((segment) => {
        const choices = segment.selection.offers
          .map((offer) => ({ offer, share: segment.selection.shares[offer.id] ?? 0 }))
          .filter((choice) => choice.share > EPSILON)
          .sort((left, right) => right.share - left.share);
        return (
          <section className="rounded-lg border border-line p-3" key={segment.id}>
            <p className="text-xs font-semibold text-ink">
              {segmentNames.get(segment.id) ?? segment.id}
            </p>
            <div aria-hidden="true" className="mt-2 flex flex-wrap gap-1">
              {Array.from({ length: 20 }, (_, index) => {
                const quantile = (index + 0.5) / 20;
                let cumulative = 0;
                const choice = choices.find((candidate) => {
                  cumulative += candidate.share;
                  return quantile <= cumulative + EPSILON;
                });
                const choiceIndex = Math.max(0, choices.indexOf(choice ?? choices[0]));
                return (
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    key={index}
                    style={{
                      backgroundColor: mechanismColors[choiceIndex % mechanismColors.length],
                    }}
                  />
                );
              })}
            </div>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {choices.map((choice) => (
                <li key={choice.offer.id}>
                  {choice.offer.name}: {formatRecordPercent(choice.share)}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function DesignCompareSurface({ scenario }: { scenario: Scenario }) {
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const challengers = scenario.designs.filter((design) => design.id !== scenario.activeDesignId);
  const [challengerId, setChallengerId] = useState(challengers[0]?.id ?? "");
  const reference = scenario.designs.find((design) => design.id === scenario.activeDesignId);
  const challenger = challengers.find((design) => design.id === challengerId) ?? challengers[0];
  const referenceReadout = reference ? simulateScenarioDesign(scenario, reference) : null;
  const challengerReadout = challenger ? simulateScenarioDesign(scenario, challenger) : null;
  const monteCarlo = useMemo(() => runScenarioMonteCarlo(scenario, 200), [scenario]);
  const comparison = monteCarlo?.comparisons.find(
    (candidate) => candidate.challengerDesignId === challenger?.id,
  );
  const segmentNames = new Map(
    scenario.model.segments.map((segment) => [segment.id, segment.name]),
  );

  if (!reference || !referenceReadout || challengers.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-line bg-canvas p-8 text-center">
        <h2 className="text-xl font-semibold text-ink">Create an alternative to compare.</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">
          Duplicate the active design in Design, change a price or fence, then return here for
          paired economics under the same buyers.
        </p>
      </section>
    );
  }
  if (!challenger || !challengerReadout) return null;
  const currency = scenario.settings.currency;
  const metrics = [
    {
      label: "MRR",
      reference: referenceReadout.mrr,
      challenger: challengerReadout.mrr,
      format: (value: number) => formatRecordMoney(value, currency),
      delta: (value: number) => signedMoney(value, currency),
    },
    {
      label: "Paid conversion",
      reference: referenceReadout.paidConversion,
      challenger: challengerReadout.paidConversion,
      format: formatRecordPercent,
      delta: signedPercent,
    },
    {
      label: "ARPA",
      reference: referenceReadout.arpa,
      challenger: challengerReadout.arpa,
      format: (value: number) => formatRecordMoney(value, currency),
      delta: (value: number) => signedMoney(value, currency),
    },
    {
      label: "Capture rate",
      reference: referenceReadout.captureRate,
      challenger: challengerReadout.captureRate,
      format: formatRecordPercent,
      delta: signedPercent,
    },
  ];

  return (
    <section
      className="rounded-2xl border border-line bg-canvas p-5"
      aria-labelledby="compare-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            A/B compare
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink" id="compare-title">
            Compare menus against identical buyers
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Deltas use the exact P50 model; the paired win rate uses common random numbers across
            the same 200 assumption draws.
          </p>
        </div>
        <label className="text-sm font-medium text-ink">
          Challenger
          <select
            aria-label="Challenger design"
            className="ml-2 min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm text-ink"
            onChange={(event) => setChallengerId(event.target.value)}
            value={challenger.id}
          >
            {challengers.map((design) => (
              <option key={design.id} value={design.id}>
                {design.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table
          className="w-full min-w-[38rem] border-collapse text-left text-sm"
          aria-label="Design KPI comparison"
        >
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">KPI</th>
              <th className="px-3 py-2 text-right font-semibold">{reference.name}</th>
              <th className="px-3 py-2 text-right font-semibold">{challenger.name}</th>
              <th className="px-3 py-2 text-right font-semibold">Challenger delta</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr className="border-b border-line/70" key={metric.label}>
                <th className="px-3 py-3 font-medium text-ink" scope="row">
                  {metric.label}
                </th>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {metric.format(metric.reference)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {metric.format(metric.challenger)}
                </td>
                <td
                  className="px-3 py-3 text-right font-semibold tabular-nums text-ink"
                  data-testid={`compare-delta-${metric.label.toLowerCase().replaceAll(" ", "-")}`}
                >
                  {metric.delta(metric.challenger - metric.reference)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl bg-canvas-raised p-4">
          <h3 className="font-semibold text-ink">{reference.name} buyer sorting</h3>
          <BuyerChoiceSummary readout={referenceReadout} segmentNames={segmentNames} />
        </section>
        <section className="rounded-xl bg-canvas-raised p-4">
          <h3 className="font-semibold text-ink">{challenger.name} buyer sorting</h3>
          <BuyerChoiceSummary readout={challengerReadout} segmentNames={segmentNames} />
        </section>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-accent-soft p-4">
        <div>
          <p className="text-sm font-semibold text-ink">Paired uncertainty win rate</p>
          <p className="mt-1 text-sm text-muted">
            {comparison
              ? `${challenger.name} wins ${formatRecordPercent(comparison.challengerWinRate)} of draws (${comparison.ties} ties).`
              : "No paired comparison is available."}
          </p>
        </div>
        <button
          className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong"
          onClick={() => updateScenario((current) => selectActiveDesign(current, challenger.id))}
          type="button"
        >
          Promote {challenger.name} to active
        </button>
      </div>
    </section>
  );
}
