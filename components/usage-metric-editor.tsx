"use client";

import { useScenarioStore } from "@/lib/state/scenario-store";

function nextMetricId(ids: readonly string[]): string {
  let index = 1;
  while (ids.includes(`usage-${index}`)) index += 1;
  return `usage-${index}`;
}

export function UsageMetricEditor() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const metrics = scenario.model.usageMetrics;

  return (
    <section
      className="mt-6 rounded-2xl border border-line bg-canvas-raised p-5"
      data-tour="model-usage-metrics"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Usage pricing
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
            Meter what buyers consume
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Define a metric, then set each segment’s P10/P50/P90 monthly consumption. Design uses
            those bands to calculate the expected usage surcharge on every metered tier or add-on.
          </p>
        </div>
        <button
          className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm font-semibold text-ink hover:border-accent disabled:opacity-60"
          disabled={metrics.length >= 4}
          onClick={() =>
            updateScenario((current) => ({
              ...current,
              model: {
                ...current.model,
                usageMetrics: [
                  ...current.model.usageMetrics,
                  {
                    id: nextMetricId(current.model.usageMetrics.map((metric) => metric.id)),
                    name: "New usage metric",
                    unitLabel: "units",
                  },
                ],
              },
            }))
          }
          type="button"
        >
          Add metric
        </button>
      </div>
      {metrics.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No usage metrics yet. Flat and per-seat prices remain unchanged until you add one.
        </p>
      ) : null}
      <div className="mt-5 grid gap-4">
        {metrics.map((metric) => (
          <article className="rounded-xl border border-line bg-canvas p-4" key={metric.id}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,11rem)_auto] sm:items-end">
              <label className="text-xs font-medium text-muted">
                Metric name
                <input
                  aria-label={`${metric.name} metric name`}
                  className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-sm text-ink"
                  maxLength={120}
                  onChange={(event) =>
                    updateScenario((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        usageMetrics: current.model.usageMetrics.map((entry) =>
                          entry.id === metric.id ? { ...entry, name: event.target.value } : entry,
                        ),
                      },
                    }))
                  }
                  value={metric.name}
                />
              </label>
              <label className="text-xs font-medium text-muted">
                Unit label
                <input
                  aria-label={`${metric.name} unit label`}
                  className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-sm text-ink"
                  maxLength={120}
                  onChange={(event) =>
                    updateScenario((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        usageMetrics: current.model.usageMetrics.map((entry) =>
                          entry.id === metric.id
                            ? { ...entry, unitLabel: event.target.value }
                            : entry,
                        ),
                      },
                    }))
                  }
                  value={metric.unitLabel}
                />
              </label>
              <label className="text-xs font-medium text-muted">
                Unit is a
                <select
                  aria-label={`${metric.name} unit kind`}
                  className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-sm text-ink"
                  onChange={(event) =>
                    updateScenario((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        usageMetrics: current.model.usageMetrics.map((entry) =>
                          entry.id === metric.id
                            ? {
                                ...entry,
                                unitKind:
                                  event.target.value === "outcome" ? "outcome" : "consumption",
                              }
                            : entry,
                        ),
                      },
                    }))
                  }
                  value={metric.unitKind ?? "consumption"}
                >
                  <option value="consumption">Consumption</option>
                  <option value="outcome">Outcome</option>
                </select>
              </label>
              <button
                className="min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold text-muted hover:border-amber hover:text-amber"
                onClick={() =>
                  updateScenario((current) => ({
                    ...current,
                    model: {
                      ...current.model,
                      usageMetrics: current.model.usageMetrics.filter(
                        (entry) => entry.id !== metric.id,
                      ),
                      segments: current.model.segments.map((segment) => {
                        const usageBands = { ...(segment.usageBands ?? {}) };
                        delete usageBands[metric.id];
                        return { ...segment, usageBands };
                      }),
                    },
                    designs: current.designs.map((design) => ({
                      ...design,
                      tiers: design.tiers.map((tier) => ({
                        ...tier,
                        usagePricing: tier.usagePricing?.filter(
                          (line) => line.metricId !== metric.id,
                        ),
                        creditPacks: tier.creditPacks?.filter(
                          (pack) => pack.metricId !== metric.id,
                        ),
                      })),
                      addOns: design.addOns.map((addOn) => ({
                        ...addOn,
                        usagePricing: addOn.usagePricing?.filter(
                          (line) => line.metricId !== metric.id,
                        ),
                        creditPacks: addOn.creditPacks?.filter(
                          (pack) => pack.metricId !== metric.id,
                        ),
                      })),
                    })),
                  }))
                }
                type="button"
              >
                Remove
              </button>
            </div>
            {scenario.model.segments.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <caption className="sr-only">Usage bands for {metric.name}</caption>
                  <thead className="border-b border-line text-xs text-muted">
                    <tr>
                      <th className="px-2 py-2">Segment</th>
                      <th className="px-2 py-2">P10</th>
                      <th className="px-2 py-2">P50</th>
                      <th className="px-2 py-2">P90</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenario.model.segments.map((segment) => {
                      const band = segment.usageBands?.[metric.id] ?? { p10: 0, p50: 0, p90: 0 };
                      return (
                        <tr className="border-b border-line/70" key={segment.id}>
                          <th className="px-2 py-2 font-medium text-ink" scope="row">
                            {segment.name}{" "}
                            <span className="font-normal text-muted">({metric.unitLabel}/mo)</span>
                          </th>
                          {(["p10", "p50", "p90"] as const).map((field) => (
                            <td className="px-2 py-2" key={field}>
                              <input
                                aria-label={`${segment.name} ${metric.name} ${field.toUpperCase()}`}
                                className="min-h-9 w-28 rounded-md border border-line bg-canvas-raised px-2 tabular-nums text-ink"
                                min="0"
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  if (!Number.isFinite(value) || value < 0) return;
                                  updateScenario((current) => ({
                                    ...current,
                                    model: {
                                      ...current.model,
                                      segments: current.model.segments.map((entry) =>
                                        entry.id !== segment.id
                                          ? entry
                                          : {
                                              ...entry,
                                              usageBands: {
                                                ...entry.usageBands,
                                                [metric.id]: {
                                                  ...(entry.usageBands?.[metric.id] ?? {
                                                    p10: 0,
                                                    p50: 0,
                                                    p90: 0,
                                                  }),
                                                  [field]: value,
                                                },
                                              },
                                            },
                                      ),
                                    },
                                  }));
                                }}
                                step="any"
                                type="number"
                                value={band[field]}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">
                Add a segment to give this metric a usage band.
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
