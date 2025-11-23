"use client";

import { useMemo, useState } from "react";

import {
  analyzeVanWestendorp,
  type VanWestendorpCurvePoint,
  type VanWestendorpPoint,
} from "@/lib/engine/vanwest";
import {
  createIllustrativeVanWestendorpStudy,
  parseVanWestendorpCsv,
  scenarioWithVanWestendorpStudy,
  VAN_WESTENDORP_DEMO_CSV,
  vanWestendorpCsv,
} from "@/lib/state/vanwest";
import { useScenarioStore } from "@/lib/state/scenario-store";

type ChartMode = "chart" | "table";

const rawCurves = [
  { key: "tooCheap", label: "Too cheap", color: "#0072b2" },
  { key: "cheap", label: "Cheap", color: "#009e73" },
  { key: "expensive", label: "Expensive", color: "#d55e00" },
  { key: "tooExpensive", label: "Too expensive", color: "#cc79a7" },
] as const;

function formatCurrency(value: number, currency: string, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(
    value,
  );
}

function MarkerCard({ point, currency }: { point: VanWestendorpPoint; currency: string }) {
  const shortName = point.id.toUpperCase();
  return (
    <article className="rounded-xl border border-line bg-canvas-raised p-4">
      <p className="text-xs font-semibold tracking-[0.12em] text-accent uppercase">{shortName}</p>
      <h3 className="mt-1 text-sm font-semibold text-ink">{point.label}</h3>
      <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-ink">
        {point.price === undefined
          ? "Undefined for this data"
          : formatCurrency(point.price, currency)}
      </p>
    </article>
  );
}

function CurvesChart({
  curves,
  acceptableRange,
  points,
  currency,
}: {
  curves: readonly VanWestendorpCurvePoint[];
  acceptableRange: { low: number; high: number } | undefined;
  points: Readonly<Record<string, VanWestendorpPoint>>;
  currency: string;
}) {
  if (curves.length < 2) {
    return (
      <div className="mt-5 rounded-xl border border-dashed border-line bg-canvas-raised p-5 text-sm leading-6 text-muted">
        At least two distinct response prices are needed to draw the cumulative curves. The crossing
        markers remain explicitly undefined rather than estimated.
      </div>
    );
  }

  const minimum = curves[0].price;
  const maximum = curves.at(-1)?.price ?? minimum;
  const width = 720;
  const height = 292;
  const left = 54;
  const right = 18;
  const top = 22;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (price: number) => left + ((price - minimum) / (maximum - minimum)) * plotWidth;
  const y = (share: number) => top + (1 - share) * plotHeight;
  const path = (key: (typeof rawCurves)[number]["key"]) =>
    curves
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.price)} ${y(point[key])}`)
      .join(" ");

  return (
    <figure className="mt-5 overflow-x-auto" data-testid="van-westendorp-chart">
      <svg
        aria-label="Van Westendorp cumulative response curves"
        className="min-w-[43rem]"
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        {acceptableRange ? (
          <rect
            fill="var(--accent-soft)"
            height={plotHeight}
            opacity="0.75"
            width={x(acceptableRange.high) - x(acceptableRange.low)}
            x={x(acceptableRange.low)}
            y={top}
          />
        ) : null}
        {[0, 0.25, 0.5, 0.75, 1].map((share) => (
          <g key={share}>
            <line
              stroke="var(--line)"
              strokeDasharray={share === 0 || share === 1 ? undefined : "3 4"}
              x1={left}
              x2={width - right}
              y1={y(share)}
              y2={y(share)}
            />
            <text fill="var(--muted)" fontSize="11" textAnchor="end" x={left - 8} y={y(share) + 4}>
              {formatPercent(share)}
            </text>
          </g>
        ))}
        {rawCurves.map((curve) => (
          <path
            d={path(curve.key)}
            fill="none"
            key={curve.key}
            stroke={curve.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
          />
        ))}
        {Object.values(points).map((point, index) => {
          if (point.price === undefined || point.price < minimum || point.price > maximum) {
            return null;
          }
          const markerX = x(point.price);
          return (
            <g key={point.id}>
              <line
                stroke="var(--ink)"
                strokeDasharray="4 4"
                strokeOpacity="0.55"
                x1={markerX}
                x2={markerX}
                y1={top}
                y2={height - bottom}
              />
              <text
                fill="var(--ink)"
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
                x={markerX}
                y={top + 12 + (index % 2) * 13}
              >
                {point.id.toUpperCase()}
              </text>
            </g>
          );
        })}
        <line
          stroke="var(--line)"
          x1={left}
          x2={width - right}
          y1={height - bottom}
          y2={height - bottom}
        />
        <text fill="var(--muted)" fontSize="11" textAnchor="start" x={left} y={height - 18}>
          {formatCurrency(minimum, currency)}
        </text>
        <text fill="var(--muted)" fontSize="11" textAnchor="end" x={width - right} y={height - 18}>
          {formatCurrency(maximum, currency)}
        </text>
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
        {rawCurves.map((curve) => (
          <span className="inline-flex items-center gap-2" key={curve.key}>
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: curve.color }}
            />
            {curve.label}
          </span>
        ))}
        {acceptableRange ? <span>Shaded: acceptable range [PMC, PME].</span> : null}
      </figcaption>
    </figure>
  );
}

function CurvesTable({
  curves,
  currency,
}: {
  curves: readonly VanWestendorpCurvePoint[];
  currency: string;
}) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table
        className="w-full min-w-[48rem] border-collapse text-left text-sm"
        aria-label="Van Westendorp cumulative curves table"
      >
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Price</th>
            <th className="px-3 py-2 text-right font-semibold">Too cheap</th>
            <th className="px-3 py-2 text-right font-semibold">Cheap</th>
            <th className="px-3 py-2 text-right font-semibold">Expensive</th>
            <th className="px-3 py-2 text-right font-semibold">Too expensive</th>
            <th className="px-3 py-2 text-right font-semibold">Not cheap</th>
            <th className="px-3 py-2 text-right font-semibold">Not expensive</th>
          </tr>
        </thead>
        <tbody>
          {curves.map((curve) => (
            <tr className="border-b border-line/70" key={curve.price}>
              <td className="px-3 py-3 font-medium tabular-nums text-ink">
                {formatCurrency(curve.price, currency)}
              </td>
              {[
                curve.tooCheap,
                curve.cheap,
                curve.expensive,
                curve.tooExpensive,
                curve.notCheap,
                curve.notExpensive,
              ].map((share, index) => (
                <td className="px-3 py-3 text-right tabular-nums text-ink" key={index}>
                  {formatPercent(share)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VanWestendorpSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const [csv, setCsv] = useState(() => {
    const study = scenario.research.vanWestendorp;
    return study?.source === "survey" ? vanWestendorpCsv(study.responses) : "";
  });
  const [csvErrors, setCsvErrors] = useState<readonly { line: number; message: string }[]>([]);
  const [chartMode, setChartMode] = useState<ChartMode>("chart");
  const study = scenario.research.vanWestendorp;
  const result = useMemo(
    () => (study ? analyzeVanWestendorp(study.responses) : undefined),
    [study],
  );

  const saveSurveyCsv = () => {
    const parsed = parseVanWestendorpCsv(csv);
    setCsvErrors(parsed.errors);
    if (parsed.errors.length > 0) return;
    if (parsed.responses.length === 0) {
      setCsvErrors([{ line: 1, message: "Paste at least one respondent price quadruple." }]);
      return;
    }
    updateScenario((current) =>
      scenarioWithVanWestendorpStudy(current, {
        source: "survey",
        responses: [...parsed.responses],
      }),
    );
  };

  const toggleIllustrative = (enabled: boolean) => {
    if (enabled) {
      const illustrative = createIllustrativeVanWestendorpStudy(scenario);
      if (illustrative.responses.length === 0) {
        setCsvErrors([
          { line: 1, message: "Add a buyer segment before generating an illustrative study." },
        ]);
        return;
      }
      setCsvErrors([]);
      updateScenario((current) =>
        scenarioWithVanWestendorpStudy(current, createIllustrativeVanWestendorpStudy(current)),
      );
      return;
    }

    const parsed = parseVanWestendorpCsv(csv);
    if (parsed.errors.length === 0 && parsed.responses.length > 0) {
      setCsvErrors([]);
      updateScenario((current) =>
        scenarioWithVanWestendorpStudy(current, {
          source: "survey",
          responses: [...parsed.responses],
        }),
      );
    } else {
      setCsvErrors(
        parsed.errors.length > 0
          ? parsed.errors
          : [{ line: 1, message: "Paste fielded responses before leaving illustrative mode." }],
      );
    }
  };

  const isIllustrative = study?.source === "illustrative";

  return (
    <section
      aria-labelledby="van-westendorp-title"
      className="w-full overflow-y-auto px-6 py-8 sm:px-10"
    >
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Analyze · Research
        </p>
        <h1
          id="van-westendorp-title"
          className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
        >
          Measure price perception with fielded responses
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-muted">
          Van Westendorp’s Price Sensitivity Meter turns four price prompts per respondent into
          inspectable cumulative curves. It informs a pricing discussion; it does not replace the
          buyer model or claim an objectively correct price.
        </p>

        <section className="mt-8 rounded-2xl border border-line bg-canvas p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
                Survey input
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
                Paste four prices per respondent
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                CSV or tab-separated input accepts a header in any column order: too cheap, cheap,
                expensive, too expensive. Rows that break that order are shown and excluded rather
                than silently repaired.
              </p>
            </div>
            <label className="inline-flex min-h-10 items-center gap-3 rounded-lg border border-amber bg-amber-soft px-3 text-sm font-semibold text-ink">
              <input
                aria-label="Use illustrative model-generated responses — simulated, not evidence"
                checked={isIllustrative}
                className="h-4 w-4 accent-[var(--accent)]"
                onChange={(event) => toggleIllustrative(event.target.checked)}
                type="checkbox"
              />
              <span>Illustrative mode</span>
            </label>
          </div>

          <label className="mt-5 block text-sm font-medium text-ink">
            Van Westendorp survey CSV
            <textarea
              className="mt-2 min-h-44 w-full rounded-xl border border-line bg-canvas-raised p-3 font-mono text-xs leading-5 text-ink"
              disabled={isIllustrative}
              onChange={(event) => setCsv(event.target.value)}
              placeholder={VAN_WESTENDORP_DEMO_CSV}
              spellCheck={false}
              value={csv}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isIllustrative}
              onClick={saveSurveyCsv}
              type="button"
            >
              Analyze pasted responses
            </button>
            <button
              className="min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isIllustrative}
              onClick={() => {
                setCsv(VAN_WESTENDORP_DEMO_CSV);
                setCsvErrors([]);
              }}
              type="button"
            >
              Load demo CSV
            </button>
          </div>
          {csvErrors.length > 0 ? (
            <div
              className="mt-4 rounded-xl border border-amber bg-amber-soft p-4 text-sm text-ink"
              role="alert"
            >
              <p className="font-semibold">The pasted study needs attention.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {csvErrors.map((error) => (
                  <li key={`${error.line}-${error.message}`}>
                    Line {error.line}: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {isIllustrative ? (
          <section
            className="mt-6 rounded-2xl border border-amber bg-amber-soft p-5"
            aria-label="Illustrative-mode disclosure"
          >
            <p className="text-xs font-semibold tracking-[0.14em] text-amber uppercase">
              Simulated — not evidence
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink">
              This teaching dataset is deterministically generated from each segment’s P50 account
              WTP: four scale positions (78%, 90%, 100%, 112%) feed the four prompts at 30%, 55%,
              105%, and 145% of that scaled value. It is for intuition only and must not be treated
              as a respondent survey or used to validate a pricing decision.
            </p>
          </section>
        ) : null}

        {result ? (
          <div className="mt-8 space-y-6">
            <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
              Van Westendorp analysis updated with {result.validResponses.length} usable responses
              and {result.violations.length} excluded responses.
            </p>
            <section className="rounded-2xl border border-line bg-canvas p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
                    Validation report
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
                    Check the evidence before reading the points
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2 text-sm font-semibold">
                  <span className="rounded-full bg-accent-soft px-3 py-2 text-accent-strong">
                    {result.validResponses.length} usable
                  </span>
                  <span className="rounded-full bg-amber-soft px-3 py-2 text-amber">
                    {result.violations.length} excluded
                  </span>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">
                A valid row follows too cheap ≤ cheap ≤ expensive ≤ too expensive. Excluded rows
                never affect the curves or crossing points.
              </p>
              {result.violations.length > 0 ? (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
                  {result.violations.map((violation) => (
                    <li key={violation.index}>
                      Respondent row {violation.index + 1}: {violation.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="rounded-2xl border border-line bg-canvas p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
                    Cumulative curves
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
                    What respondents called too cheap or too expensive
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                    Too cheap and cheap descend; expensive and too expensive ascend. PMC and PME use
                    the complementary not-cheap and not-expensive curves under the stated PSM
                    convention.
                  </p>
                </div>
                <button
                  aria-pressed={chartMode === "table"}
                  className="min-h-9 rounded-lg border border-line bg-canvas-raised px-3 text-xs font-semibold text-ink hover:border-accent"
                  onClick={() => setChartMode((mode) => (mode === "chart" ? "table" : "chart"))}
                  type="button"
                >
                  {chartMode === "chart" ? "View curves as table" : "Show curves chart"}
                </button>
              </div>
              {chartMode === "chart" ? (
                <CurvesChart
                  acceptableRange={result.acceptableRange}
                  currency={scenario.settings.currency}
                  curves={result.curves}
                  points={result.points}
                />
              ) : (
                <CurvesTable currency={scenario.settings.currency} curves={result.curves} />
              )}
            </section>

            <section className="rounded-2xl border border-line bg-canvas p-5">
              <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
                Interpolated crossings
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
                Read points as reported, not invented
              </h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Object.values(result.points).map((point) => (
                  <MarkerCard currency={scenario.settings.currency} key={point.id} point={point} />
                ))}
              </div>
              <p className="mt-5 text-sm leading-6 text-muted">
                {result.acceptableRange
                  ? `Acceptable range: ${formatCurrency(result.acceptableRange.low, scenario.settings.currency)}–${formatCurrency(result.acceptableRange.high, scenario.settings.currency)}.`
                  : "Acceptable range: undefined for this data because PMC and PME do not form an ordered pair."}
              </p>
            </section>
          </div>
        ) : (
          <section className="mt-8 rounded-2xl border border-dashed border-line bg-canvas p-6">
            <h2 className="text-lg font-semibold text-ink">No PSM study loaded yet</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Paste fielded responses and analyze them, or turn on the clearly labeled illustrative
              mode to explore how the method is constructed.
            </p>
          </section>
        )}
      </div>
    </section>
  );
}
