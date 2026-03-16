"use client";

import { useMemo } from "react";

import type { MigrationPolicy } from "@/lib/engine/migration";
import { activeDesign } from "@/lib/state/design-editing";
import { formatCount, formatMoney, formatPercent } from "@/lib/state/formatting";
import { diffDesignPair } from "@/lib/state/scenario-diff";
import { incumbentDesign, simulateScenarioMigration } from "@/lib/state/scenario-migration";
import { useScenarioStore } from "@/lib/state/scenario-store";
import type { Scenario } from "@/lib/state/schemas";

const policyLabels: Record<MigrationPolicy, string> = {
  grandfather: "Grandfather indefinitely",
  "forced-at-renewal": "Forced move at renewal",
  "opt-in-with-deadline": "Opt in before a deadline",
};

const policyNotes: Record<MigrationPolicy, string> = {
  grandfather:
    "The legacy plan stays in every existing account's choice set at its current price. Accounts move up only when the new menu beats it by more than the switching cost.",
  "forced-at-renewal":
    "The legacy plan is withdrawn. Every account re-chooses from the proposed menu, a competitor, or the exit — which is where forced migrations lose people.",
  "opt-in-with-deadline":
    "Mechanically the same choice as grandfathering for a buyer who acts. The difference is inertia, which this model does not put a coefficient on; the readout reports the exposure instead.",
};

function defaultBaseRow(scenario: Scenario, segmentId: string, incumbentTierId: string) {
  return {
    segmentId,
    incumbentTierId,
    // Seeded from the segment's own P50 prospect count so the first readout is alive rather
    // than empty; it is an account count and the user is expected to replace it.
    baseCount: Math.round(
      scenario.model.segments.find((segment) => segment.id === segmentId)?.prospectBand.p50 ?? 0,
    ),
    switchingCost: 0,
  };
}

export function MigrationSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const proposed = activeDesign(scenario);
  const incumbent = incumbentDesign(scenario);
  const readout = useMemo(() => simulateScenarioMigration(scenario), [scenario]);
  const designDiff = useMemo(
    () => (incumbent && incumbent.id !== proposed.id ? diffDesignPair(incumbent, proposed) : []),
    [incumbent, proposed],
  );
  const alternatives = scenario.designs.filter((design) => design.id !== proposed.id);
  const currency = scenario.settings.currency;
  const locale = scenario.settings.locale;
  const money = (value: number) => formatMoney(value, currency, locale);

  const setMigration = (next: Scenario["migration"]) =>
    updateScenario((current) => ({ ...current, migration: next }));

  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto p-6 sm:p-10"
      data-tour="analyze-migration"
    >
      <header className="rounded-2xl border border-line bg-canvas-raised p-5">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Repricing an existing base
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">
          Where the installed base lands
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Everywhere else in this studio the buyers are new. Here they are already yours, already on
          a plan, and already paying something. The legacy plan enters each account&rsquo;s choice
          set as one more alternative in the same envelope — no second engine — with the switching
          cost charged on every move away from it.
        </p>
      </header>

      {alternatives.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-canvas-raised p-6 text-sm leading-6 text-muted">
          A migration compares two designs. Add a second design in Design — one for what you sell
          today and one for the proposal — then choose the current one here.
        </div>
      ) : (
        <section className="grid gap-4 rounded-2xl border border-line bg-canvas p-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">
            Design live today
            <select
              aria-label="Incumbent design"
              className="mt-2 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-ink"
              onChange={(event) => {
                const designId = event.target.value;
                if (!designId) {
                  setMigration(undefined);
                  return;
                }
                const design = scenario.designs.find((entry) => entry.id === designId);
                const firstTier = design?.tiers[0]?.id;
                if (!firstTier) return;
                setMigration({
                  policy: scenario.migration?.policy ?? "grandfather",
                  incumbentDesignId: designId,
                  base: scenario.model.segments.map(
                    (segment) =>
                      scenario.migration?.base.find((row) => row.segmentId === segment.id) ??
                      defaultBaseRow(scenario, segment.id, firstTier),
                  ),
                });
              }}
              value={incumbent?.id ?? ""}
            >
              <option value="">No installed base (greenfield)</option>
              {alternatives.map((design) => (
                <option key={design.id} value={design.id}>
                  {design.name}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs text-muted">
              The proposal is the active design, {proposed.name}.
            </span>
          </label>
          <label className="text-sm font-medium text-ink">
            Migration policy
            <select
              aria-label="Migration policy"
              className="mt-2 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-ink disabled:opacity-60"
              disabled={!scenario.migration}
              onChange={(event) =>
                scenario.migration &&
                setMigration({
                  ...scenario.migration,
                  policy: event.target.value as MigrationPolicy,
                })
              }
              value={scenario.migration?.policy ?? "grandfather"}
            >
              {(Object.keys(policyLabels) as MigrationPolicy[]).map((policy) => (
                <option key={policy} value={policy}>
                  {policyLabels[policy]}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs leading-5 text-muted">
              {policyNotes[scenario.migration?.policy ?? "grandfather"]}
            </span>
          </label>
        </section>
      )}

      {scenario.migration && incumbent ? (
        <section className="rounded-2xl border border-line bg-canvas p-5">
          <h3 className="text-lg font-semibold text-ink">Base composition</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Accounts, not prospects. The switching cost is a one-off account-level cost of standing
            up any alternative; it is what the buyer pays, never what you book.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Installed base by segment</caption>
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Segment</th>
                  <th className="px-3 py-2">On this legacy tier</th>
                  <th className="px-3 py-2 text-right">Accounts</th>
                  <th className="px-3 py-2 text-right">Switching cost</th>
                </tr>
              </thead>
              <tbody>
                {scenario.model.segments.map((segment) => {
                  const row = scenario.migration?.base.find(
                    (entry) => entry.segmentId === segment.id,
                  );
                  const patchRow = (patch: Partial<NonNullable<typeof row>>) =>
                    updateScenario((current) => {
                      if (!current.migration) return current;
                      const existing = current.migration.base.find(
                        (entry) => entry.segmentId === segment.id,
                      );
                      const base = existing
                        ? current.migration.base.map((entry) =>
                            entry.segmentId === segment.id ? { ...entry, ...patch } : entry,
                          )
                        : [
                            ...current.migration.base,
                            {
                              ...defaultBaseRow(current, segment.id, incumbent.tiers[0]?.id ?? ""),
                              ...patch,
                            },
                          ];
                      return { ...current, migration: { ...current.migration, base } };
                    });
                  return (
                    <tr className="border-b border-line/70" key={segment.id}>
                      <th className="px-3 py-3 font-medium text-ink" scope="row">
                        {segment.name}
                      </th>
                      <td className="px-3 py-3">
                        <select
                          aria-label={`${segment.name} legacy tier`}
                          className="min-h-9 w-full rounded-md border border-line bg-canvas-raised px-2 text-ink"
                          onChange={(event) => patchRow({ incumbentTierId: event.target.value })}
                          value={row?.incumbentTierId ?? incumbent.tiers[0]?.id ?? ""}
                        >
                          {incumbent.tiers.map((tier) => (
                            <option key={tier.id} value={tier.id}>
                              {tier.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          aria-label={`${segment.name} account base`}
                          className="min-h-9 w-28 rounded-md border border-line bg-canvas-raised px-2 text-right tabular-nums text-ink"
                          min="0"
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value) && value >= 0)
                              patchRow({ baseCount: value });
                          }}
                          step="any"
                          type="number"
                          value={row?.baseCount ?? 0}
                        />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          aria-label={`${segment.name} switching cost`}
                          className="min-h-9 w-28 rounded-md border border-line bg-canvas-raised px-2 text-right tabular-nums text-ink"
                          min="0"
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value) && value >= 0)
                              patchRow({ switchingCost: value });
                          }}
                          step="any"
                          type="number"
                          value={row?.switchingCost ?? 0}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {readout ? (
        <>
          <section className="rounded-2xl border border-line bg-canvas p-5">
            <h3 className="text-lg font-semibold text-ink">Revenue bridge</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Old MRR reconciled to new. The three movements are exhaustive and disjoint, so the
              bridge closes exactly — a residual would be a bug, not a rounding artifact.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  ["Opening MRR", readout.bridge.openingMrr],
                  ["Expansion", readout.bridge.expansion],
                  ["Contraction", readout.bridge.contraction],
                  ["Churn at migration", readout.bridge.churn],
                  ["Closing MRR", readout.bridge.closingMrr],
                ] as const
              ).map(([label, value]) => (
                <div className="rounded-xl border border-line bg-canvas-raised p-3" key={label}>
                  <dt className="text-xs font-medium text-muted">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                    {value < 0 ? `−${money(Math.abs(value))}` : money(value)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">
              {formatPercent(readout.stayShare, locale)} of the base stays on the legacy plan;{" "}
              {formatPercent(readout.churnShare, locale)} leaves at the migration event.
              {readout.policy !== "forced-at-renewal" && readout.grandfatherOpportunityCost > 0
                ? ` Withdrawing the legacy plan would close ${money(readout.grandfatherOpportunityCost)} higher, net of the churn that would cause.`
                : ""}
              {readout.mrrRequiringBuyerAction > 0
                ? ` ${money(readout.mrrRequiringBuyerAction)} of closing MRR depends on accounts completing the opt-in in time.`
                : ""}
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-canvas p-5">
            <h3 className="text-lg font-semibold text-ink">Migration matrix</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <caption className="sr-only">Where each segment&rsquo;s base lands</caption>
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Segment</th>
                    <th className="px-3 py-2">Lands on</th>
                    <th className="px-3 py-2 text-right">Accounts</th>
                    <th className="px-3 py-2 text-right">Share</th>
                    <th className="px-3 py-2 text-right">MRR</th>
                    <th className="px-3 py-2 text-right">Δ vs legacy</th>
                  </tr>
                </thead>
                <tbody>
                  {readout.cells.map((cell) => (
                    <tr
                      className="border-b border-line/70"
                      key={`${cell.segmentId}-${cell.destinationOfferId ?? "churn"}`}
                    >
                      <th className="px-3 py-3 font-medium text-ink" scope="row">
                        {readout.segments.find((entry) => entry.id === cell.segmentId)?.name ??
                          cell.segmentId}
                      </th>
                      <td className="px-3 py-3 text-ink">
                        {cell.destinationOfferId === null
                          ? "Leaves the category"
                          : cell.destinationName}
                        {cell.stays ? (
                          <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent-strong">
                            stays
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {formatCount(cell.accounts, locale)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {formatPercent(cell.share, locale)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {money(cell.revenue)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                        {cell.revenueDelta < 0
                          ? `−${money(Math.abs(cell.revenueDelta))}`
                          : money(cell.revenueDelta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-canvas p-5">
            <h3 className="text-lg font-semibold text-ink">
              What changed between {incumbent?.name} and {proposed.name}
            </h3>
            {designDiff.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                The two designs are identical on every field the diff reads. There is nothing to
                migrate to.
              </p>
            ) : (
              <ul className="mt-3 grid gap-1.5 text-sm">
                {designDiff.map((entry) => (
                  <li className="text-muted" key={`${entry.path}-${entry.kind}`}>
                    <span className="font-medium text-ink">{entry.path}</span>{" "}
                    {entry.kind === "changed"
                      ? `${entry.before} → ${entry.after}`
                      : entry.kind === "added"
                        ? `added (${entry.after})`
                        : `removed (${entry.before})`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : scenario.migration && incumbent ? (
        <div className="rounded-2xl border border-dashed border-line bg-canvas-raised p-6 text-sm leading-6 text-muted">
          Give at least one segment an account base to see where it lands.
        </div>
      ) : null}
    </section>
  );
}
