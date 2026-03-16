"use client";

import { activeDesign } from "@/lib/state/design-editing";
import { useScenarioStore } from "@/lib/state/scenario-store";
import type { Scenario } from "@/lib/state/schemas";

type Offer = Scenario["designs"][number]["tiers"][number];

function UsageLines({ offer, kind }: { offer: Offer; kind: "tier" | "addOn" }) {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const metrics = scenario.model.usageMetrics;
  const lines = offer.usagePricing ?? [];
  const packs = offer.creditPacks ?? [];
  const patchOffer = (next: Offer) =>
    updateScenario((current) => {
      const design = activeDesign(current);
      const replace = <T extends Offer>(entries: readonly T[]) =>
        entries.map((entry) => (entry.id === offer.id ? (next as T) : entry));
      return {
        ...current,
        designs: current.designs.map((candidate) =>
          candidate.id !== design.id
            ? candidate
            : {
                ...candidate,
                [kind === "tier" ? "tiers" : "addOns"]: replace(
                  kind === "tier" ? candidate.tiers : candidate.addOns,
                ),
              },
        ),
      };
    });
  return (
    <article className="rounded-xl border border-line bg-canvas p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">{offer.name}</h3>
          <p className="text-xs text-muted">
            Base price remains {offer.price}; usage is an expected monthly surcharge by segment.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="min-h-9 rounded-lg border border-line bg-canvas-raised px-3 text-xs font-semibold text-ink hover:border-accent disabled:opacity-60"
            disabled={metrics.length === 0 || lines.length >= 3}
            onClick={() => {
              const metric = metrics.find(
                (candidate) => !lines.some((line) => line.metricId === candidate.id),
              );
              if (metric)
                patchOffer({
                  ...offer,
                  usagePricing: [
                    ...lines,
                    { metricId: metric.id, perUnitPrice: 0, includedUnits: 0 },
                  ],
                });
            }}
            type="button"
          >
            Add usage line
          </button>
          <button
            className="min-h-9 rounded-lg border border-line bg-canvas-raised px-3 text-xs font-semibold text-ink hover:border-accent disabled:opacity-60"
            disabled={metrics.length === 0 || packs.length >= 3}
            onClick={() => {
              const metric = metrics.find(
                (candidate) => !packs.some((entry) => entry.metricId === candidate.id),
              );
              if (metric)
                patchOffer({
                  ...offer,
                  creditPacks: [...packs, { metricId: metric.id, packUnits: 1, packPrice: 0 }],
                });
            }}
            type="button"
          >
            Add credit pack
          </button>
        </div>
      </div>
      {metrics.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Define a metric in Model before attaching usage pricing.
        </p>
      ) : null}
      {lines.length > 0 ? (
        <div className="mt-3 grid gap-3">
          {lines.map((line, index) => (
            <div
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto] sm:items-end"
              key={`${line.metricId}-${index}`}
            >
              <label className="text-xs text-muted">
                Metric
                <select
                  aria-label={`${offer.name} usage metric`}
                  className="mt-1 block min-h-9 w-full rounded-md border border-line bg-canvas-raised px-2 text-ink"
                  onChange={(event) =>
                    patchOffer({
                      ...offer,
                      usagePricing: lines.map((entry, current) =>
                        current === index ? { ...entry, metricId: event.target.value } : entry,
                      ),
                    })
                  }
                  value={line.metricId}
                >
                  {metrics.map((metric) => (
                    <option key={metric.id} value={metric.id}>
                      {metric.name} ({metric.unitLabel})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted">
                Per unit
                <input
                  aria-label={`${offer.name} per unit price`}
                  className="mt-1 block min-h-9 w-full rounded-md border border-line bg-canvas-raised px-2 text-ink"
                  min="0"
                  onChange={(event) =>
                    patchOffer({
                      ...offer,
                      usagePricing: lines.map((entry, current) =>
                        current === index
                          ? { ...entry, perUnitPrice: Number(event.target.value) }
                          : entry,
                      ),
                    })
                  }
                  step="any"
                  type="number"
                  value={line.perUnitPrice}
                />
              </label>
              <label className="text-xs text-muted">
                Included units
                <input
                  aria-label={`${offer.name} included units`}
                  className="mt-1 block min-h-9 w-full rounded-md border border-line bg-canvas-raised px-2 text-ink"
                  min="0"
                  onChange={(event) =>
                    patchOffer({
                      ...offer,
                      usagePricing: lines.map((entry, current) =>
                        current === index
                          ? { ...entry, includedUnits: Number(event.target.value) }
                          : entry,
                      ),
                    })
                  }
                  step="any"
                  type="number"
                  value={line.includedUnits ?? 0}
                />
              </label>
              <button
                className="min-h-9 rounded-md border border-line bg-canvas-raised px-2 text-xs font-semibold text-muted hover:border-amber hover:text-amber"
                onClick={() =>
                  patchOffer({
                    ...offer,
                    usagePricing: lines.filter((_, current) => current !== index),
                  })
                }
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {packs.length > 0 ? (
        <div className="mt-4 grid gap-3 border-t border-line pt-4">
          <p className="text-xs text-muted">
            A prepaid pack is bought up front. Units the segment does not spend become breakage —
            revenue with nothing delivered behind it — unless the pack rolls over.
          </p>
          {packs.map((pack, index) => {
            const patchPack = (patch: Partial<(typeof packs)[number]>) =>
              patchOffer({
                ...offer,
                creditPacks: packs.map((entry, current) =>
                  current === index ? { ...entry, ...patch } : entry,
                ),
              });
            return (
              <div
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_auto] sm:items-end"
                key={`${pack.metricId}-${index}`}
              >
                <label className="text-xs text-muted">
                  Pack metric
                  <select
                    aria-label={`${offer.name} credit pack metric`}
                    className="mt-1 block min-h-9 w-full rounded-md border border-line bg-canvas-raised px-2 text-ink"
                    onChange={(event) => patchPack({ metricId: event.target.value })}
                    value={pack.metricId}
                  >
                    {metrics.map((metric) => (
                      <option key={metric.id} value={metric.id}>
                        {metric.name} ({metric.unitLabel})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Pack units
                  <input
                    aria-label={`${offer.name} pack units`}
                    className="mt-1 block min-h-9 w-full rounded-md border border-line bg-canvas-raised px-2 text-ink"
                    min="0"
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      // The engine refuses a zero-unit pack; stop the edit before it persists.
                      if (Number.isFinite(value) && value > 0) patchPack({ packUnits: value });
                    }}
                    step="any"
                    type="number"
                    value={pack.packUnits}
                  />
                </label>
                <label className="text-xs text-muted">
                  Pack price
                  <input
                    aria-label={`${offer.name} pack price`}
                    className="mt-1 block min-h-9 w-full rounded-md border border-line bg-canvas-raised px-2 text-ink"
                    min="0"
                    onChange={(event) => patchPack({ packPrice: Number(event.target.value) })}
                    step="any"
                    type="number"
                    value={pack.packPrice}
                  />
                </label>
                <label className="text-xs text-muted">
                  Overage/unit
                  <input
                    aria-label={`${offer.name} pack overage rate`}
                    className="mt-1 block min-h-9 w-full rounded-md border border-line bg-canvas-raised px-2 text-ink"
                    min="0"
                    onChange={(event) => patchPack({ overagePerUnit: Number(event.target.value) })}
                    step="any"
                    type="number"
                    value={pack.overagePerUnit ?? 0}
                  />
                </label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      aria-label={`${offer.name} pack expires at period end`}
                      checked={pack.expiresAtPeriodEnd ?? true}
                      className="size-4 rounded border-line"
                      onChange={(event) => patchPack({ expiresAtPeriodEnd: event.target.checked })}
                      type="checkbox"
                    />
                    Expires
                  </label>
                  <button
                    className="min-h-9 rounded-md border border-line bg-canvas-raised px-2 text-xs font-semibold text-muted hover:border-amber hover:text-amber"
                    onClick={() =>
                      patchOffer({
                        ...offer,
                        creditPacks: packs.filter((_, current) => current !== index),
                      })
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

export function UsagePricingEditor() {
  const scenario = useScenarioStore((state) => state.scenario);
  const design = activeDesign(scenario);
  return (
    <section
      className="rounded-2xl border border-line bg-canvas-raised p-5"
      data-tour="design-usage-pricing"
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Metered offers
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
        Attach a rate to a tier or add-on
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        For each segment, expected P50 usage above the included allowance becomes an explicit
        surcharge in the buyer-choice engine. A prepaid credit pack adds its own expected bill — the
        pack price plus expected overage — and the unused balance is priced as breakage.
      </p>
      <div className="mt-4 grid gap-3">
        {design.tiers.map((tier) => (
          <UsageLines key={tier.id} kind="tier" offer={tier} />
        ))}
        {design.addOns.map((addOn) => (
          <UsageLines key={addOn.id} kind="addOn" offer={addOn} />
        ))}
      </div>
    </section>
  );
}
