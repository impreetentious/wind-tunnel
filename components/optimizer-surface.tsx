"use client";

import { useMemo, useState } from "react";

import type { JointOptimizerResult } from "@/lib/engine/optimizer";
import { activeDesign } from "@/lib/state/design-editing";
import { applyOptimizedPrices, optimizeScenarioPrices } from "@/lib/state/optimizer";
import type { Scenario } from "@/lib/state/schemas";
import { useScenarioStore } from "@/lib/state/scenario-store";

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSignedCurrency(value: number, currency: string) {
  if (Math.abs(value) < 0.005) return formatCurrency(0, currency);
  return `${value > 0 ? "+" : "−"}${formatCurrency(Math.abs(value), currency)}`;
}

function priceUnit(priceMetric: "flat" | "per-seat") {
  return priceMetric === "per-seat" ? "/seat/mo" : "/account/mo";
}

function ProposalTable({
  result,
  scenario,
  currency,
}: {
  result: JointOptimizerResult;
  scenario: Scenario;
  currency: string;
}) {
  const design = activeDesign(scenario);
  const tierById = new Map(design.tiers.map((tier) => [tier.id, tier]));
  const currentById = new Map(design.tiers.map((tier) => [tier.id, tier.price]));

  return (
    <div className="mt-5 overflow-x-auto">
      <table
        aria-label="Proposed per-tier prices from the local search"
        className="w-full min-w-[40rem] border-collapse text-left text-sm"
      >
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Tier</th>
            <th className="px-3 py-2 text-right font-semibold">Current list price</th>
            <th className="px-3 py-2 text-right font-semibold">Proposed list price</th>
            <th className="px-3 py-2 text-right font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          {result.bestPrices.map((entry) => {
            const tier = tierById.get(entry.tierId);
            const current = currentById.get(entry.tierId) ?? 0;
            const unit = priceUnit(tier?.priceMetric ?? "flat");
            return (
              <tr className="border-b border-line/70" key={entry.tierId}>
                <td className="px-3 py-3 font-medium text-ink">{tier?.name ?? entry.tierId}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatCurrency(current, currency)}
                  <span className="text-muted">{unit}</span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatCurrency(entry.price, currency)}
                  <span className="text-muted">{unit}</span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatSignedCurrency(entry.price - current, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StartDiagnostics({
  result,
  currency,
}: {
  result: JointOptimizerResult;
  currency: string;
}) {
  return (
    <details className="mt-5 rounded-xl border border-line bg-canvas-raised p-4">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        Per-start diagnostics ({result.candidates.length} starts)
      </summary>
      <p className="mt-2 text-sm leading-6 text-muted">
        Coordinate descent runs from several perturbed starting points. Different starts can land on
        different local optima — that spread is exactly why this is a search, not an answer.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table
          aria-label="Per-start optimizer diagnostics"
          className="w-full min-w-[30rem] border-collapse text-left text-sm"
        >
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Start</th>
              <th className="px-3 py-2 text-right font-semibold">Final MRR</th>
              <th className="px-3 py-2 text-right font-semibold">Cycles</th>
              <th className="px-3 py-2 font-semibold">Improved</th>
            </tr>
          </thead>
          <tbody>
            {result.candidates.map((candidate) => (
              <tr className="border-b border-line/70" key={candidate.startIndex}>
                <td className="px-3 py-3 font-medium text-ink">
                  {candidate.startIndex === 0
                    ? "Current design"
                    : `Perturbed ${candidate.startIndex}`}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatCurrency(candidate.finalMrr, currency)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {candidate.cyclesRun}
                </td>
                <td className="px-3 py-3 text-ink">{candidate.improvedFromStart ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function EmptyOptimizer() {
  return (
    <section className="grid min-h-[28rem] place-items-center px-6 py-14 text-center sm:px-12">
      <div className="max-w-xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Price search
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
          Add segments and at least one tier to search prices.
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-base leading-7 text-muted">
          The search looks for a per-tier price vector that earns more MRR near your current design.
          It is a starting point for judgment, never a verdict.
        </p>
      </div>
    </section>
  );
}

export function OptimizerSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const setMessage = useScenarioStore((state) => state.setMessage);
  const result = useMemo(() => optimizeScenarioPrices(scenario), [scenario]);
  const [applied, setApplied] = useState(false);

  if (!result) return <EmptyOptimizer />;

  const improved = result.status === "localOptimum";
  const currency = scenario.settings.currency;

  function apply() {
    if (!result) return;
    updateScenario((current) => applyOptimizedPrices(current, result.bestPrices));
    setMessage("Applied the searched prices to the active design. Undo restores your prices.");
    setApplied(true);
  }

  return (
    <section aria-labelledby="optimizer-title" className="w-full px-5 py-7 sm:px-8 lg:px-10">
      <div>
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Price search
        </p>
        <h1
          className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
          id="optimizer-title"
        >
          A local search for more revenue near this menu
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted">{result.disclosure}</p>
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-accent-soft p-4" role="note">
        <p className="text-sm leading-6 text-ink">
          <strong className="font-semibold">This is local search, not truth.</strong> Screening
          menus routinely have several local optima, so this is “under your assumptions, starting
          near your current prices, this menu found more revenue,” not “the optimal price.” Keep the
          per-tier price sweep (Simulate) and the sensitivity tornado (Uncertainty) as your primary
          reading.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-canvas p-5">
          <p className="text-xs font-medium text-muted">Current design MRR</p>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] tabular-nums text-ink">
            {formatCurrency(result.baselineMrr, currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-canvas p-5">
          <p className="text-xs font-medium text-muted">Best local MRR found</p>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] tabular-nums text-ink">
            {formatCurrency(result.bestMrr, currency)}
          </p>
        </div>
        <div className="rounded-2xl bg-accent-soft p-5">
          <p className="text-xs font-medium text-accent">Revenue found</p>
          <p
            className="mt-1 text-2xl font-semibold tracking-[-0.03em] tabular-nums text-accent-strong"
            data-testid="optimizer-lift"
          >
            {improved ? formatSignedCurrency(result.mrrLift ?? 0, currency) : "None"}
          </p>
        </div>
      </div>

      {improved ? (
        <section
          aria-labelledby="proposal-title"
          className="mt-6 rounded-2xl border border-line bg-canvas p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink" id="proposal-title">
                Proposed prices
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                Review each move against the per-tier sweep before applying. Applying only changes
                tier prices; fences, metrics, and add-ons are untouched, and Undo restores your
                prices.
              </p>
            </div>
            <button
              className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60"
              disabled={applied}
              onClick={apply}
              type="button"
            >
              {applied ? "Applied — review in Simulate" : "Apply proposed prices"}
            </button>
          </div>
          <ProposalTable currency={currency} result={result} scenario={scenario} />
          <StartDiagnostics currency={currency} result={result} />
        </section>
      ) : (
        <section className="mt-6 rounded-2xl border border-line bg-canvas p-5">
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">
            No higher-revenue prices found near this design
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            The search did not beat your current prices under these assumptions. That is a genuine
            signal your prices are near a local revenue peak — but only local. Widen the search by
            editing prices in Design, or revisit the WTP bands in Model.
          </p>
          <StartDiagnostics currency={currency} result={result} />
        </section>
      )}
    </section>
  );
}
