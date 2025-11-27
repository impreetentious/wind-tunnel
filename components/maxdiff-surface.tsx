"use client";

import { useMemo, useState } from "react";

import type { MaxDiffResult, MaxDiffScore } from "@/lib/engine/maxdiff";
import {
  MAX_DIFF_DEMO_CSV,
  makeMaxDiffStudy,
  maxDiffCsv,
  parseMaxDiffCsv,
  scenarioWithMaxDiffStudy,
  scoreMaxDiffRecord,
} from "@/lib/state/maxdiff";
import { useScenarioStore } from "@/lib/state/scenario-store";
import type { MaxDiffStudyRecord } from "@/lib/state/schemas";

interface ItemDraft {
  id: string;
  name: string;
}

const defaultItems: readonly ItemDraft[] = [
  { id: "item-a", name: "Item A" },
  { id: "item-b", name: "Item B" },
  { id: "item-c", name: "Item C" },
  { id: "item-d", name: "Item D" },
];

const inputClass = "min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm text-ink";
const buttonPrimary =
  "min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong";
const buttonSecondary =
  "min-h-10 rounded-lg border border-line bg-canvas-raised px-4 text-sm font-semibold text-ink hover:border-accent";

function ScoresChart({ scores }: { scores: readonly MaxDiffScore[] }) {
  const width = 620;
  const rowHeight = 26;
  const left = 160;
  const right = 60;
  const height = scores.length * rowHeight + 12;
  const max = Math.max(1, ...scores.map((score) => score.normalizedScore));
  return (
    <figure className="mt-4 overflow-x-auto" data-testid="maxdiff-scores-chart">
      <svg
        aria-label="MaxDiff normalized importance scores"
        className="min-w-[32rem]"
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        {scores.map((score, index) => {
          const y = index * rowHeight + 6;
          const barWidth = ((width - left - right) * score.normalizedScore) / max;
          return (
            <g key={score.itemId}>
              <text fill="var(--muted)" fontSize="12" textAnchor="end" x={left - 8} y={y + 16}>
                {score.itemId}
              </text>
              <rect
                fill="var(--accent-soft)"
                height={16}
                stroke="var(--accent)"
                strokeWidth="1"
                width={barWidth}
                x={left}
                y={y + 4}
              />
              <text fill="var(--ink)" fontSize="12" x={left + barWidth + 6} y={y + 16}>
                {score.normalizedScore.toFixed(1)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 text-xs text-muted">
        Bars show shifted best-worst scores normalized to a sum of 100.
      </figcaption>
    </figure>
  );
}

export function MaxDiffSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const record = scenario.research.maxDiff;

  const [drafts, setDrafts] = useState<readonly ItemDraft[]>(() =>
    record ? record.items.map((item) => ({ ...item })) : defaultItems,
  );
  const [taskCount, setTaskCount] = useState(record?.tasks.length ?? 4);
  const [itemsPerTask, setItemsPerTask] = useState(record?.tasks[0]?.itemIds.length ?? 3);
  const [seed, setSeed] = useState(42);
  const [designError, setDesignError] = useState<string | undefined>();
  const [csv, setCsv] = useState(() => (record ? maxDiffCsv(record.responses) : ""));
  const [csvErrors, setCsvErrors] = useState<readonly { line: number; message: string }[]>([]);

  const result: MaxDiffResult | undefined = useMemo(
    () => (record && record.responses.length > 0 ? scoreMaxDiffRecord(record) : undefined),
    [record],
  );

  const generateDesign = () => {
    setDesignError(undefined);
    const items = drafts
      .map((item) => ({ id: item.id.trim(), name: item.name.trim() || item.id.trim() }))
      .filter((item) => item.id.length > 0);
    if (items.length < 3) {
      setDesignError("Add at least three uniquely-named items.");
      return;
    }
    try {
      const study = makeMaxDiffStudy(items, taskCount, itemsPerTask, seed);
      updateScenario((current) => scenarioWithMaxDiffStudy(current, study));
      setCsv("");
      setCsvErrors([]);
    } catch (error) {
      setDesignError(error instanceof Error ? error.message : "Design generation failed.");
    }
  };

  const savePastedCsv = () => {
    if (!record) {
      setCsvErrors([{ line: 1, message: "Generate a task design before pasting responses." }]);
      return;
    }
    const parsed = parseMaxDiffCsv(csv, record.tasks);
    setCsvErrors(parsed.errors);
    if (parsed.errors.length > 0 || parsed.responses.length === 0) {
      if (parsed.errors.length === 0) {
        setCsvErrors([{ line: 1, message: "Paste at least one respondent pick." }]);
      }
      return;
    }
    updateScenario((current) =>
      scenarioWithMaxDiffStudy(current, { ...record, responses: [...parsed.responses] }),
    );
  };

  const clearStudy = () => {
    updateScenario((current) => scenarioWithMaxDiffStudy(current, undefined));
    setCsv("");
    setCsvErrors([]);
  };

  return (
    <section aria-labelledby="maxdiff-title" className="w-full overflow-y-auto px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Analyze · Research · MaxDiff
        </p>
        <h1
          className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
          id="maxdiff-title"
        >
          Score item importance with a best-worst survey
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-muted">
          Define items, generate a balanced task design, paste respondent best/worst picks, and
          inspect shifted normalized scores. Zero-appearance items surface as validation errors
          rather than silently missing bars.
        </p>

        <section className="mt-8 rounded-2xl border border-line bg-canvas p-5">
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">Items and design</h2>
          <div className="mt-4 space-y-3">
            {drafts.map((item, index) => (
              <div className="flex flex-wrap gap-2" key={index}>
                <input
                  aria-label={`Item ${index + 1} id`}
                  className={`${inputClass} min-w-32 flex-1`}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, id: event.target.value } : entry,
                      ),
                    )
                  }
                  placeholder="item-id"
                  value={item.id}
                />
                <input
                  aria-label={`Item ${index + 1} name`}
                  className={`${inputClass} min-w-40 flex-1`}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, name: event.target.value } : entry,
                      ),
                    )
                  }
                  placeholder="Display name"
                  value={item.name}
                />
                <button
                  aria-label={`Remove item ${index + 1}`}
                  className={`${inputClass} font-semibold text-muted hover:border-amber hover:text-amber`}
                  disabled={drafts.length <= 3}
                  onClick={() =>
                    setDrafts((current) =>
                      current.length <= 3 ? current : current.filter((_, i) => i !== index),
                    )
                  }
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className={buttonSecondary}
              disabled={drafts.length >= 20}
              onClick={() =>
                setDrafts((current) => [...current, { id: `item-${current.length + 1}`, name: "" }])
              }
              type="button"
            >
              Add item
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium text-ink">
              Task count
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
              Items per task
              <input
                className={`${inputClass} mt-1 block w-full`}
                max={5}
                min={3}
                onChange={(event) => setItemsPerTask(Number(event.target.value) || 0)}
                type="number"
                value={itemsPerTask}
              />
            </label>
            <label className="text-sm font-medium text-ink">
              Seed
              <input
                className={`${inputClass} mt-1 block w-full`}
                min={0}
                onChange={(event) => setSeed(Number(event.target.value) || 0)}
                type="number"
                value={seed}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button className={buttonPrimary} onClick={generateDesign} type="button">
              Generate task design
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
              Columns: respondent, task, best, worst. Best and worst must be different items shown
              in the referenced task.
            </p>
            <textarea
              aria-label="MaxDiff response CSV"
              className="mt-3 min-h-44 w-full rounded-xl border border-line bg-canvas-raised p-3 font-mono text-xs leading-5 text-ink"
              onChange={(event) => setCsv(event.target.value)}
              placeholder={MAX_DIFF_DEMO_CSV}
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
                  setCsv(MAX_DIFF_DEMO_CSV);
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

        {result ? (
          <section className="mt-6 rounded-2xl border border-line bg-canvas p-5">
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">
              Normalized importance
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              {result.ok
                ? "Raw score = (best − worst) / appearances. The shift moves the minimum to zero before renormalizing."
                : `Validation error: ${result.error}`}
            </p>
            {result.ok ? <ScoresChart scores={result.scores} /> : null}
          </section>
        ) : null}

        {!record ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line bg-canvas p-5 text-sm text-muted">
            Generate a task design to begin. No MaxDiff study is saved on this scenario yet.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export type { MaxDiffStudyRecord };
