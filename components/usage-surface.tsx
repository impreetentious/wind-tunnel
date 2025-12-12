"use client";

import { useMemo, useState } from "react";

import { summarizeUsageCost } from "@/lib/engine/usage";
import { activeDesign } from "@/lib/state/design-editing";
import { formatCount, formatMoney } from "@/lib/state/formatting";
import { useScenarioStore } from "@/lib/state/scenario-store";

export function UsageSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const [segmentId, setSegmentId] = useState(scenario.model.segments[0]?.id ?? "");
  const segment =
    scenario.model.segments.find((entry) => entry.id === segmentId) ?? scenario.model.segments[0];
  const design = activeDesign(scenario);
  const rows = useMemo(() => {
    if (!segment) return [];
    return [...design.tiers, ...design.addOns].map((offer) => ({
      id: offer.id,
      name: offer.name,
      base: offer.price,
      surcharge: summarizeUsageCost({
        usagePricing: offer.usagePricing,
        usageBands: segment.usageBands ?? {},
      }),
      lines: offer.usagePricing ?? [],
    }));
  }, [design.addOns, design.tiers, segment]);
  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto p-6 sm:p-10"
      data-tour="analyze-usage"
    >
      <header className="rounded-2xl border border-line bg-canvas-raised p-5">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Usage analysis
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">
          Expected metered bill by segment
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          This is the P50 usage approximation used by the choice engine. It makes the price a buyer
          sees explicit: base list price plus consumption above each included allowance.
        </p>
      </header>
      {scenario.model.usageMetrics.length === 0 || !segment ? (
        <div className="rounded-2xl border border-dashed border-line bg-canvas-raised p-6 text-sm leading-6 text-muted">
          Add a usage metric, segment bands, and a metered tier or add-on in Model and Design to see
          a usage readout.
        </div>
      ) : (
        <>
          <label className="max-w-sm text-sm font-medium text-ink">
            Segment
            <select
              aria-label="Usage readout segment"
              className="mt-2 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-ink"
              onChange={(event) => setSegmentId(event.target.value)}
              value={segment.id}
            >
              {scenario.model.segments.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <section className="rounded-2xl border border-line bg-canvas p-5">
            <h3 className="text-lg font-semibold text-ink">
              {segment.name} consumption assumptions
            </h3>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {scenario.model.usageMetrics.map((metric) => (
                <div className="rounded-xl border border-line bg-canvas-raised p-3" key={metric.id}>
                  <dt className="text-xs font-medium text-muted">{metric.name}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                    {formatCount(
                      segment.usageBands?.[metric.id]?.p50 ?? 0,
                      scenario.settings.locale,
                    )}{" "}
                    <span className="text-xs font-normal text-muted">
                      {metric.unitLabel}/mo P50
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="overflow-x-auto rounded-2xl border border-line bg-canvas p-5">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <caption className="mb-3 text-left text-lg font-semibold text-ink">
                Effective monthly price
              </caption>
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Offer</th>
                  <th className="px-3 py-2 text-right">Base</th>
                  <th className="px-3 py-2 text-right">Usage surcharge</th>
                  <th className="px-3 py-2 text-right">Expected effective price</th>
                  <th className="px-3 py-2">Metering lines</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className="border-b border-line/70" key={row.id}>
                    <th className="px-3 py-3 font-medium text-ink" scope="row">
                      {row.name}
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">
                      {formatMoney(row.base, scenario.settings.currency, scenario.settings.locale)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">
                      {formatMoney(
                        row.surcharge,
                        scenario.settings.currency,
                        scenario.settings.locale,
                        { maximumFractionDigits: 2 },
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                      {formatMoney(
                        row.base + row.surcharge,
                        scenario.settings.currency,
                        scenario.settings.locale,
                        { maximumFractionDigits: 2 },
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted">
                      {row.lines.length === 0
                        ? "No usage line"
                        : row.lines
                            .map(
                              (line) =>
                                `${scenario.model.usageMetrics.find((metric) => metric.id === line.metricId)?.name ?? line.metricId}: ${formatMoney(line.perUnitPrice, scenario.settings.currency, scenario.settings.locale, { maximumFractionDigits: 4 })}/unit after ${formatCount(line.includedUnits ?? 0, scenario.settings.locale)}`,
                            )
                            .join(" · ")}
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
