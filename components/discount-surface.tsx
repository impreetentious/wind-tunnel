"use client";

import { useMemo } from "react";

import { activeDesign } from "@/lib/state/design-editing";
import { formatMoney, formatPercent } from "@/lib/state/formatting";
import { evaluateScenarioDiscount } from "@/lib/state/scenario-discount";
import { useScenarioStore } from "@/lib/state/scenario-store";
import type { Scenario } from "@/lib/state/schemas";

type Design = Scenario["designs"][number];
type DiscountPolicy = NonNullable<Design["discountPolicies"]>[number];

export function DiscountSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const design = activeDesign(scenario);
  const policies = design.discountPolicies ?? [];
  const paidTiers = design.tiers.filter((tier) => tier.price > 0);
  const readout = useMemo(() => {
    try {
      return evaluateScenarioDiscount(scenario);
    } catch {
      // A half-typed hit rate can briefly exceed what the engine accepts; the schema is the
      // gate that matters, and the readout simply waits for a valid policy.
      return null;
    }
  }, [scenario]);
  const currency = scenario.settings.currency;
  const locale = scenario.settings.locale;
  const money = (value: number) => formatMoney(value, currency, locale);

  const setPolicies = (next: readonly DiscountPolicy[]) =>
    updateScenario((current) => ({
      ...current,
      designs: current.designs.map((candidate) =>
        candidate.id === design.id
          ? { ...candidate, discountPolicies: next.length === 0 ? undefined : [...next] }
          : candidate,
      ),
    }));

  const patchPolicy = (tierId: string, patch: Partial<DiscountPolicy>) =>
    setPolicies(
      policies.some((policy) => policy.tierId === tierId)
        ? policies.map((policy) => (policy.tierId === tierId ? { ...policy, ...patch } : policy))
        : [...policies, { tierId, floorFraction: 0, ...patch }],
    );

  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto p-6 sm:p-10"
      data-tour="analyze-discount"
    >
      <header className="rounded-2xl border border-line bg-canvas-raised p-5">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Discount policy
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">
          The menu you permit, not the menu you designed
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          List price is a ceiling; achieved price is a policy outcome. Deals split into an
          undiscounted cohort and one cohort per permitted floor, and each is run through the same
          choice engine — so the leakage figure counts buyers who change tier as well as buyers who
          simply pay less.
        </p>
      </header>

      {paidTiers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-canvas-raised p-6 text-sm leading-6 text-muted">
          Add a paid tier in Design to set a discount policy on it.
        </div>
      ) : (
        <section className="rounded-2xl border border-line bg-canvas p-5">
          <h3 className="text-lg font-semibold text-ink">Permitted floors</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            The floor is the deepest discount sales may reach. The hit rate is the share of a
            segment&rsquo;s deals expected to get there; across all tiers it cannot exceed 100% of a
            segment&rsquo;s deals.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <caption className="sr-only">Discount floor and hit rate by tier</caption>
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2 text-right">List</th>
                  <th className="px-3 py-2 text-right">Floor %</th>
                  <th className="px-3 py-2 text-right">Floor price</th>
                  {scenario.model.segments.map((segment) => (
                    <th className="px-3 py-2 text-right" key={segment.id}>
                      {segment.name} hit %
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paidTiers.map((tier) => {
                  const policy = policies.find((entry) => entry.tierId === tier.id);
                  const floor = policy?.floorFraction ?? 0;
                  return (
                    <tr className="border-b border-line/70" key={tier.id}>
                      <th className="px-3 py-3 font-medium text-ink" scope="row">
                        {tier.name}
                      </th>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {money(tier.price)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          aria-label={`${tier.name} discount floor percent`}
                          className="min-h-9 w-24 rounded-md border border-line bg-canvas-raised px-2 text-right tabular-nums text-ink"
                          max="100"
                          min="0"
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value) && value >= 0 && value <= 100) {
                              patchPolicy(tier.id, { floorFraction: value / 100 });
                            }
                          }}
                          step="any"
                          type="number"
                          value={Number((floor * 100).toFixed(4))}
                        />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted">
                        {money(tier.price * (1 - floor))}
                      </td>
                      {scenario.model.segments.map((segment) => (
                        <td className="px-3 py-3 text-right" key={segment.id}>
                          <input
                            aria-label={`${tier.name} ${segment.name} discount hit rate percent`}
                            className="min-h-9 w-24 rounded-md border border-line bg-canvas-raised px-2 text-right tabular-nums text-ink"
                            max="100"
                            min="0"
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (!(Number.isFinite(value) && value >= 0 && value <= 100)) return;
                              patchPolicy(tier.id, {
                                hitRateBySegment: {
                                  ...(policy?.hitRateBySegment ?? {}),
                                  [segment.id]: value / 100,
                                },
                              });
                            }}
                            step="any"
                            type="number"
                            value={Number(
                              ((policy?.hitRateBySegment?.[segment.id] ?? 0) * 100).toFixed(4),
                            )}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {policies.length > 0 ? (
            <button
              className="mt-4 min-h-9 rounded-lg border border-line bg-canvas-raised px-3 text-xs font-semibold text-muted hover:border-amber hover:text-amber"
              onClick={() => setPolicies([])}
              type="button"
            >
              Clear the discount policy
            </button>
          ) : null}
        </section>
      )}

      {readout ? (
        <>
          <section className="rounded-2xl border border-line bg-canvas p-5">
            <h3 className="text-lg font-semibold text-ink">Achieved versus list</h3>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["List MRR", money(readout.listMrr)],
                  ["Achieved MRR", money(readout.achievedMrr)],
                  [
                    "Discount leakage",
                    `${money(readout.discountLeakage)} · ${formatPercent(readout.discountLeakageShare, locale)}`,
                  ],
                ] as const
              ).map(([label, value]) => (
                <div className="rounded-xl border border-line bg-canvas-raised p-3" key={label}>
                  <dt className="text-xs font-medium text-muted">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 max-w-3xl text-xs leading-5 text-muted">
              Achieved MRR can exceed list in a segment where a discount pulls buyers up a tier;
              that is the choice model working, not a sign error. Discount leakage is distinct from
              free-tier leakage (E5) and from trial conversion.
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-canvas p-5">
            <h3 className="text-lg font-semibold text-ink">By segment</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <caption className="sr-only">List, achieved, and leakage by segment</caption>
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Segment</th>
                    <th className="px-3 py-2 text-right">Deals discounted</th>
                    <th className="px-3 py-2 text-right">List MRR</th>
                    <th className="px-3 py-2 text-right">Achieved MRR</th>
                    <th className="px-3 py-2 text-right">Leakage</th>
                  </tr>
                </thead>
                <tbody>
                  {readout.segments.map((segment) => (
                    <tr className="border-b border-line/70" key={segment.id}>
                      <th className="px-3 py-3 font-medium text-ink" scope="row">
                        {segment.name}
                      </th>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {formatPercent(segment.discountedShare, locale)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {money(segment.listMrr)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {money(segment.achievedMrr)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                        {money(segment.discountLeakage)} ·{" "}
                        {formatPercent(segment.discountLeakageShare, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-canvas p-5">
            <h3 className="text-lg font-semibold text-ink">Fence erosion</h3>
            {readout.fenceErosions.length === 0 ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                No permitted floor flips a segment&rsquo;s top decile off the tier built for it. The
                screen the menu was designed to build survives the discount policy.
              </p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {readout.fenceErosions.map((erosion) => (
                  <li
                    className="rounded-xl border border-amber/40 bg-amber/5 p-4 text-sm leading-6 text-ink"
                    key={`${erosion.segmentId}-${erosion.discountedTierId}-${erosion.erodedTierId}`}
                  >
                    <span className="font-semibold">
                      {formatPercent(erosion.floorFraction, locale)} off{" "}
                      {erosion.discountedTierName} un-fences {erosion.erodedTierName} for{" "}
                      {erosion.segmentName}.
                    </span>{" "}
                    <span className="text-muted">
                      {erosion.erodedTierName} takes {formatPercent(erosion.shareAtList, locale)} of
                      that segment at list — {money(erosion.mrrAtRisk)} of MRR — and its top decile
                      prefers the discounted {erosion.discountedTierName} once the floor is reached.
                      {erosion.approver ? ` ${erosion.approver} can authorize that depth.` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
