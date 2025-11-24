"use client";

import { useMemo, useState } from "react";

import {
  buildPricingDecisionRecord,
  formatRecordMoney,
  formatRecordPercent,
  type PricingDecisionRecord,
} from "@/lib/state/decision-record";
import { useScenarioStore } from "@/lib/state/scenario-store";

function localIsoDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function safeFileStem(value: string) {
  const stem = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return stem || "pricing-decision";
}

function downloadMarkdown(record: PricingDecisionRecord) {
  const blob = new Blob([record.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileStem(record.scenario.name)}-decision-record-${record.generatedOn}.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function RecordKpis({ record }: { record: PricingDecisionRecord }) {
  const { economics, scenario } = record;
  if (!economics) {
    return <p className="mt-4 text-sm text-muted">Add a buyer segment to calculate economics.</p>;
  }
  const rows = [
    ["MRR", formatRecordMoney(economics.mrr, scenario.settings.currency)],
    ["Paid conversion", formatRecordPercent(economics.paidConversion)],
    ["ARPA", formatRecordMoney(economics.arpa, scenario.settings.currency)],
    ["Capture rate", formatRecordPercent(economics.captureRate)],
  ];
  return (
    <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(([label, value]) => (
        <div className="border-t border-line pt-3" key={label}>
          <dt className="text-xs font-medium text-muted">{label}</dt>
          <dd
            className="mt-1 text-lg font-semibold tabular-nums text-ink"
            data-testid={label === "MRR" ? "decision-record-mrr" : undefined}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PricingRecord({ record }: { record: PricingDecisionRecord }) {
  const { scenario, activeDesign, economics, uncertainty, research } = record;
  const currency = scenario.settings.currency;
  return (
    <article
      aria-labelledby="decision-record-document-title"
      className="decision-record rounded-2xl border border-line bg-canvas px-5 py-7 sm:px-8"
      data-testid="decision-record-document"
    >
      <header>
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Pricing Decision Record
        </p>
        <h2
          className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink"
          id="decision-record-document-title"
        >
          {scenario.name}
        </h2>
        <p className="mt-2 text-sm text-muted">
          Generated {record.generatedOn} · Seed {scenario.settings.seed} · {currency} · Active
          design: {activeDesign.name}
        </p>
        <p className="mt-5 rounded-xl bg-accent-soft p-4 text-sm leading-6 text-ink">
          This record reports what the stated assumptions imply. It does not claim that the model
          found a universally correct price.
        </p>
      </header>

      <section className="mt-8" aria-labelledby="record-snapshot-title">
        <h3 className="text-xl font-semibold text-ink" id="record-snapshot-title">
          Decision snapshot
        </h3>
        <RecordKpis record={record} />
        {uncertainty ? (
          <p className="mt-4 text-sm leading-6 text-muted">
            Across {uncertainty.drawCount.toLocaleString("en-US")} seeded draws, modeled MRR spans{" "}
            {formatRecordMoney(uncertainty.p10, currency)} at P10 to{" "}
            {formatRecordMoney(uncertainty.p90, currency)} at P90. These are simulated percentiles,
            not confidence intervals.
          </p>
        ) : null}
      </section>

      <section className="mt-8" aria-labelledby="record-assumptions-title">
        <h3 className="text-xl font-semibold text-ink" id="record-assumptions-title">
          Assumptions and provenance
        </h3>
        {scenario.model.segments.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No buyer segments have been entered.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Segment</th>
                  <th className="px-3 py-2 text-right font-semibold">Prospects P10/P50/P90</th>
                  <th className="px-3 py-2 text-right font-semibold">WTP P10/P50/P90</th>
                  <th className="px-3 py-2 font-semibold">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {scenario.model.segments.map((segment) => (
                  <tr className="border-b border-line/70" key={segment.id}>
                    <th className="px-3 py-3 font-medium text-ink" scope="row">
                      {segment.name}
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">
                      {segment.prospectBand.p10.toLocaleString()} /{" "}
                      {segment.prospectBand.p50.toLocaleString()} /{" "}
                      {segment.prospectBand.p90.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">
                      {formatRecordMoney(segment.wtpBand.p10, currency)} /{" "}
                      {formatRecordMoney(segment.wtpBand.p50, currency)} /{" "}
                      {formatRecordMoney(segment.wtpBand.p90, currency)}
                    </td>
                    <td className="px-3 py-3 text-ink">
                      {segment.provenance.willingnessToPay.kind},{" "}
                      {segment.provenance.willingnessToPay.confidence} confidence
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-muted">
          The Markdown export expands every feature allocation and its provenance.
        </p>
      </section>

      <section className="mt-8" aria-labelledby="record-design-title">
        <h3 className="text-xl font-semibold text-ink" id="record-design-title">
          Active packaging design
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeDesign.tiers.map((tier) => (
            <article className="rounded-xl border border-line bg-canvas-raised p-4" key={tier.id}>
              <h4 className="font-semibold text-ink">{tier.name}</h4>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {formatRecordMoney(tier.price, currency)}
                <span className="ml-1 text-xs font-normal text-muted">
                  /{tier.priceMetric === "per-seat" ? "seat" : "account"}/month
                </span>
              </p>
              <p className="mt-3 text-xs leading-5 text-muted">
                {tier.featureIds.length} included feature{tier.featureIds.length === 1 ? "" : "s"}
              </p>
            </article>
          ))}
        </div>
      </section>

      {economics ? (
        <section className="mt-8" aria-labelledby="record-waterfall-title">
          <h3 className="text-xl font-semibold text-ink" id="record-waterfall-title">
            Reconciled value waterfall
          </h3>
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            {(
              [
                ["Potential", economics.potential],
                ["Revenue", economics.revenue],
                ["Own-buyer surplus", economics.ownBuyerSurplus],
                ["Fencing gap", economics.fencingGap],
                ["Unserved", economics.unserved],
                ...(economics.competitorLoss > 0
                  ? [["Competitor loss", economics.competitorLoss]]
                  : []),
              ] as [string, number][]
            ).map(([label, value]) => (
              <div className="flex justify-between gap-5 border-b border-line py-2" key={label}>
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-ink">
                  {formatRecordMoney(value, currency)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="record-validation-title">
        <h3 className="text-xl font-semibold text-ink" id="record-validation-title">
          Validation priorities
        </h3>
        {uncertainty?.drivers.length ? (
          <ol className="mt-4 grid gap-3">
            {uncertainty.drivers.map((driver, index) => (
              <li className="rounded-xl border border-line p-4" key={`${driver.label}-${index}`}>
                <p className="text-sm font-semibold text-ink">
                  {index + 1}. {driver.label} · up to{" "}
                  {formatRecordMoney(driver.maximumAbsoluteDelta, currency)} MRR movement
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">{driver.validationAction}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted">No uncertainty drivers are available.</p>
        )}
      </section>

      {research ? (
        <section className="mt-8" aria-labelledby="record-research-title">
          <h3 className="text-xl font-semibold text-ink" id="record-research-title">
            Van Westendorp research
          </h3>
          {research.source === "illustrative" ? (
            <p className="mt-3 rounded-lg bg-amber-soft p-3 text-sm font-semibold text-amber">
              SIMULATED — not evidence
            </p>
          ) : null}
          <p className="mt-3 text-sm leading-6 text-muted">
            {research.validCount} valid of {research.responseCount} responses;{" "}
            {research.excludedCount} ordering violation{research.excludedCount === 1 ? "" : "s"}{" "}
            excluded. Acceptable range:{" "}
            {research.acceptableRange
              ? `${formatRecordMoney(research.acceptableRange.low, currency)}–${formatRecordMoney(research.acceptableRange.high, currency)}`
              : "undefined for this data"}
            .
          </p>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="record-critic-title">
        <h3 className="text-xl font-semibold text-ink" id="record-critic-title">
          Deterministic critic
        </h3>
        {record.findings.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No documented linter rule is currently firing.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {record.findings.map((finding, index) => (
              <li className="rounded-xl border border-line p-4" key={`${finding.id}-${index}`}>
                <p className="text-sm font-semibold text-ink">
                  {finding.id} · {finding.title}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">{finding.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-labelledby="record-alternatives-title">
        <h3 className="text-xl font-semibold text-ink" id="record-alternatives-title">
          Alternatives considered
        </h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Design</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">MRR</th>
                <th className="px-3 py-2 text-right font-semibold">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {record.alternatives.map((alternative) => (
                <tr className="border-b border-line/70" key={alternative.id}>
                  <th className="px-3 py-3 font-medium text-ink" scope="row">
                    {alternative.name}
                  </th>
                  <td className="px-3 py-3 text-muted">
                    {alternative.id === activeDesign.id ? "Active" : "Saved alternative"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink">
                    {alternative.economics
                      ? formatRecordMoney(alternative.economics.mrr, currency)
                      : "Not available"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink">
                    {alternative.economics
                      ? formatRecordPercent(alternative.economics.paidConversion)
                      : "Not available"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="record-limits-title">
        <h3 className="text-xl font-semibold text-ink" id="record-limits-title">
          Scope and limitations
        </h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
          <li>Results are conditional on the documented assumptions and evidence quality.</li>
          <li>This is a single-period screening model, not a retention or expansion forecast.</li>
          <li>Behavioral findings are directional; no numeric uplift is invented.</li>
          <li>The complete feature-value and provenance trace is included in Markdown.</li>
        </ul>
      </section>
    </article>
  );
}

export function DecisionRecordSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const setMessage = useScenarioStore((state) => state.setMessage);
  const [generatedOn, setGeneratedOn] = useState<string | null>(null);
  const record = useMemo(
    () => (generatedOn ? buildPricingDecisionRecord(scenario, generatedOn) : null),
    [generatedOn, scenario],
  );

  return (
    <section
      aria-labelledby="decision-record-title"
      className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8"
    >
      <div className="no-print flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
            Communicate
          </p>
          <h1
            className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
            id="decision-record-title"
          >
            Turn the model into a defensible decision record
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted">
            Generate one traceable artifact from the active model, design, economics, sensitivity,
            research, alternatives, and critic findings. Download Markdown for editing or print the
            same document to PDF.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong"
            onClick={() => setGeneratedOn(localIsoDate())}
            type="button"
          >
            {record ? "Refresh current record" : "Generate current record"}
          </button>
          {record ? (
            <>
              <button
                className="min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent"
                onClick={() => {
                  downloadMarkdown(record);
                  setMessage("Pricing Decision Record downloaded as Markdown.");
                }}
                type="button"
              >
                Download Markdown
              </button>
              <button
                className="min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent"
                onClick={() => window.print()}
                type="button"
              >
                Print / Save PDF
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-7">
        {record ? (
          <PricingRecord record={record} />
        ) : (
          <section className="rounded-2xl border border-dashed border-line bg-canvas p-8 text-center">
            <h2 className="text-xl font-semibold text-ink">The record is generated on demand.</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">
              Generation recalculates every displayed number from the current scenario and runs a
              fresh 1,000-draw deterministic uncertainty pass with the visible seed.
            </p>
          </section>
        )}
      </div>
    </section>
  );
}
