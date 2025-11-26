"use client";

import { useMemo, useState } from "react";

import {
  analyzeBundling,
  type BundlingInput,
  type BundlingRegimeResult,
} from "@/lib/engine/bundling";
import { formatRecordMoney } from "@/lib/state/decision-record";
import { useScenarioStore } from "@/lib/state/scenario-store";

function price(value: number | undefined, currency: string) {
  return value === undefined ? "Not offered" : formatRecordMoney(value, currency);
}

function priceSummary(result: BundlingRegimeResult, currency: string) {
  const values: [string, number | undefined][] =
    result.regime === "components"
      ? [
          ["A", result.prices.a],
          ["B", result.prices.b],
          ["A + B", (result.prices.a ?? 0) + (result.prices.b ?? 0)],
        ]
      : result.regime === "pure-bundle"
        ? [["A + B", result.prices.bundle]]
        : [
            ["A", result.prices.a],
            ["B", result.prices.b],
            ["A + B", result.prices.bundle],
          ];
  return values.map(([label, value]) => `${label}: ${price(value, currency)}`).join(" · ");
}

function canonicalInput(): BundlingInput {
  return {
    tieMode: "seller-favorable",
    segments: [
      { id: "a-lover", prospectCount: 1, sigma: 0, valueA: 9, valueB: 1 },
      { id: "b-lover", prospectCount: 1, sigma: 0, valueA: 1, valueB: 9 },
    ],
  };
}

export function BundlingSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const features = scenario.model.features;
  const [featureAId, setFeatureAId] = useState(features[0]?.id ?? "");
  const [featureBId, setFeatureBId] = useState(features[1]?.id ?? "");
  const [canonical, setCanonical] = useState(false);
  const resolvedA = features.some((feature) => feature.id === featureAId)
    ? featureAId
    : (features[0]?.id ?? "");
  const resolvedB = features.some(
    (feature) => feature.id === featureBId && feature.id !== resolvedA,
  )
    ? featureBId
    : (features.find((feature) => feature.id !== resolvedA)?.id ?? "");
  const featureA = features.find((feature) => feature.id === resolvedA);
  const featureB = features.find((feature) => feature.id === resolvedB);
  const input = useMemo<BundlingInput | null>(() => {
    if (canonical) return canonicalInput();
    if (!resolvedA || !resolvedB || scenario.model.segments.length === 0) return null;
    return {
      tieMode: "conservative",
      segments: scenario.model.segments.map((segment) => ({
        id: segment.id,
        prospectCount: segment.prospectBand.p50,
        sigma: segment.withinSegmentSigma,
        valueA: segment.wtpBand.p50 * (segment.featureAllocation[resolvedA] ?? 0),
        valueB: segment.wtpBand.p50 * (segment.featureAllocation[resolvedB] ?? 0),
      })),
    };
  }, [canonical, resolvedA, resolvedB, scenario]);
  const result = useMemo(() => (input ? analyzeBundling(input) : null), [input]);
  const currency = scenario.settings.currency;

  if (features.length < 2 && !canonical) {
    return (
      <section className="grid min-h-[26rem] place-items-center px-6 py-12 text-center">
        <div className="max-w-xl">
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-ink">
            Add two catalog features to compare bundling regimes.
          </h1>
          <p className="mt-4 leading-7 text-muted">
            Bundling evaluates two goods using the segment values already entered in Model.
          </p>
          <button
            className="mt-5 min-h-10 rounded-lg border border-line bg-canvas px-4 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => setCanonical(true)}
            type="button"
          >
            Show canonical teaching fixture
          </button>
        </div>
      </section>
    );
  }

  if (!result) return null;
  const regimes = [result.components, result.pureBundle, result.mixed];
  const runnerUp = [...regimes]
    .filter((regime) => regime.regime !== result.best.regime)
    .sort((left, right) => right.revenue - left.revenue)[0];
  const bestLabel =
    result.best.regime === "components"
      ? "Pure components"
      : result.best.regime === "pure-bundle"
        ? "Pure bundle"
        : "Mixed bundling";

  return (
    <section aria-labelledby="bundling-title" className="w-full px-5 py-7 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
            Analyze research · Bundling
          </p>
          <h1
            className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
            id="bundling-title"
          >
            Compare separate, bundled, and mixed offers
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted">
            Within each segment, one buyer scale moves both goods together. Any bundling gain comes
            from value dispersion across segments, not invented independence inside a buyer.
          </p>
        </div>
        <button
          className="min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent"
          onClick={() => setCanonical((current) => !current)}
          type="button"
        >
          {canonical ? "Use current model" : "Show canonical teaching fixture"}
        </button>
      </div>

      {canonical ? (
        <p className="mt-5 rounded-xl bg-amber-soft p-4 text-sm leading-6 text-amber">
          Teaching fixture: two equal-size point-mass segments value A/B at 9/1 and 1/9. It uses the
          seller-favorable participation convention solely to reproduce the textbook oracle.
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap gap-3 rounded-xl border border-line bg-canvas-raised p-4">
          <label className="text-sm font-medium text-ink">
            Good A
            <select
              className="ml-2 min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm text-ink"
              onChange={(event) => {
                setFeatureAId(event.target.value);
                if (event.target.value === resolvedB) {
                  setFeatureBId(
                    features.find((feature) => feature.id !== event.target.value)?.id ?? "",
                  );
                }
              }}
              value={resolvedA}
            >
              {features.map((feature) => (
                <option key={feature.id} value={feature.id}>
                  {feature.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            Good B
            <select
              className="ml-2 min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm text-ink"
              onChange={(event) => setFeatureBId(event.target.value)}
              value={resolvedB}
            >
              {features
                .filter((feature) => feature.id !== resolvedA)
                .map((feature) => (
                  <option key={feature.id} value={feature.id}>
                    {feature.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="self-center text-sm text-muted">
            {featureA?.name} + {featureB?.name} · conservative product tie policy
          </p>
        </div>
      )}

      <section
        className="mt-6 rounded-2xl bg-accent-soft p-5"
        aria-labelledby="bundling-verdict-title"
      >
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Grid verdict
        </p>
        <h2
          className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink"
          id="bundling-verdict-title"
        >
          {bestLabel} leads on the searched prices
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted" data-testid="bundling-verdict">
          {canonical
            ? `${formatRecordMoney(result.pureBundle.revenue, currency)} modeled revenue, ${formatRecordMoney(result.pureBundle.revenue - result.components.revenue, currency)} above pure components; mixed bundling matches the pure-bundle result.`
            : runnerUp
              ? `${formatRecordMoney(result.best.revenue, currency)} modeled MRR, ${formatRecordMoney(result.best.revenue - runnerUp.revenue, currency)} above the next regime.`
              : `${formatRecordMoney(result.best.revenue, currency)} modeled MRR.`}{" "}
          This is the best finite-grid result found, not a continuous global optimum.
        </p>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {regimes.map((regime) => {
          const label =
            regime.regime === "components"
              ? "Pure components"
              : regime.regime === "pure-bundle"
                ? "Pure bundle"
                : "Mixed bundling";
          return (
            <section className="rounded-2xl border border-line bg-canvas p-5" key={regime.regime}>
              <h2 className="text-lg font-semibold text-ink">{label}</h2>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">
                {formatRecordMoney(regime.revenue, currency)}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted">{priceSummary(regime, currency)}</p>
              <p className="mt-3 text-xs text-muted">
                {regime.evaluatedMenus.toLocaleString("en-US")} valid menus evaluated
              </p>
            </section>
          );
        })}
      </div>

      <details className="mt-6 rounded-xl border border-line bg-canvas p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Prices searched</summary>
        <p className="mt-3 text-sm leading-6 text-muted">
          Candidate prices come from each segment&apos;s A, B, and A+B values at P10/P50/P90 buyer
          scale, plus just-inside binding prices, zero, and explicit “not offered” sentinels in the
          mixed regime. Mixed also evaluates A+B at the exact sum of component prices.
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-medium text-ink">A candidates</dt>
            <dd className="text-muted">{result.candidates.a.length}</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">B candidates</dt>
            <dd className="text-muted">{result.candidates.b.length}</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Bundle candidates</dt>
            <dd className="text-muted">{result.candidates.bundle.length}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
