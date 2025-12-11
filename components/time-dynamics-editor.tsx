"use client";

import { useScenarioStore } from "@/lib/state/scenario-store";

const defaults = {
  trialLengthMonths: 0,
  trialConversion: 1,
  monthlyRetention: 1,
  contractTerm: "monthly" as const,
};

export function TimeDynamicsEditor() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  return (
    <section
      className="rounded-2xl border border-line bg-canvas-raised p-5"
      data-tour="design-time-dynamics"
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Trial and retention
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
        Project the menu beyond acquisition
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        These opt-in segment controls feed Analyze → Time. They spread annual contract revenue
        across months and keep the core single-period simulation unchanged.
      </p>
      {scenario.model.segments.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Add buyer segments in Model to configure trial and retention assumptions.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {scenario.model.segments.map((segment) => {
            const dynamics = segment.timeDynamics ?? defaults;
            const set = (field: keyof typeof defaults, value: number | "monthly" | "annual") =>
              updateScenario((current) => ({
                ...current,
                model: {
                  ...current.model,
                  segments: current.model.segments.map((entry) =>
                    entry.id === segment.id
                      ? {
                          ...entry,
                          timeDynamics: { ...(entry.timeDynamics ?? defaults), [field]: value },
                        }
                      : entry,
                  ),
                },
              }));
            return (
              <article className="rounded-xl border border-line bg-canvas p-4" key={segment.id}>
                <h3 className="font-semibold text-ink">{segment.name}</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <label className="text-xs text-muted">
                    Trial months
                    <input
                      aria-label={`${segment.name} trial months`}
                      className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-2 text-ink"
                      min="0"
                      max="24"
                      onChange={(event) => set("trialLengthMonths", Number(event.target.value))}
                      type="number"
                      value={dynamics.trialLengthMonths}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Trial conversion
                    <input
                      aria-label={`${segment.name} trial conversion`}
                      className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-2 text-ink"
                      min="0"
                      max="1"
                      onChange={(event) => set("trialConversion", Number(event.target.value))}
                      step="0.01"
                      type="number"
                      value={dynamics.trialConversion}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Monthly retention
                    <input
                      aria-label={`${segment.name} monthly retention`}
                      className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-2 text-ink"
                      min="0"
                      max="1"
                      onChange={(event) => set("monthlyRetention", Number(event.target.value))}
                      step="0.01"
                      type="number"
                      value={dynamics.monthlyRetention}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Contract
                    <select
                      aria-label={`${segment.name} contract term`}
                      className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-2 text-ink"
                      onChange={(event) =>
                        set("contractTerm", event.target.value as "monthly" | "annual")
                      }
                      value={dynamics.contractTerm}
                    >
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
