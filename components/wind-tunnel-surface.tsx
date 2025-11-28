"use client";

import { useEffect, useMemo, useState } from "react";

import { DesignCompareSurface, MechanismSurface } from "@/components/simulation-extensions";
import { handleHorizontalTabKey } from "@/components/tab-keyboard";
import { sweepTierPrice } from "@/lib/engine/economics";
import type {
  EconomicsReadout,
  ExpandedOffer,
  PriceSweepPoint,
  SegmentEconomicsReadout,
  TierPriceSweep,
} from "@/lib/engine/types";
import { activeDesign } from "@/lib/state/design-editing";
import { priceSweepInputForDesign, simulateScenarioDesign } from "@/lib/state/scenario-economics";
import { useScenarioStore } from "@/lib/state/scenario-store";

const DOT_COUNT = 20;
const EPSILON = 1e-12;

type ChartMode = "chart" | "table";
type SimulationView = "overview" | "mechanism" | "compare";
const simulationViews = ["overview", "mechanism", "compare"] as const;

const dotColors = ["#0072b2", "#009e73", "#d55e00", "#cc79a7", "#e69f00", "#56b4e9"];
const waterfallColors = ["#0072b2", "#009e73", "#e69f00", "#d55e00", "#cc79a7"];
const currencyFormatters = new Map<string, Intl.NumberFormat>();
const compactCurrencyFormatters = new Map<string, Intl.NumberFormat>();
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const countFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatCurrency(value: number, currency: string, maximumFractionDigits = 0) {
  const key = `${currency}:${maximumFractionDigits}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter.format(value);
}

function formatPercent(value: number) {
  return percentFormatter.format(value);
}

function formatCount(value: number) {
  return countFormatter.format(value);
}

function shortCurrency(value: number, currency: string) {
  let formatter = compactCurrencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    });
    compactCurrencyFormatters.set(currency, formatter);
  }
  return formatter.format(value);
}

function offerSort(left: ExpandedOffer, right: ExpandedOffer) {
  if (left.owner === "outside") return -1;
  if (right.owner === "outside") return 1;
  return left.effectivePrice - right.effectivePrice || left.name.localeCompare(right.name);
}

interface ChoiceRow {
  offer: ExpandedOffer;
  share: number;
  buyers: number;
  color: string;
}

function choiceRows(segment: SegmentEconomicsReadout): ChoiceRow[] {
  const offers = [...segment.selection.offers]
    .filter((offer) => (segment.selection.shares[offer.id] ?? 0) > EPSILON)
    .sort(offerSort);

  return offers.map((offer, index) => {
    const share = segment.selection.shares[offer.id] ?? 0;
    const color =
      offer.owner === "outside"
        ? "#78847d"
        : offer.owner === "competitor"
          ? "#8a2f3d"
          : dotColors[index % dotColors.length];
    return {
      offer,
      share,
      buyers: segment.prospectCount * share,
      color,
    };
  });
}

function ChartToggle({
  mode,
  onChange,
  noun,
}: {
  mode: ChartMode;
  onChange: (mode: ChartMode) => void;
  noun: string;
}) {
  const isTable = mode === "table";
  return (
    <button
      aria-pressed={isTable}
      className="min-h-9 rounded-lg border border-line bg-canvas px-3 text-xs font-semibold text-ink hover:border-accent"
      onClick={() => onChange(isTable ? "chart" : "table")}
      type="button"
    >
      {isTable ? `Show ${noun} chart` : `View ${noun} as table`}
    </button>
  );
}

function KpiHeader({ readout, currency }: { readout: EconomicsReadout; currency: string }) {
  const metrics = [
    { label: "MRR", value: formatCurrency(readout.mrr, currency) },
    { label: "Paid conversion", value: formatPercent(readout.paidConversion) },
    { label: "ARPA", value: formatCurrency(readout.arpa, currency) },
    { label: "Capture rate", value: formatPercent(readout.captureRate) },
    {
      label: "Competitor loss",
      value:
        readout.competitorLossShare === undefined
          ? "No competitors active"
          : formatPercent(readout.competitorLossShare),
    },
  ];

  return (
    <section
      aria-label="Live simulation KPIs"
      className="rounded-2xl bg-accent-soft px-5 py-5 text-ink"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase">
            Live wind-tunnel result
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">What this menu implies</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-muted">
          Deterministic buyer sorting from the active assumptions and offer menu.
        </p>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((metric) => (
          <div className="border-t border-line pt-3" key={metric.label}>
            <dt className="text-xs font-medium text-muted">{metric.label}</dt>
            <dd className="mt-1 text-lg font-semibold tracking-[-0.02em] tabular-nums">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BuyerDots({
  readout,
  segmentNames,
  currency,
}: {
  readout: EconomicsReadout;
  segmentNames: ReadonlyMap<string, string>;
  currency: string;
}) {
  const [mode, setMode] = useState<ChartMode>("chart");
  const rowsBySegment = useMemo(
    () => readout.segments.map((segment) => ({ segment, rows: choiceRows(segment) })),
    [readout],
  );

  return (
    <section
      aria-labelledby="buyer-sort-title"
      className="rounded-2xl border border-line bg-canvas p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Buyer sorting
          </p>
          <h2
            className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink"
            id="buyer-sort-title"
          >
            See where buyer demand lands
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Each row is a segment. Every dot stands for an equal slice of its prospects and moves as
            the utility-maximising choice changes.
          </p>
        </div>
        <ChartToggle mode={mode} noun="buyer selection" onChange={setMode} />
      </div>

      {mode === "table" ? (
        <div className="mt-5 overflow-x-auto">
          <table
            className="w-full min-w-[38rem] border-collapse text-left text-sm"
            aria-label="Buyer selection table"
          >
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Segment</th>
                <th className="px-3 py-2 font-semibold">Choice</th>
                <th className="px-3 py-2 text-right font-semibold">Share</th>
                <th className="px-3 py-2 text-right font-semibold">Buyers</th>
                <th className="px-3 py-2 text-right font-semibold">Account price</th>
              </tr>
            </thead>
            <tbody>
              {rowsBySegment.flatMap(({ segment, rows }) =>
                rows.map((row) => (
                  <tr className="border-b border-line/70" key={`${segment.id}:${row.offer.id}`}>
                    <td className="px-3 py-3 font-medium text-ink">
                      {segmentNames.get(segment.id) ?? segment.id}
                    </td>
                    <td className="px-3 py-3 text-ink">{row.offer.name}</td>
                    <td
                      className="px-3 py-3 text-right tabular-nums text-ink"
                      data-testid={`buyer-selection-share-${segment.id}-${row.offer.id}`}
                    >
                      {formatPercent(row.share)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">
                      {formatCount(row.buyers)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">
                      {formatCurrency(row.offer.effectivePrice, currency)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-2" data-testid="buyer-dot-panel">
          {rowsBySegment.map(({ segment, rows }) => {
            const totalDots = rows.reduce((sum, row) => sum + row.share, 0);
            let cumulative = 0;
            const dots = Array.from({ length: DOT_COUNT }, (_, index) => {
              const quantile = (index + 0.5) / DOT_COUNT;
              const row =
                rows.find((candidate) => {
                  cumulative += candidate.share / Math.max(totalDots, EPSILON);
                  return quantile <= cumulative + EPSILON;
                }) ?? rows[rows.length - 1];
              cumulative = 0;
              const column = rows.findIndex((candidate) => candidate.offer.id === row.offer.id);
              const inColumn = Math.round(
                rows
                  .slice(0, column)
                  .reduce((sum, candidate) => sum + candidate.share * DOT_COUNT, 0),
              );
              const positionInColumn = Math.max(0, index - inColumn);
              const columns = Math.max(rows.length, 1);
              const x = 7 + (column / columns) * 86 + ((positionInColumn % 4) * 4.2 + 1.5);
              const y = 17 + Math.floor(positionInColumn / 4) * 12;
              return {
                id: `${segment.id}:${index}`,
                color: row.color,
                x,
                y,
                offer: row.offer.name,
              };
            });

            return (
              <figure
                className="rounded-xl border border-line bg-canvas-raised p-4"
                key={segment.id}
              >
                <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {segmentNames.get(segment.id) ?? segment.id}
                  </span>
                  <span className="text-xs text-muted">
                    {formatCount(segment.prospectCount)} prospects
                  </span>
                </figcaption>
                <svg
                  aria-label={`${segmentNames.get(segment.id) ?? segment.id} buyer sorting`}
                  className="mt-3 h-24 w-full overflow-visible"
                  role="img"
                  viewBox="0 0 100 82"
                >
                  {rows.map((row, index) => {
                    const columns = Math.max(rows.length, 1);
                    const x = 7 + (index / columns) * 86;
                    return (
                      <g key={row.offer.id}>
                        <line
                          stroke="var(--line)"
                          strokeDasharray="2 3"
                          x1={x}
                          x2={x}
                          y1="9"
                          y2="72"
                        />
                        <text fill="var(--muted)" fontSize="5" textAnchor="start" x={x} y="6">
                          {row.offer.name.length > 14
                            ? `${row.offer.name.slice(0, 13)}…`
                            : row.offer.name}
                        </text>
                      </g>
                    );
                  })}
                  {dots.map((dot) => (
                    <circle
                      className="transition-[cx,cy,opacity] duration-500 ease-out motion-reduce:transition-none"
                      cx={dot.x}
                      cy={dot.y}
                      data-testid="buyer-dot"
                      fill={dot.color}
                      key={dot.id}
                      r="2.6"
                      stroke="var(--canvas-raised)"
                      strokeWidth="1"
                    />
                  ))}
                </svg>
                <ul className="mt-1 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-muted">
                  {rows.map((row) => (
                    <li className="inline-flex items-center gap-1" key={row.offer.id}>
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.offer.name}:{" "}
                      <span data-testid={`buyer-selection-share-${segment.id}-${row.offer.id}`}>
                        {formatPercent(row.share)}
                      </span>
                    </li>
                  ))}
                </ul>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ValueWaterfall({ readout, currency }: { readout: EconomicsReadout; currency: string }) {
  const [mode, setMode] = useState<ChartMode>("chart");
  const terms = [
    { label: "Revenue", value: readout.revenue },
    { label: "Buyer surplus", value: readout.ownBuyerSurplus },
    { label: "Value held behind fences", value: readout.fencingGap },
    { label: "Unserved value", value: readout.unserved },
    { label: "Competitor loss", value: readout.competitorLoss },
  ];
  const visibleTerms = terms.filter(
    (term) => term.value > EPSILON || term.label !== "Competitor loss",
  );
  const total = Math.max(readout.potential, EPSILON);
  let offset = 0;

  return (
    <section
      aria-labelledby="waterfall-title"
      className="rounded-2xl border border-line bg-canvas p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Value accounting
          </p>
          <h2
            className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink"
            id="waterfall-title"
          >
            Potential value, reconciled
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Every dollar of catalog potential is assigned to revenue, buyer surplus, withholding,
            non-conversion, or an included competitor.
          </p>
        </div>
        <ChartToggle mode={mode} noun="value waterfall" onChange={setMode} />
      </div>

      {mode === "table" ? (
        <div className="mt-5 overflow-x-auto">
          <table
            className="w-full min-w-[28rem] border-collapse text-left text-sm"
            aria-label="Value waterfall table"
          >
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Potential allocation</th>
                <th className="px-3 py-2 text-right font-semibold">Monthly value</th>
                <th className="px-3 py-2 text-right font-semibold">Share of potential</th>
              </tr>
            </thead>
            <tbody>
              {visibleTerms.map((term) => (
                <tr className="border-b border-line/70" key={term.label}>
                  <td className="px-3 py-3 text-ink">{term.label}</td>
                  <td
                    className="px-3 py-3 text-right tabular-nums text-ink"
                    data-testid={`waterfall-value-${term.label}`}
                  >
                    {formatCurrency(term.value, currency)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink">
                    {formatPercent(term.value / total)}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold text-ink">
                <td className="px-3 py-3">Total potential</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatCurrency(readout.potential, currency)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">100.0%</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <figure className="mt-6" data-testid="value-waterfall">
          <svg
            aria-label={`Value waterfall with ${formatCurrency(readout.potential, currency)} in total potential`}
            className="h-44 w-full"
            role="img"
            viewBox="0 0 100 82"
          >
            <rect fill="var(--canvas-raised)" height="24" rx="3" width="94" x="3" y="24" />
            {visibleTerms.map((term, index) => {
              const width = (term.value / total) * 94;
              const x = 3 + offset;
              offset += width;
              return (
                <g key={term.label}>
                  <rect
                    fill={waterfallColors[index % waterfallColors.length]}
                    height="24"
                    rx={index === 0 || index === visibleTerms.length - 1 ? 2 : 0}
                    width={Math.max(width, 0)}
                    x={x}
                    y="24"
                  />
                  {width > 11 ? (
                    <text
                      fill="white"
                      fontSize="4.6"
                      fontWeight="600"
                      textAnchor="middle"
                      x={x + width / 2}
                      y="38.5"
                    >
                      {formatPercent(term.value / total)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <text fill="var(--muted)" fontSize="5" x="3" y="16">
              Total potential · {shortCurrency(readout.potential, currency)} / month
            </text>
          </svg>
          <figcaption className="grid gap-x-4 gap-y-2 text-xs text-muted sm:grid-cols-2 lg:grid-cols-3">
            {visibleTerms.map((term, index) => (
              <span className="inline-flex items-center justify-between gap-2" key={term.label}>
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: waterfallColors[index % waterfallColors.length] }}
                  />
                  {term.label}
                </span>
                <span
                  className="tabular-nums text-ink"
                  data-testid={`waterfall-value-${term.label}`}
                >
                  {formatCurrency(term.value, currency)}
                </span>
              </span>
            ))}
          </figcaption>
        </figure>
      )}
    </section>
  );
}

function findCurrentPoint(sweep: TierPriceSweep) {
  return sweep.points.find((point) => point.price === sweep.currentPrice) ?? sweep.bestPoint;
}

function sweepPath(points: readonly PriceSweepPoint[], maxPrice: number, maxRevenue: number) {
  return points
    .map((point) => {
      const x = 5 + (point.price / Math.max(maxPrice, EPSILON)) * 90;
      const y = 70 - (point.revenue / Math.max(maxRevenue, EPSILON)) * 55;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function PriceSweepPanel({
  sweep,
  tierName,
  currency,
}: {
  sweep: TierPriceSweep;
  tierName: string;
  currency: string;
}) {
  const [mode, setMode] = useState<ChartMode>("chart");
  const current = findCurrentPoint(sweep);
  const maxRevenue = Math.max(...sweep.points.map((point) => point.revenue), EPSILON);
  const currentX = 5 + (sweep.currentPrice / Math.max(sweep.searchedUpperBound, EPSILON)) * 90;
  const bestX = 5 + (sweep.bestPoint.price / Math.max(sweep.searchedUpperBound, EPSILON)) * 90;
  const bestY = 70 - (sweep.bestPoint.revenue / maxRevenue) * 55;

  return (
    <section
      aria-labelledby="price-sweep-title"
      className="rounded-2xl border border-line bg-canvas p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Price sweep
          </p>
          <h2
            className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink"
            id="price-sweep-title"
          >
            {tierName} residual demand
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            The rest of the menu stays fixed while this tier&apos;s list price moves. Composite
            add-on choices move with their parent tier.
          </p>
        </div>
        <ChartToggle mode={mode} noun="price sweep" onChange={setMode} />
      </div>

      {mode === "table" ? (
        <div className="mt-5 max-h-[32rem] overflow-auto">
          <table
            className="w-full min-w-[38rem] border-collapse text-left text-sm"
            aria-label={`${tierName} price sweep table`}
          >
            <thead className="sticky top-0 border-b border-line bg-canvas text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">List price</th>
                <th className="px-3 py-2 text-right font-semibold">Tier demand</th>
                <th className="px-3 py-2 text-right font-semibold">Tier MRR</th>
                <th className="px-3 py-2 text-right font-semibold">Total MRR</th>
              </tr>
            </thead>
            <tbody>
              {sweep.points.map((point) => (
                <tr className="border-b border-line/70" key={point.price}>
                  <td className="px-3 py-2.5 tabular-nums text-ink">
                    {formatCurrency(point.price, currency)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                    {formatCount(point.demand)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                    {formatCurrency(point.revenue, currency)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                    {formatCurrency(point.totalMrr, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <figure className="mt-5" data-testid="price-sweep-chart">
            <svg
              aria-label={`${tierName} price sweep. Current price ${formatCurrency(sweep.currentPrice, currency)}; best tier revenue in the searched range at ${formatCurrency(sweep.bestPoint.price, currency)}.`}
              className="h-60 w-full"
              role="img"
              viewBox="0 0 100 82"
            >
              <line stroke="var(--line)" strokeWidth="0.7" x1="5" x2="95" y1="70" y2="70" />
              <line stroke="var(--line)" strokeWidth="0.7" x1="5" x2="5" y1="15" y2="70" />
              <polyline
                fill="none"
                points={sweepPath(sweep.points, sweep.searchedUpperBound, maxRevenue)}
                stroke="var(--accent)"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
              <line
                stroke="var(--amber)"
                strokeDasharray="2 2"
                strokeWidth="0.8"
                x1={currentX}
                x2={currentX}
                y1="15"
                y2="70"
              />
              <circle
                cx={bestX}
                cy={bestY}
                fill="var(--accent-strong)"
                r="2.5"
                stroke="var(--canvas)"
                strokeWidth="1"
              />
              <text fill="var(--muted)" fontSize="4.6" x="5" y="78">
                {formatCurrency(0, currency)}
              </text>
              <text fill="var(--muted)" fontSize="4.6" textAnchor="end" x="95" y="78">
                {formatCurrency(sweep.searchedUpperBound, currency)}
              </text>
              <text fill="var(--muted)" fontSize="4.6" x="7" y="14">
                Tier MRR · max {shortCurrency(maxRevenue, currency)}
              </text>
            </svg>
          </figure>
          <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-accent-soft px-3 py-3">
              <dt className="text-xs font-medium text-muted">Current tier MRR</dt>
              <dd className="mt-1 font-semibold tabular-nums text-ink">
                {formatCurrency(current.revenue, currency)}
              </dd>
            </div>
            <div className="rounded-xl border border-line bg-canvas-raised px-3 py-3">
              <dt className="text-xs font-medium text-muted">Best searched price</dt>
              <dd className="mt-1 font-semibold tabular-nums text-ink">
                {formatCurrency(sweep.bestPoint.price, currency)}
              </dd>
            </div>
            <div className="rounded-xl border border-line bg-canvas-raised px-3 py-3">
              <dt className="text-xs font-medium text-muted">Best tier MRR</dt>
              <dd className="mt-1 font-semibold tabular-nums text-ink">
                {formatCurrency(sweep.bestPoint.revenue, currency)}
              </dd>
            </div>
          </dl>
          {sweep.bestInSearchedRange ? (
            <p className="mt-3 rounded-lg bg-amber-soft px-3 py-2 text-xs leading-5 text-amber">
              Revenue was still improving at {formatCurrency(sweep.searchedUpperBound, currency)}.
              This is the best point in the searched range, not a claimed optimum.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function PriceSweepLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Calculating price sweep"
      className="rounded-2xl border border-line bg-canvas p-5"
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">Price sweep</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
        Calculating residual demand
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        The 400-point price sweep is running after the live outcome update.
      </p>
    </section>
  );
}

function EmptySimulation() {
  return (
    <section className="grid min-h-[28rem] place-items-center px-6 py-14 text-center sm:px-12">
      <div className="max-w-xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Run the wind tunnel
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
          Give buyers something to choose.
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-base leading-7 text-muted">
          Add a buyer segment and at least one tier in Model and Design, or start from one of the
          worked template scenarios. The reveal updates directly from those assumptions.
        </p>
      </div>
    </section>
  );
}

export function WindTunnelSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const design = activeDesign(scenario);
  const [view, setView] = useState<SimulationView>("overview");
  const [sweptTierId, setSweptTierId] = useState(design.tiers[0]?.id ?? "");
  const readout = useMemo(() => simulateScenarioDesign(scenario, design), [scenario, design]);
  const selectedTierId = design.tiers.some((tier) => tier.id === sweptTierId)
    ? sweptTierId
    : (design.tiers[0]?.id ?? "");
  const sweepInput = useMemo(
    () => priceSweepInputForDesign(scenario, design, selectedTierId),
    [scenario, design, selectedTierId],
  );
  const [sweepResult, setSweepResult] = useState<{
    input: typeof sweepInput;
    value: TierPriceSweep;
  } | null>(null);
  const sweep = sweepResult?.input === sweepInput ? sweepResult.value : null;
  const segmentNames = useMemo(
    () => new Map(scenario.model.segments.map((segment) => [segment.id, segment.name])),
    [scenario.model.segments],
  );
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!sweepInput) return;
    const timer = window.setTimeout(() => {
      setSweepResult({ input: sweepInput, value: sweepTierPrice(sweepInput) });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [sweepInput]);

  useEffect(() => {
    if (!readout) return;
    const timer = window.setTimeout(() => {
      setAnnouncement(
        `Simulation updated. MRR ${formatCurrency(readout.mrr, scenario.settings.currency)}, paid conversion ${formatPercent(readout.paidConversion)}, capture rate ${formatPercent(readout.captureRate)}.`,
      );
    }, 220);
    return () => window.clearTimeout(timer);
  }, [readout, scenario.settings.currency]);

  if (!readout || design.tiers.length === 0) return <EmptySimulation />;

  const sweepTier = design.tiers.find((tier) => tier.id === selectedTierId);

  return (
    <section aria-labelledby="simulate-title" className="w-full px-5 py-7 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
            Run the wind tunnel
          </p>
          <h1
            className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
            id="simulate-title"
          >
            Reveal the menu&apos;s economic consequences
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted">
            Buyers choose the option with the highest modeled utility. This view turns that sorting
            into demand, value accounting, and a price-by-price readout.
          </p>
        </div>
        <span className="rounded-full bg-accent-soft px-3 py-2 text-xs font-semibold tracking-[0.08em] text-accent uppercase">
          Active design · {design.name}
        </span>
      </div>

      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>

      <nav aria-label="Simulation workbenches" className="mt-6 border-b border-line">
        <div className="flex gap-2 overflow-x-auto" role="tablist">
          {(
            [
              ["overview", "Core reveal"],
              ["mechanism", "Mechanism"],
              ["compare", "Compare designs"],
            ] as const
          ).map(([id, label]) => {
            const selected = view === id;
            return (
              <button
                aria-controls="simulation-view"
                aria-selected={selected}
                className={`min-w-max rounded-t-lg px-4 py-2 text-sm font-semibold ${
                  selected ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink"
                }`}
                id={`simulation-${id}-tab`}
                key={id}
                onClick={() => setView(id)}
                onKeyDown={(event) =>
                  handleHorizontalTabKey(
                    event,
                    simulationViews,
                    view,
                    setView,
                    (candidate) => `simulation-${candidate}-tab`,
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
        aria-labelledby={`simulation-${view}-tab`}
        className="mt-7"
        id="simulation-view"
        role="tabpanel"
      >
        {view === "overview" ? (
          <div className="space-y-6">
            <KpiHeader currency={scenario.settings.currency} readout={readout} />
            <BuyerDots
              currency={scenario.settings.currency}
              readout={readout}
              segmentNames={segmentNames}
            />
            <ValueWaterfall currency={scenario.settings.currency} readout={readout} />
            <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-line bg-canvas-raised p-4">
              <div>
                <p className="text-sm font-semibold text-ink">
                  Inspect each tier&apos;s price response
                </p>
                <p className="mt-1 text-sm text-muted">
                  Every tier has its own 400-point residual-demand sweep.
                </p>
              </div>
              <label className="text-sm font-medium text-ink">
                Tier to sweep
                <select
                  aria-label="Tier to sweep"
                  className="ml-2 min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm text-ink"
                  onChange={(event) => setSweptTierId(event.target.value)}
                  value={selectedTierId}
                >
                  {design.tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {sweep ? (
              <PriceSweepPanel
                currency={scenario.settings.currency}
                sweep={sweep}
                tierName={sweepTier?.name ?? "Selected tier"}
              />
            ) : (
              <PriceSweepLoading />
            )}
          </div>
        ) : view === "mechanism" ? (
          <MechanismSurface scenario={scenario} />
        ) : (
          <DesignCompareSurface scenario={scenario} />
        )}
      </div>
    </section>
  );
}
