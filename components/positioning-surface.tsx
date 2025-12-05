"use client";

import { useMemo, useState } from "react";

import { GlossaryPopover } from "@/components/glossary-popover";
import { useScenarioStore } from "@/lib/state/scenario-store";
import {
  addCompetitor,
  applyCompetitorValueSurvey,
  canAddCompetitor,
  parseCompetitorValueSurvey,
  positioningMapForSegment,
  removeCompetitor,
  renameCompetitor,
  setCompetitorOverallValue,
  setCompetitorPrice,
  setCompetitorPriceMetric,
  setCompetitorValueForSegment,
  summarizeCompetitorValueSurvey,
} from "@/lib/state/positioning";
import { simulateScenarioDesign } from "@/lib/state/scenario-economics";
import { activeDesign } from "@/lib/state/design-editing";
import type { PriceMetric } from "@/lib/engine/types";

type ChartMode = "chart" | "table";

const currencyFormatters = new Map<string, Intl.NumberFormat>();
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

function formatCurrency(value: number, currency: string, digits = 0) {
  const key = `${currency}:${digits}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: digits,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter.format(value);
}

function formatPercent(value: number) {
  return percentFormatter.format(value);
}

function CompetitorValueSurvey({
  competitorName,
  segments,
  currency,
  onApply,
}: {
  competitorName: string;
  segments: readonly { id: string; name: string }[];
  currency: string;
  onApply: (segmentId: string, values: number[]) => void;
}) {
  const [raw, setRaw] = useState("");
  const [targetSegmentId, setTargetSegmentId] = useState<string>(segments[0]?.id ?? "");
  const segmentId = segments.some((segment) => segment.id === targetSegmentId)
    ? targetSegmentId
    : (segments[0]?.id ?? "");

  const parsed = useMemo(() => parseCompetitorValueSurvey(raw), [raw]);
  const summary = useMemo(() => summarizeCompetitorValueSurvey(parsed.values), [parsed.values]);
  const rejected = parsed.rejected;

  return (
    <details className="mt-3 rounded-lg border border-line bg-canvas p-3">
      <summary className="cursor-pointer text-xs font-semibold tracking-[0.1em] text-muted uppercase">
        Survey shortcut
      </summary>
      <p className="mt-2 text-xs leading-5 text-muted">
        Paste each respondent&apos;s stated account-month value for {competitorName} (comma, space,
        or newline separated). The median fills the selected segment&apos;s value — a faster way to
        set the per-segment cell above.
      </p>
      <label className="mt-2 block text-xs font-medium text-ink">
        Stated values
        <textarea
          aria-label={`Survey responses for ${competitorName}`}
          className="mt-1 block h-16 w-full rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink"
          onChange={(event) => setRaw(event.target.value)}
          placeholder="120, 150, 90, 200"
          value={raw}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-ink">
          Apply to
          <select
            aria-label={`Segment to apply the ${competitorName} survey to`}
            className="mt-1 block rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink"
            onChange={(event) => setTargetSegmentId(event.target.value)}
            value={segmentId}
          >
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="min-h-9 rounded-lg border border-line bg-canvas-raised px-3 text-xs font-semibold text-ink hover:border-accent disabled:opacity-60"
          disabled={summary === null || !segmentId}
          onClick={() => {
            if (summary === null || !segmentId) return;
            onApply(segmentId, parsed.values);
            setRaw("");
          }}
          type="button"
        >
          Apply median
        </button>
      </div>
      <p aria-live="polite" className="mt-2 text-xs text-muted">
        {summary === null
          ? "Enter at least one non-negative number."
          : `${summary.used} response${summary.used === 1 ? "" : "s"} · median ${formatCurrency(
              summary.value,
              currency,
            )}`}
        {rejected > 0 ? ` · ${rejected} ignored` : ""}
      </p>
    </details>
  );
}

export function PositioningSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const currency = scenario.settings.currency;
  const segments = scenario.model.segments;
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>(segments[0]?.id ?? "");
  const [mapMode, setMapMode] = useState<ChartMode>("chart");

  const segmentId = segments.some((segment) => segment.id === selectedSegmentId)
    ? selectedSegmentId
    : (segments[0]?.id ?? "");

  const positioning = useMemo(
    () => (segmentId ? positioningMapForSegment(scenario, segmentId) : null),
    [scenario, segmentId],
  );

  const design = useMemo(
    () => (scenario.designs.length > 0 ? activeDesign(scenario) : null),
    [scenario],
  );
  const simulation = useMemo(
    () => (design ? simulateScenarioDesign(scenario, design) : null),
    [scenario, design],
  );

  const competitorShareBySegment = useMemo(() => {
    if (!simulation) return new Map<string, number>();
    return new Map(
      simulation.segments.map((segment) => {
        const competitorShare = segment.selection.offers
          .filter((offer) => offer.owner === "competitor")
          .reduce((total, offer) => total + (segment.selection.shares[offer.id] ?? 0), 0);
        return [segment.id, competitorShare];
      }),
    );
  }, [simulation]);

  const handleAddCompetitor = () => {
    updateScenario((current) => addCompetitor(current, "New competitor"));
  };

  const noSegments = segments.length === 0;

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto p-6 sm:p-10">
      <header className="rounded-2xl border border-line bg-canvas-raised p-5">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Positioning workbench
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">
          Competitor alternatives and the segment-scoped map
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Enter each competitor&apos;s account-month price and per-segment value. The map is scoped
          to the selected segment; the discrete Pareto frontier and direct-dominance verdict are the
          honest trade-off signals — no interpolated market offer is invented.
        </p>
      </header>

      {noSegments ? (
        <div className="rounded-2xl border border-dashed border-line bg-canvas-raised p-6 text-sm leading-6 text-muted">
          Positioning needs at least one segment. Add a segment in the Model workbench first.
        </div>
      ) : null}

      <section
        aria-labelledby="positioning-competitors-title"
        className="rounded-2xl border border-line bg-canvas p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3
              className="text-lg font-semibold tracking-[-0.02em] text-ink"
              id="positioning-competitors-title"
            >
              Competitors
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              Each competitor becomes a per-segment offer in the envelope simulator (§4.11), so
              switching risk lives in the same math as tier choice.
            </p>
          </div>
          <button
            className="min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold text-ink hover:border-accent disabled:opacity-60"
            data-testid="positioning-add-competitor"
            disabled={!canAddCompetitor(scenario) || noSegments}
            onClick={handleAddCompetitor}
            type="button"
          >
            Add competitor
          </button>
        </div>

        {scenario.competitors.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No competitors yet. Add one to see its position on the map and its share on the Simulate
            surface.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {scenario.competitors.map((competitor) => (
              <li
                className="rounded-xl border border-line bg-canvas-raised p-4"
                data-testid={`positioning-competitor-card-${competitor.id}`}
                key={competitor.id}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <label className="text-xs font-semibold tracking-[0.1em] text-muted uppercase">
                    <span>Competitor name</span>
                    <input
                      aria-label={`${competitor.name} name`}
                      className="mt-1 block w-full rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink"
                      onChange={(event) =>
                        updateScenario((current) =>
                          renameCompetitor(current, competitor.id, event.target.value),
                        )
                      }
                      type="text"
                      value={competitor.name}
                    />
                  </label>
                  <button
                    className="text-xs font-semibold text-muted hover:text-ink"
                    onClick={() =>
                      updateScenario((current) => removeCompetitor(current, competitor.id))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs font-semibold tracking-[0.1em] text-muted uppercase">
                    <span>Price</span>
                    <input
                      aria-label={`${competitor.name} price`}
                      className="mt-1 block w-full rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink"
                      min={0}
                      onChange={(event) =>
                        updateScenario((current) =>
                          setCompetitorPrice(current, competitor.id, Number(event.target.value)),
                        )
                      }
                      step={1}
                      type="number"
                      value={competitor.price}
                    />
                  </label>
                  <label className="text-xs font-semibold tracking-[0.1em] text-muted uppercase">
                    <span>Metric</span>
                    <select
                      aria-label={`${competitor.name} price metric`}
                      className="mt-1 block w-full rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink"
                      onChange={(event) =>
                        updateScenario((current) =>
                          setCompetitorPriceMetric(
                            current,
                            competitor.id,
                            event.target.value as PriceMetric,
                          ),
                        )
                      }
                      value={competitor.priceMetric}
                    >
                      <option value="flat">flat / account</option>
                      <option value="per-seat">per seat</option>
                    </select>
                  </label>
                </div>
                <div className="mt-3">
                  <p className="text-xs font-semibold tracking-[0.1em] text-muted uppercase">
                    Per-segment account value
                  </p>
                  <button
                    className="mt-2 min-h-9 rounded-lg border border-line bg-canvas px-3 text-xs font-semibold text-ink hover:border-accent"
                    onClick={() => {
                      const entered = prompt(
                        `Apply one value to every segment for ${competitor.name}:`,
                        `${competitor.valueBySegment[segments[0]?.id ?? ""] ?? 0}`,
                      );
                      if (entered === null || entered.trim() === "") return;
                      const overall = Number(entered);
                      if (!Number.isFinite(overall) || overall < 0) return;
                      updateScenario((current) =>
                        setCompetitorOverallValue(current, competitor.id, overall),
                      );
                    }}
                    type="button"
                  >
                    Apply one overall value
                  </button>
                  <ul className="mt-2 grid gap-2">
                    {segments.map((segment) => (
                      <li className="flex items-center gap-2" key={segment.id}>
                        <span className="min-w-[8rem] text-xs text-muted">{segment.name}</span>
                        <input
                          aria-label={`${competitor.name} value for ${segment.name}`}
                          className="w-24 rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink"
                          min={0}
                          onChange={(event) =>
                            updateScenario((current) =>
                              setCompetitorValueForSegment(
                                current,
                                competitor.id,
                                segment.id,
                                Number(event.target.value),
                              ),
                            )
                          }
                          step={1}
                          type="number"
                          value={competitor.valueBySegment[segment.id] ?? 0}
                        />
                      </li>
                    ))}
                  </ul>
                  <CompetitorValueSurvey
                    competitorName={competitor.name}
                    currency={currency}
                    onApply={(segmentId, values) =>
                      updateScenario((current) =>
                        applyCompetitorValueSurvey(current, competitor.id, segmentId, values),
                      )
                    }
                    segments={segments}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {segments.length > 0 ? (
        <section
          aria-labelledby="positioning-map-title"
          className="rounded-2xl border border-line bg-canvas p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3
                className="text-lg font-semibold tracking-[-0.02em] text-ink"
                id="positioning-map-title"
              >
                Segment-scoped positioning map
              </h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                Value on X, account-month price on Y. Rays are the segment&apos;s ε at P10/P50/P90.
                <GlossaryPopover term="isoUtilityRay" />
                Competitor points are the Pareto staircase — no line is a purchasable offer.
              </p>
            </div>
            <label className="text-xs font-semibold tracking-[0.1em] text-muted uppercase">
              <span>Segment</span>
              <select
                aria-label="Segment for positioning map"
                className="mt-1 block rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink"
                data-testid="positioning-segment-selector"
                onChange={(event) => setSelectedSegmentId(event.target.value)}
                value={segmentId}
              >
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3">
            <button
              aria-pressed={mapMode === "table"}
              className="min-h-9 rounded-lg border border-line bg-canvas px-3 text-xs font-semibold text-ink hover:border-accent"
              onClick={() => setMapMode(mapMode === "table" ? "chart" : "table")}
              type="button"
            >
              {mapMode === "table" ? "Show positioning chart" : "View positioning as table"}
            </button>
          </div>

          {positioning ? (
            <PositioningView
              currency={currency}
              mode={mapMode}
              positioning={positioning}
              segmentName={
                segments.find((segment) => segment.id === positioning.segmentId)?.name ?? ""
              }
            />
          ) : null}
          {positioning && scenario.competitors.length > positioning.frontier.length ? (
            <p
              className="mt-3 rounded-lg bg-amber-soft px-3 py-2 text-xs leading-5 text-amber"
              data-testid="positioning-dominated-note"
            >
              {`${scenario.competitors.length - positioning.frontier.length} competitor(s) are not on this segment's Pareto frontier (dominated or duplicated) and are not plotted: ${scenario.competitors
                .filter(
                  (competitor) => !positioning.frontier.some((point) => point.id === competitor.id),
                )
                .map((competitor) => competitor.name)
                .join(", ")}. They still compete in the simulation.`}
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        aria-labelledby="positioning-share-title"
        className="rounded-2xl border border-line bg-canvas p-5"
      >
        <h3
          className="text-lg font-semibold tracking-[-0.02em] text-ink"
          id="positioning-share-title"
        >
          Per-segment competitor share
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Live from the simulator on the active design (§4.3): the mass leaving your menu for a
          competitor in each segment. Zero everywhere means competitors do not currently beat any
          tier on the envelope.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {segments.map((segment) => {
            const competitorShare = competitorShareBySegment.get(segment.id) ?? 0;
            return (
              <li
                className="rounded-xl border border-line bg-canvas-raised p-3"
                data-testid={`positioning-share-${segment.id}`}
                key={segment.id}
              >
                <p className="text-sm font-semibold text-ink">{segment.name}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {formatPercent(competitorShare)}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      {simulation?.competitorLossShare !== undefined ? (
        <section
          aria-labelledby="positioning-loss-title"
          className="rounded-2xl border border-line bg-canvas p-5"
          data-testid="positioning-loss-summary"
        >
          <h3
            className="text-lg font-semibold tracking-[-0.02em] text-ink"
            id="positioning-loss-title"
          >
            Scenario competitor-loss share
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Total competitor loss divided by catalog potential — appears only when at least one
            competitor is active in the simulator.
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
            {formatPercent(simulation.competitorLossShare)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Absolute loss: {formatCurrency(simulation.competitorLoss, currency)} / month.
          </p>
        </section>
      ) : null}
    </section>
  );
}

function PositioningView({
  positioning,
  segmentName,
  mode,
  currency,
}: {
  positioning: ReturnType<typeof positioningMapForSegment>;
  segmentName: string;
  mode: ChartMode;
  currency: string;
}) {
  if (!positioning) return null;
  if (mode === "table") {
    return (
      <div className="mt-4 overflow-x-auto">
        <table
          className="w-full min-w-[36rem] border-collapse text-left text-sm"
          aria-label={`Positioning table for ${segmentName}`}
        >
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Marker</th>
              <th className="px-3 py-2 text-right font-semibold">Value</th>
              <th className="px-3 py-2 text-right font-semibold">Account price</th>
              <th className="px-3 py-2 font-semibold">Frontier</th>
              <th className="px-3 py-2 font-semibold">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {positioning.tiers.map((tier) => {
              const verdict = positioning.dominance.find((entry) => entry.tierId === tier.id);
              return (
                <tr
                  className="border-b border-line/70"
                  data-testid={`positioning-tier-row-${tier.id}`}
                  key={`tier-${tier.id}`}
                >
                  <td className="px-3 py-2 font-medium text-ink">Tier: {tier.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {formatCurrency(tier.value, currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {formatCurrency(tier.effectivePrice, currency)}
                  </td>
                  <td className="px-3 py-2 text-ink">—</td>
                  <td className="px-3 py-2 text-ink">
                    {verdict?.verdict === "directly-dominated"
                      ? `Dominated by ${verdict.dominatingCompetitorId}`
                      : "Not directly dominated"}
                  </td>
                </tr>
              );
            })}
            {positioning.frontier.map((competitor) => (
              <tr className="border-b border-line/70" key={`competitor-${competitor.id}`}>
                <td className="px-3 py-2 font-medium text-ink">Competitor: {competitor.name}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {formatCurrency(competitor.value, currency)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {formatCurrency(competitor.effectivePrice, currency)}
                </td>
                <td className="px-3 py-2 text-ink">Pareto-efficient</td>
                <td className="px-3 py-2 text-ink">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <PositioningChart currency={currency} positioning={positioning} segmentName={segmentName} />
  );
}

function PositioningChart({
  positioning,
  segmentName,
  currency,
}: {
  positioning: NonNullable<ReturnType<typeof positioningMapForSegment>>;
  segmentName: string;
  currency: string;
}) {
  const allValues = [
    ...positioning.tiers.map((tier) => tier.value),
    ...positioning.frontier.map((competitor) => competitor.value),
  ];
  const allPrices = [
    ...positioning.tiers.map((tier) => tier.effectivePrice),
    ...positioning.frontier.map((competitor) => competitor.effectivePrice),
  ];
  const maxValue = Math.max(1, ...allValues) * 1.1;
  const maxPrice = Math.max(1, ...allPrices) * 1.1;
  const width = 720;
  const height = 360;
  const left = 60;
  const right = 24;
  const top = 24;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (value: number) => left + (value / maxValue) * plotWidth;
  const y = (price: number) => top + plotHeight - (price / maxPrice) * plotHeight;

  return (
    <figure className="mt-4 overflow-x-auto" data-testid="positioning-chart">
      <svg
        aria-label={`Positioning map for ${segmentName}`}
        className="min-w-[43rem]"
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        <rect fill="var(--canvas-raised)" height={plotHeight} width={plotWidth} x={left} y={top} />
        {/* axis lines */}
        <line stroke="var(--line)" x1={left} x2={left} y1={top} y2={top + plotHeight} />
        <line
          stroke="var(--line)"
          x1={left}
          x2={left + plotWidth}
          y1={top + plotHeight}
          y2={top + plotHeight}
        />
        {/* break-even rays */}
        {positioning.rays.map((ray) => {
          // P = ray.slope × V. Clip end to the plot rect.
          const endValueAtPriceMax = ray.slope > 0 ? maxPrice / ray.slope : maxValue;
          const endValue = Math.min(maxValue, endValueAtPriceMax);
          const endPrice = ray.slope * endValue;
          return (
            <g key={ray.label}>
              <line
                stroke="var(--accent)"
                strokeDasharray={ray.label === "p50" ? undefined : "5 5"}
                strokeOpacity={ray.label === "p50" ? "0.9" : "0.55"}
                strokeWidth={ray.label === "p50" ? 2 : 1.4}
                x1={x(0)}
                x2={x(endValue)}
                y1={y(0)}
                y2={y(endPrice)}
              />
              <text
                fill="var(--accent-strong)"
                fontSize="10"
                textAnchor="start"
                x={x(endValue) - 22}
                y={y(endPrice) - 4}
              >
                {ray.label.toUpperCase()}
              </text>
            </g>
          );
        })}
        {/* frontier polyline */}
        {positioning.frontier.length > 1 ? (
          <polyline
            fill="none"
            points={positioning.frontier
              .flatMap((point, index, frontier) => {
                const previous = frontier[index - 1];
                const corner = previous
                  ? [`${x(previous.value).toFixed(2)},${y(point.effectivePrice).toFixed(2)}`]
                  : [];
                return [
                  ...corner,
                  `${x(point.value).toFixed(2)},${y(point.effectivePrice).toFixed(2)}`,
                ];
              })
              .join(" ")}
            stroke="var(--muted)"
            strokeDasharray="6 4"
            strokeWidth={1.5}
          />
        ) : null}
        {/* competitor points */}
        {positioning.frontier.map((competitor) => (
          <g key={`competitor-${competitor.id}`}>
            <rect
              data-testid={`positioning-competitor-marker-${competitor.id}`}
              fill="var(--muted)"
              height={10}
              width={10}
              x={x(competitor.value) - 5}
              y={y(competitor.effectivePrice) - 5}
            />
            <text
              fill="var(--ink)"
              fontSize="11"
              fontWeight="600"
              x={x(competitor.value) + 8}
              y={y(competitor.effectivePrice) + 4}
            >
              {competitor.name}
            </text>
          </g>
        ))}
        {/* tier dots */}
        {positioning.tiers.map((tier) => {
          const verdict = positioning.dominance.find((entry) => entry.tierId === tier.id);
          const dominated = verdict?.verdict === "directly-dominated";
          return (
            <g key={`tier-${tier.id}`}>
              <circle
                cx={x(tier.value)}
                cy={y(tier.effectivePrice)}
                data-testid={`positioning-tier-marker-${tier.id}`}
                fill={dominated ? "#d55e00" : "var(--accent)"}
                r={7}
                stroke="var(--canvas)"
                strokeWidth={2}
              />
              <text
                fill="var(--ink)"
                fontSize="11"
                fontWeight="600"
                x={x(tier.value) + 10}
                y={y(tier.effectivePrice) + 4}
              >
                {tier.name}
              </text>
            </g>
          );
        })}
        {/* axis labels */}
        <text fill="var(--muted)" fontSize="11" x={left} y={height - 16}>
          Value (account-month)
        </text>
        <text
          fill="var(--muted)"
          fontSize="11"
          textAnchor="end"
          x={left + plotWidth}
          y={height - 16}
        >
          Up to {formatCurrency(maxValue, currency)}
        </text>
        <text
          fill="var(--muted)"
          fontSize="11"
          transform={`rotate(-90 ${left - 40} ${top + plotHeight / 2})`}
          x={left - 40}
          y={top + plotHeight / 2}
        >
          Account-month price
        </text>
      </svg>
      <figcaption className="mt-3 text-xs text-muted">
        Rays at slope ε (P10/P50/P90). Dashed staircase joins Pareto points visually — no offer lies
        between them.
      </figcaption>
    </figure>
  );
}
