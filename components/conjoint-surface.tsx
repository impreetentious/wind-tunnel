"use client";

import { useMemo, useState } from "react";

import type { ConjointEstimate } from "@/lib/engine/conjoint";
import { generateConjointDesign } from "@/lib/engine/conjoint";
import {
  applyConjointBridge,
  buildSyntheticConjointStudy,
  CONJOINT_DEMO_CSV,
  conjointCsv,
  estimateConjointRecord,
  makeConjointStudy,
  parseConjointCsv,
  scenarioWithConjointStudy,
  SYNTHETIC_CONJOINT_ATTRIBUTES,
  SYNTHETIC_CONJOINT_PRICE_LEVELS,
  type ConjointBridgeMapping,
} from "@/lib/state/conjoint";
import { formatRecordMoney, formatRecordPercent } from "@/lib/state/decision-record";
import { useScenarioStore } from "@/lib/state/scenario-store";
import type { ConjointStudyRecord } from "@/lib/state/schemas";

interface AttributeDraft {
  id: string;
  name: string;
  levels: string;
}

const defaultAttributes: readonly AttributeDraft[] = [
  { id: "speed", name: "Speed", levels: "low, medium, high" },
  { id: "support", name: "Support", levels: "self, priority, dedicated" },
];

const inputClass = "min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm text-ink";
const buttonPrimary =
  "min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60";
const buttonSecondary =
  "min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent";

function toEngineAttributes(drafts: readonly AttributeDraft[]) {
  return drafts.map((draft) => ({
    id: draft.id.trim(),
    name: draft.name.trim() || draft.id.trim(),
    levels: draft.levels
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  }));
}

function parsePriceLevels(raw: string): number[] {
  return raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function PartWorthChart({ estimate }: { estimate: ConjointEstimate }) {
  if (!estimate.partWorths || estimate.partWorths.length === 0) return null;
  const scale = Math.max(1, ...estimate.partWorths.map((row) => Math.abs(row.ci90[1])));
  const rowHeight = 24;
  const width = 620;
  const left = 180;
  const right = 20;
  const height = estimate.partWorths.length * rowHeight + 12;
  const centre = left + (width - left - right) / 2;
  const x = (value: number) => centre + (value / scale) * ((width - left - right) / 2);
  return (
    <figure className="mt-4 overflow-x-auto" data-testid="conjoint-part-worth-chart">
      <svg
        aria-label="Conjoint part-worth estimates with 90% intervals"
        className="min-w-[36rem]"
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        <line stroke="var(--line)" x1={centre} x2={centre} y1={0} y2={height - 12} />
        {estimate.partWorths.map((row, index) => {
          const y = index * rowHeight + 16;
          const a = x(row.ci90[0]);
          const b = x(row.ci90[1]);
          const c = x(row.estimate);
          return (
            <g key={`${row.attributeId}-${row.level}`}>
              <text fill="var(--muted)" fontSize="11" textAnchor="end" x={left - 8} y={y + 4}>
                {row.attributeId} · {row.level}
              </text>
              <line stroke="var(--accent)" strokeWidth="2" x1={a} x2={b} y1={y} y2={y} />
              <circle cx={c} cy={y} fill="var(--accent-strong)" r="4" />
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 text-xs text-muted">
        Dots are the pooled MNL point estimates; whiskers are 90% CIs. Levels within an attribute
        sum to zero.
      </figcaption>
    </figure>
  );
}

function statusHeading(status: ConjointEstimate["status"]) {
  switch (status) {
    case "ok":
      return "Pooled MNL converged";
    case "nonIdentifiable":
      return "Design or responses are not identifiable";
    case "separated":
      return "Choices are (nearly) separated";
    case "nonConverged":
      return "Newton-Raphson did not reach tolerance";
  }
}

export function ConjointSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const record = scenario.research.conjoint;
  const currency = scenario.settings.currency;

  const [drafts, setDrafts] = useState<readonly AttributeDraft[]>(() => defaultAttributes);
  const [taskCount, setTaskCount] = useState(12);
  const [alternatives, setAlternatives] = useState(3);
  const [includeNone, setIncludeNone] = useState(true);
  const [priceRaw, setPriceRaw] = useState("10, 30, 50");
  const [seed, setSeed] = useState(1708);
  const [designError, setDesignError] = useState<string | undefined>();

  const [csv, setCsv] = useState(() => (record ? conjointCsv(record.observations) : ""));
  const [csvErrors, setCsvErrors] = useState<readonly { line: number; message: string }[]>([]);

  const estimate = useMemo(
    () => (record && record.observations.length > 0 ? estimateConjointRecord(record) : undefined),
    [record],
  );

  const [segmentId, setSegmentId] = useState(() => scenario.model.segments[0]?.id ?? "");
  const [mapping, setMapping] = useState<
    Record<string, { featureId: string; referenceLevel: string; targetLevel: string }>
  >({});
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const buildDesign = () => {
    setDesignError(undefined);
    setMessage(null);
    const attributes = toEngineAttributes(drafts).filter(
      (attribute) => attribute.id && attribute.levels.length >= 2,
    );
    if (attributes.length === 0) {
      setDesignError("Add at least one attribute with two or more levels.");
      return;
    }
    const priceLevels = parsePriceLevels(priceRaw);
    if (priceLevels.length < 2) {
      setDesignError("Enter at least two non-negative numeric price levels.");
      return;
    }
    try {
      const design = generateConjointDesign({
        attributes,
        taskCount,
        alternativesPerTask: alternatives,
        priceLevels,
        includeNone,
        seed,
      });
      const study = makeConjointStudy(design, { attributes, numericPrice: true }, []);
      updateScenario((current) => scenarioWithConjointStudy(current, study));
      setCsv("");
      setCsvErrors([]);
    } catch (error) {
      setDesignError(error instanceof Error ? error.message : "Design generation failed.");
    }
  };

  const loadSyntheticStudy = () => {
    setDesignError(undefined);
    setCsvErrors([]);
    setMessage(null);
    const study = buildSyntheticConjointStudy();
    setDrafts(
      SYNTHETIC_CONJOINT_ATTRIBUTES.map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        levels: attribute.levels.join(", "),
      })),
    );
    setPriceRaw(SYNTHETIC_CONJOINT_PRICE_LEVELS.join(", "));
    setTaskCount(study.tasks.length);
    setAlternatives(study.tasks[0]?.alternatives.length ?? 3);
    setIncludeNone(true);
    setCsv(conjointCsv(study.observations));
    updateScenario((current) => scenarioWithConjointStudy(current, study));
  };

  const savePastedCsv = () => {
    if (!record) {
      setCsvErrors([{ line: 1, message: "Generate a task design before pasting responses." }]);
      return;
    }
    const parsed = parseConjointCsv(csv, record.tasks);
    setCsvErrors(parsed.errors);
    if (parsed.errors.length > 0 || parsed.observations.length === 0) {
      if (parsed.errors.length === 0) {
        setCsvErrors([{ line: 1, message: "Paste at least one respondent choice." }]);
      }
      return;
    }
    updateScenario((current) =>
      scenarioWithConjointStudy(current, { ...record, observations: [...parsed.observations] }),
    );
  };

  const clearStudy = () => {
    updateScenario((current) => scenarioWithConjointStudy(current, undefined));
    setCsv("");
    setCsvErrors([]);
    setMessage(null);
  };

  const applyBridge = () => {
    if (!record || !estimate) return;
    const entries: ConjointBridgeMapping["entries"] = record.attributes
      .map((attribute) => {
        const config = mapping[attribute.id];
        if (!config?.featureId || !config.referenceLevel || !config.targetLevel) return undefined;
        if (config.referenceLevel === config.targetLevel) return undefined;
        return {
          attributeId: attribute.id,
          featureId: config.featureId,
          referenceLevel: config.referenceLevel,
          targetLevel: config.targetLevel,
        };
      })
      .filter((entry): entry is ConjointBridgeMapping["entries"][number] => Boolean(entry));
    if (entries.length === 0) {
      setMessage({
        kind: "err",
        text: "Choose a feature and two distinct levels for at least one attribute.",
      });
      return;
    }
    const bridged = applyConjointBridge(scenario, record, estimate, { segmentId, entries });
    if (!bridged.ok) {
      setMessage({ kind: "err", text: bridged.reason });
      return;
    }
    updateScenario(() => bridged.scenario);
    setMessage({
      kind: "ok",
      text: `Updated ${bridged.appliedFeatureIds.length} feature share${
        bridged.appliedFeatureIds.length === 1 ? "" : "s"
      } with pooled conjoint provenance.`,
    });
  };

  const canBridge = Boolean(estimate?.bridgeEnabled);

  return (
    <section aria-labelledby="conjoint-title" className="w-full overflow-y-auto px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Analyze · Research · Conjoint
        </p>
        <h1
          className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
          id="conjoint-title"
        >
          Estimate pooled part-worths from a choice-based conjoint
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-muted">
          Define attributes and levels, generate a random-balanced task design, paste respondent
          picks, and inspect pooled MNL part-worths with 90% intervals. The WTP bridge stays gated
          behind a significantly negative numeric price coefficient.
        </p>

        <section className="mt-8 rounded-2xl border border-line bg-canvas p-5">
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">
            Attributes and levels
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Enter comma-separated levels (2–4 per attribute). The last level is the effects-coded
            reference. Numeric account-month price levels are defined below.
          </p>
          <div className="mt-4 space-y-3">
            {drafts.map((draft, index) => (
              <div className="flex flex-wrap gap-2" key={index}>
                <input
                  aria-label={`Attribute ${index + 1} id`}
                  className={`${inputClass} min-w-32 flex-1`}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, id: event.target.value } : entry,
                      ),
                    )
                  }
                  placeholder="id"
                  value={draft.id}
                />
                <input
                  aria-label={`Attribute ${index + 1} name`}
                  className={`${inputClass} min-w-40 flex-1`}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, name: event.target.value } : entry,
                      ),
                    )
                  }
                  placeholder="Display name"
                  value={draft.name}
                />
                <input
                  aria-label={`Attribute ${index + 1} levels`}
                  className={`${inputClass} min-w-64 flex-1`}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, levels: event.target.value } : entry,
                      ),
                    )
                  }
                  placeholder="level1, level2, level3"
                  value={draft.levels}
                />
                <button
                  aria-label={`Remove attribute ${index + 1}`}
                  className={`${inputClass} font-semibold text-muted hover:border-amber hover:text-amber`}
                  disabled={drafts.length === 1}
                  onClick={() =>
                    setDrafts((current) =>
                      current.length === 1 ? current : current.filter((_, i) => i !== index),
                    )
                  }
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className={`${buttonSecondary}`}
              disabled={drafts.length >= 5}
              onClick={() =>
                setDrafts((current) => [
                  ...current,
                  {
                    id: `attribute-${current.length + 1}`,
                    name: "",
                    levels: "level-a, level-b",
                  },
                ])
              }
              type="button"
            >
              Add attribute
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-medium text-ink">
              Tasks per respondent
              <input
                className={`${inputClass} mt-1 block w-full`}
                max={30}
                min={1}
                onChange={(event) => setTaskCount(Number(event.target.value) || 0)}
                type="number"
                value={taskCount}
              />
            </label>
            <label className="text-sm font-medium text-ink">
              Concepts per task
              <input
                className={`${inputClass} mt-1 block w-full`}
                max={5}
                min={2}
                onChange={(event) => setAlternatives(Number(event.target.value) || 0)}
                type="number"
                value={alternatives}
              />
            </label>
            <label className="text-sm font-medium text-ink">
              Numeric price levels
              <input
                className={`${inputClass} mt-1 block w-full`}
                onChange={(event) => setPriceRaw(event.target.value)}
                type="text"
                value={priceRaw}
              />
            </label>
            <label className="text-sm font-medium text-ink">
              Design seed
              <input
                className={`${inputClass} mt-1 block w-full`}
                min={0}
                onChange={(event) => setSeed(Number(event.target.value) || 0)}
                type="number"
                value={seed}
              />
            </label>
          </div>

          <label className={`${inputClass} mt-4 inline-flex items-center gap-2 font-medium`}>
            <input
              checked={includeNone}
              className="h-4 w-4 accent-[var(--accent)]"
              onChange={(event) => setIncludeNone(event.target.checked)}
              type="checkbox"
            />
            Include a “none of these” alternative
          </label>

          <div className="mt-4 flex flex-wrap gap-3">
            <button className={buttonPrimary} onClick={buildDesign} type="button">
              Generate task design
            </button>
            <button className={buttonSecondary} onClick={loadSyntheticStudy} type="button">
              Load synthetic study
            </button>
            {record ? (
              <button
                className={`${inputClass} font-semibold text-muted hover:border-amber hover:text-amber`}
                onClick={clearStudy}
                type="button"
              >
                Clear study
              </button>
            ) : null}
          </div>
          {designError ? (
            <p
              className="mt-3 rounded-lg border border-amber bg-amber-soft p-3 text-sm text-ink"
              role="alert"
            >
              {designError}
            </p>
          ) : null}
        </section>

        {record ? (
          <section className="mt-6 rounded-2xl border border-line bg-canvas p-5">
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">Response CSV</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Columns: respondent, task, alternative. Task and alternative ids come from the
              generated design; each respondent contributes one row per task.
            </p>
            <textarea
              aria-label="Conjoint response CSV"
              className="mt-3 min-h-44 w-full rounded-xl border border-line bg-canvas-raised p-3 font-mono text-xs leading-5 text-ink"
              onChange={(event) => setCsv(event.target.value)}
              placeholder={CONJOINT_DEMO_CSV}
              spellCheck={false}
              value={csv}
            />
            <div className="mt-3 flex flex-wrap gap-3">
              <button className={buttonPrimary} onClick={savePastedCsv} type="button">
                Analyze pasted responses
              </button>
              <button
                className={buttonSecondary}
                onClick={() => {
                  setCsv(CONJOINT_DEMO_CSV);
                  setCsvErrors([]);
                }}
                type="button"
              >
                Load demo CSV
              </button>
            </div>
            {csvErrors.length > 0 ? (
              <ul
                className="mt-4 list-disc space-y-1 rounded-xl border border-amber bg-amber-soft p-4 pl-8 text-sm text-ink"
                role="alert"
              >
                {csvErrors.map((error) => (
                  <li key={`${error.line}-${error.message}`}>
                    Line {error.line}: {error.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {estimate ? (
          <section className="mt-6 rounded-2xl border border-line bg-canvas p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">
                  {statusHeading(estimate.status)}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                  {estimate.bridgeReason}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm font-semibold">
                <span className="rounded-full bg-accent-soft px-3 py-2 text-accent-strong">
                  {estimate.respondentCount} respondents
                </span>
                <span className="rounded-full bg-canvas-raised px-3 py-2 text-muted">
                  {estimate.observationCount} choices
                </span>
                {estimate.hitRate !== undefined ? (
                  <span
                    className="rounded-full bg-canvas-raised px-3 py-2 text-muted"
                    data-testid="conjoint-hit-rate"
                  >
                    Hit rate {formatRecordPercent(estimate.hitRate)}
                  </span>
                ) : null}
              </div>
            </div>
            <PartWorthChart estimate={estimate} />
            {estimate.priceCoefficient ? (
              <p className="mt-3 text-sm text-muted">
                Price coefficient{" "}
                <span className="tabular-nums text-ink">
                  {estimate.priceCoefficient.estimate.toFixed(4)}
                </span>{" "}
                (SE {estimate.priceCoefficient.standardError.toFixed(4)}, 90% CI [
                {estimate.priceCoefficient.ci90[0].toFixed(4)},{" "}
                {estimate.priceCoefficient.ci90[1].toFixed(4)}]).
              </p>
            ) : null}
          </section>
        ) : null}

        {record && estimate ? (
          <section className="mt-6 rounded-2xl border border-line bg-canvas p-5">
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">
              Apply to value matrix
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Choose a segment, map each attribute to a feature, then bridge. Provenance:{" "}
              <span className="tabular-nums text-ink">
                pooled conjoint (N={estimate.respondentCount})
              </span>
              . Bridge is disabled when the numeric price coefficient is not significantly negative.
            </p>
            {!canBridge ? (
              <p
                aria-live="polite"
                className="mt-3 rounded-lg border border-amber bg-amber-soft p-3 text-sm text-ink"
                data-testid="conjoint-bridge-disabled"
              >
                {estimate.bridgeReason}
              </p>
            ) : null}
            <label className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-ink">
              Segment
              <select
                className={`${inputClass} bg-canvas`}
                onChange={(event) => setSegmentId(event.target.value)}
                value={segmentId}
              >
                {scenario.model.segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 overflow-x-auto">
              <table
                aria-label="Conjoint bridge mapping"
                className="w-full min-w-[36rem] border-collapse text-left text-sm"
              >
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Attribute</th>
                    <th className="px-3 py-2 font-semibold">Feature</th>
                    <th className="px-3 py-2 font-semibold">Reference</th>
                    <th className="px-3 py-2 font-semibold">Target</th>
                    <th className="px-3 py-2 text-right font-semibold">Δ WTP</th>
                  </tr>
                </thead>
                <tbody>
                  {record.attributes.map((attribute) => {
                    const config = mapping[attribute.id] ?? {
                      featureId: "",
                      referenceLevel: attribute.levels[0],
                      targetLevel: attribute.levels.at(-1) ?? attribute.levels[0],
                    };
                    const first = estimate.partWorths?.find(
                      (row) => row.attributeId === attribute.id && row.level === config.targetLevel,
                    );
                    const zero = estimate.partWorths?.find(
                      (row) =>
                        row.attributeId === attribute.id && row.level === config.referenceLevel,
                    );
                    const delta =
                      first && zero && estimate.priceCoefficient
                        ? -(first.estimate - zero.estimate) / estimate.priceCoefficient.estimate
                        : undefined;
                    const set = (
                      key: "featureId" | "referenceLevel" | "targetLevel",
                      value: string,
                    ) =>
                      setMapping((current) => ({
                        ...current,
                        [attribute.id]: { ...config, [key]: value },
                      }));
                    return (
                      <tr className="border-b border-line/70" key={attribute.id}>
                        <td className="px-3 py-2 font-medium text-ink">{attribute.name}</td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Feature for ${attribute.name}`}
                            className={`${inputClass} min-w-40`}
                            onChange={(event) => set("featureId", event.target.value)}
                            value={config.featureId}
                          >
                            <option value="">Skip</option>
                            {scenario.model.features.map((feature) => (
                              <option key={feature.id} value={feature.id}>
                                {feature.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Reference level for ${attribute.name}`}
                            className={inputClass}
                            onChange={(event) => set("referenceLevel", event.target.value)}
                            value={config.referenceLevel}
                          >
                            {attribute.levels.map((level) => (
                              <option key={level} value={level}>
                                {level}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Target level for ${attribute.name}`}
                            className={inputClass}
                            onChange={(event) => set("targetLevel", event.target.value)}
                            value={config.targetLevel}
                          >
                            {attribute.levels.map((level) => (
                              <option key={level} value={level}>
                                {level}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">
                          {delta === undefined ? "—" : formatRecordMoney(delta, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className={buttonPrimary}
                disabled={!canBridge}
                onClick={applyBridge}
                type="button"
              >
                Apply pooled part-worths
              </button>
              {message ? (
                <p
                  aria-live="polite"
                  className={`text-sm ${
                    message.kind === "ok" ? "text-accent-strong" : "text-amber"
                  }`}
                >
                  {message.text}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {!record ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line bg-canvas p-5 text-sm text-muted">
            Generate a task design to begin. No conjoint study is saved on this scenario yet.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export type { ConjointStudyRecord };
