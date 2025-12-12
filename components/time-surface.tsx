"use client";

import { useMemo, useState } from "react";

import { activeDesign } from "@/lib/state/design-editing";
import { formatCount, formatMoney } from "@/lib/state/formatting";
import { simulateScenarioDesign } from "@/lib/state/scenario-economics";
import { useScenarioStore } from "@/lib/state/scenario-store";
import { projectScenarioTimeDynamics } from "@/lib/state/time-dynamics";

export function TimeSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const [periods, setPeriods] = useState(12);
  const design = activeDesign(scenario);
  const economics = useMemo(() => simulateScenarioDesign(scenario, design), [design, scenario]);
  const readout = useMemo(
    () => projectScenarioTimeDynamics(scenario, economics, periods),
    [economics, periods, scenario],
  );
  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto p-6 sm:p-10"
      data-tour="analyze-time"
    >
      <header className="rounded-2xl border border-line bg-canvas-raised p-5">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Time analysis
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">
          Trials, conversion, and retention over time
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          A deterministic projection from the current buyer-choice readout. Trials delay revenue,
          conversion gates entry to the paid cohort, and annual contracts retain on renewal months
          while revenue stays monthly.
        </p>
      </header>
      {scenario.model.segments.length === 0 || !readout ? (
        <div className="rounded-2xl border border-dashed border-line bg-canvas-raised p-6 text-sm text-muted">
          Add segments and a tier to project the time path.
        </div>
      ) : (
        <>
          <label className="max-w-sm text-sm font-medium text-ink">
            Projection horizon: {periods} months
            <input
              aria-label="Projection horizon months"
              className="mt-2 block w-full accent-[var(--accent)]"
              max="36"
              min="0"
              onChange={(event) => setPeriods(Number(event.target.value))}
              type="range"
              value={periods}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-line bg-canvas p-4">
              <p className="text-xs text-muted">Cumulative modeled revenue</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
                {formatMoney(
                  readout.cumulativeRevenue,
                  scenario.settings.currency,
                  scenario.settings.locale,
                )}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-canvas p-4">
              <p className="text-xs text-muted">Period {periods} MRR</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
                {formatMoney(
                  readout.points.at(-1)?.mrr ?? 0,
                  scenario.settings.currency,
                  scenario.settings.locale,
                )}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-canvas p-4">
              <p className="text-xs text-muted">Period {periods} active buyers</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
                {formatCount(readout.points.at(-1)?.activeBuyers ?? 0, scenario.settings.locale)}
              </p>
            </div>
          </div>
          <section className="overflow-x-auto rounded-2xl border border-line bg-canvas p-5">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <caption className="mb-3 text-left text-lg font-semibold text-ink">
                Monthly projection
              </caption>
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2 text-right">MRR</th>
                  <th className="px-3 py-2 text-right">Active buyers</th>
                </tr>
              </thead>
              <tbody>
                {readout.points.map((point) => (
                  <tr className="border-b border-line/70" key={point.period}>
                    <th className="px-3 py-2 font-medium text-ink" scope="row">
                      {point.period}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {formatMoney(point.mrr, scenario.settings.currency, scenario.settings.locale)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {formatCount(point.activeBuyers, scenario.settings.locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </section>
  );
}
