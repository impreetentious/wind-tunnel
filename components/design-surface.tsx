"use client";

import { useMemo } from "react";

import { GlossaryPopover } from "@/components/glossary-popover";
import { linterExplainers } from "@/content/linter-copy";
import type { LinterFinding } from "@/lib/engine/linter";
import {
  MAX_ADD_ONS,
  MAX_TIERS,
  activeDesign,
  addAddOn,
  addTier,
  createDesign,
  duplicateActiveDesign,
  removeAddOn,
  removeTier,
  renameActiveDesign,
  selectActiveDesign,
  toggleAddOnFeature,
  toggleFreeTier,
  toggleTierFeature,
  updateAddOn,
  updateTier,
} from "@/lib/state/design-editing";
import { lintScenarioDesign } from "@/lib/state/scenario-linter";
import { useScenarioStore } from "@/lib/state/scenario-store";
import type { Scenario } from "@/lib/state/schemas";

type Design = Scenario["designs"][number];
type Tier = Design["tiers"][number];
type AddOn = Design["addOns"][number];

function TierInputs({
  tier,
  onChange,
  onRemove,
}: {
  tier: Tier;
  onChange: (updater: (tier: Tier) => Tier) => void;
  onRemove: () => void;
}) {
  return (
    <article className="rounded-xl border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="min-w-40 flex-1 text-xs font-medium text-muted">
          Tier name
          <input
            aria-label={`${tier.name} tier name`}
            className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold text-ink"
            maxLength={120}
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
            value={tier.name}
          />
        </label>
        <label className="w-28 text-xs font-medium text-muted">
          Price
          <input
            aria-label={`${tier.name} price`}
            className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold tabular-nums text-ink"
            min="0"
            onChange={(event) => {
              const price = Number(event.target.value);
              if (Number.isFinite(price) && price >= 0) {
                onChange((current) => ({ ...current, price }));
              }
            }}
            step="0.01"
            type="number"
            value={tier.price}
          />
        </label>
        <label className="w-32 text-xs font-medium text-muted">
          Metric
          <select
            aria-label={`${tier.name} price metric`}
            className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-2 text-sm text-ink"
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                priceMetric: event.target.value as Tier["priceMetric"],
              }))
            }
            value={tier.priceMetric}
          >
            <option value="flat">Flat / account</option>
            <option value="per-seat">Per seat</option>
          </select>
        </label>
        <button
          aria-label={`Remove ${tier.name}`}
          className="mt-5 min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold text-muted hover:border-amber hover:text-amber"
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">
        {tier.price === 0
          ? "This is a free tier. Its fences still matter because they shape withheld value."
          : "Prices are monthly list-price units; the engine applies per-seat prices to each segment’s seat count."}
      </p>
    </article>
  );
}

function AddOnInputs({
  addOn,
  onChange,
  onRemove,
}: {
  addOn: AddOn;
  onChange: (updater: (addOn: AddOn) => AddOn) => void;
  onRemove: () => void;
}) {
  return (
    <article className="rounded-xl border border-line bg-canvas p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_auto] sm:items-end">
        <label className="text-xs font-medium text-muted">
          Add-on name
          <input
            aria-label={`${addOn.name} add-on name`}
            className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold text-ink"
            maxLength={120}
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
            value={addOn.name}
          />
        </label>
        <label className="text-xs font-medium text-muted">
          Price
          <input
            aria-label={`${addOn.name} price`}
            className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold tabular-nums text-ink"
            min="0"
            onChange={(event) => {
              const price = Number(event.target.value);
              if (Number.isFinite(price) && price >= 0) {
                onChange((current) => ({ ...current, price }));
              }
            }}
            step="0.01"
            type="number"
            value={addOn.price}
          />
        </label>
        <label className="text-xs font-medium text-muted">
          Metric
          <select
            aria-label={`${addOn.name} price metric`}
            className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas-raised px-2 text-sm text-ink"
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                priceMetric: event.target.value as AddOn["priceMetric"],
              }))
            }
            value={addOn.priceMetric}
          >
            <option value="flat">Flat / account</option>
            <option value="per-seat">Per seat</option>
          </select>
        </label>
        <button
          aria-label={`Remove ${addOn.name}`}
          className="min-h-10 rounded-lg border border-line bg-canvas-raised px-3 text-sm font-semibold text-muted hover:border-amber hover:text-amber"
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>
    </article>
  );
}

function FenceGrid({ scenario, design }: { scenario: Scenario; design: Design }) {
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const { features } = scenario.model;

  if (features.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-line bg-canvas p-4 text-sm leading-6 text-muted">
        Add a catalog feature in Model before drawing fences. Tiers can be named and priced now, but
        the linter needs buyer values to evaluate the menu.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-left">
        <caption className="sr-only">Feature fences by tier</caption>
        <thead>
          <tr>
            <th
              className="border-b border-line px-3 py-3 text-xs font-semibold text-muted"
              scope="col"
            >
              Catalog feature
            </th>
            {design.tiers.map((tier) => (
              <th
                className="border-b border-line px-3 py-3 text-center text-xs font-semibold text-ink"
                key={tier.id}
                scope="col"
              >
                {tier.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.map((feature) => (
            <tr key={feature.id}>
              <th
                className="border-b border-line px-3 py-3 text-sm font-medium text-ink"
                scope="row"
              >
                {feature.name}
              </th>
              {design.tiers.map((tier) => (
                <td className="border-b border-line px-3 py-3 text-center" key={tier.id}>
                  <input
                    aria-label={`${feature.name} included in ${tier.name}`}
                    checked={tier.featureIds.includes(feature.id)}
                    className="h-5 w-5 accent-[var(--accent)]"
                    onChange={() =>
                      updateScenario((current) => toggleTierFeature(current, tier.id, feature.id))
                    }
                    type="checkbox"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddOnFences({ scenario, design }: { scenario: Scenario; design: Design }) {
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  if (design.addOns.length === 0 || scenario.model.features.length === 0) return null;

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {design.addOns.map((addOn) => (
        <fieldset className="rounded-xl border border-line bg-canvas p-3" key={addOn.id}>
          <legend className="px-1 text-sm font-semibold text-ink">{addOn.name} fence</legend>
          <div className="mt-2 grid gap-2">
            {scenario.model.features.map((feature) => (
              <label className="flex items-center gap-2 text-sm text-muted" key={feature.id}>
                <input
                  aria-label={`${feature.name} included in ${addOn.name}`}
                  checked={addOn.featureIds.includes(feature.id)}
                  className="h-4 w-4 accent-[var(--accent)]"
                  onChange={() =>
                    updateScenario((current) => toggleAddOnFeature(current, addOn.id, feature.id))
                  }
                  type="checkbox"
                />
                {feature.name}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function FindingsDock({
  findings,
  scenario,
}: {
  findings: readonly LinterFinding[];
  scenario: Scenario;
}) {
  const segmentNames = new Map(
    scenario.model.segments.map((segment) => [segment.id, segment.name]),
  );
  return (
    <aside
      aria-label="Design findings"
      className="rounded-2xl border border-line bg-canvas-raised p-5 lg:sticky lg:top-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Design linter
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
            Decision-useful findings
          </h2>
        </div>
        <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
          {findings.length} {findings.length === 1 ? "finding" : "findings"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">
        Deterministic checks over the current menu and engine readout. They identify trade-offs;
        they do not prescribe a universal price. <GlossaryPopover term="decoy" />
      </p>
      {findings.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-line bg-canvas p-4 text-sm leading-6 text-muted">
          No deterministic issues are firing. Keep validating the assumptions behind this menu.
        </p>
      ) : (
        <ol className="mt-5 grid gap-3">
          {findings.map((finding, index) => (
            <li
              className="rounded-xl border border-line bg-canvas p-4"
              key={`${finding.id}-${index}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-accent-soft px-2 py-1 text-xs font-bold text-accent">
                  {finding.id}
                </span>
                <span
                  className={`rounded px-2 py-1 text-xs font-semibold capitalize ${
                    finding.severity === "warning"
                      ? "bg-amber-soft text-amber"
                      : "bg-canvas-raised text-muted"
                  }`}
                >
                  {finding.severity}
                </span>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-ink">{finding.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{finding.message}</p>
              {finding.segmentIds?.length ? (
                <p className="mt-2 text-xs text-muted">
                  Applies to:{" "}
                  {finding.segmentIds.map((id) => segmentNames.get(id) ?? id).join(", ")}
                </p>
              ) : null}
              {finding.citation ? (
                <p className="mt-2 text-xs text-muted">Source: {finding.citation}</p>
              ) : null}
              <details className="mt-3 text-xs leading-5 text-muted">
                <summary className="cursor-pointer font-semibold text-ink">How to use this</summary>
                <p className="mt-2">{linterExplainers[finding.id]}</p>
              </details>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

export function DesignSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const updateScenario = useScenarioStore((state) => state.updateScenario);
  const design = activeDesign(scenario);
  const findings = useMemo(() => lintScenarioDesign(scenario), [scenario]);
  const freeTierEnabled = design.tiers.some((tier) => tier.price === 0);

  return (
    <section aria-labelledby="design-title" className="w-full px-5 py-7 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
            Design the menu
          </p>
          <h1
            className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
            id="design-title"
          >
            Turn value into tiers and fences
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted">
            Price the choices, decide which features each tier withholds, and inspect the economic
            consequences as buyers self-select.
          </p>
        </div>
        <span className="rounded-full bg-accent-soft px-3 py-2 text-xs font-semibold tracking-[0.08em] text-accent uppercase">
          {design.tiers.length} / {MAX_TIERS} tiers · {design.addOns.length} / {MAX_ADD_ONS} add-ons
        </span>
      </div>

      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-line bg-canvas-raised p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
                  Design versions
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
                  Explore alternatives
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Keep multiple packaging ideas in one scenario. Only the active design drives the
                  live model preview.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm font-semibold text-ink hover:border-accent"
                  onClick={() => updateScenario((current) => createDesign(current))}
                  type="button"
                >
                  New design
                </button>
                <button
                  className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm font-semibold text-ink hover:border-accent"
                  onClick={() => updateScenario(duplicateActiveDesign)}
                  type="button"
                >
                  Duplicate active
                </button>
              </div>
            </div>
            <ul className="mt-5 flex list-none flex-wrap gap-2 p-0" aria-label="Scenario designs">
              {scenario.designs.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    aria-pressed={candidate.id === design.id}
                    className={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${
                      candidate.id === design.id
                        ? "border-accent bg-accent-soft text-accent-strong"
                        : "border-line bg-canvas text-muted hover:border-accent hover:text-ink"
                    }`}
                    onClick={() =>
                      updateScenario((current) => selectActiveDesign(current, candidate.id))
                    }
                    type="button"
                  >
                    {candidate.name}
                  </button>
                </li>
              ))}
            </ul>
            <label className="mt-5 block max-w-md text-xs font-medium text-muted">
              Active design name
              <input
                aria-label="Active design name"
                className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm font-semibold text-ink"
                maxLength={120}
                onChange={(event) =>
                  updateScenario((current) => renameActiveDesign(current, event.target.value))
                }
                value={design.name}
              />
            </label>
          </section>

          <section
            aria-labelledby="tiers-title"
            className="rounded-2xl border border-line bg-canvas-raised p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
                  Tiers
                </p>
                <h2
                  className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink"
                  id="tiers-title"
                >
                  The buyer’s menu
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-ink">
                  <input
                    aria-label="Offer a free tier"
                    checked={freeTierEnabled}
                    className="h-4 w-4 accent-[var(--accent)]"
                    onChange={(event) =>
                      updateScenario((current) => toggleFreeTier(current, event.target.checked))
                    }
                    type="checkbox"
                  />
                  Offer a free tier
                </label>
                <button
                  className="min-h-10 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={design.tiers.length >= MAX_TIERS}
                  onClick={() => updateScenario(addTier)}
                  type="button"
                >
                  Add paid tier
                </button>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              {design.tiers.map((tier) => (
                <TierInputs
                  key={tier.id}
                  onChange={(updater) =>
                    updateScenario((current) => updateTier(current, tier.id, updater))
                  }
                  onRemove={() => updateScenario((current) => removeTier(current, tier.id))}
                  tier={tier}
                />
              ))}
            </div>
          </section>

          <section
            aria-labelledby="fences-title"
            className="rounded-2xl border border-line bg-canvas-raised p-5"
          >
            <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
              Feature fences
            </p>
            <h2
              className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink"
              id="fences-title"
            >
              Make the upgrade path explicit
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              A fence is useful only when it changes the offer a buyer can choose. The linter calls
              out dead fences and non-nested upgrades without assuming every ladder must be linear.
              <GlossaryPopover term="fence" />
            </p>
            <FenceGrid design={design} scenario={scenario} />
          </section>

          <section
            aria-labelledby="addons-title"
            className="rounded-2xl border border-line bg-canvas-raised p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
                  Add-ons
                </p>
                <h2
                  className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink"
                  id="addons-title"
                >
                  Price optional value
                </h2>
              </div>
              <button
                className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  design.addOns.length >= MAX_ADD_ONS || scenario.model.features.length === 0
                }
                onClick={() => updateScenario(addAddOn)}
                type="button"
              >
                Add add-on
              </button>
            </div>
            {scenario.model.features.length === 0 ? (
              <p className="mt-4 text-sm leading-6 text-muted">
                Add a catalog feature before creating an add-on.
              </p>
            ) : null}
            <div className="mt-5 grid gap-3">
              {design.addOns.map((addOn) => (
                <AddOnInputs
                  addOn={addOn}
                  key={addOn.id}
                  onChange={(updater) =>
                    updateScenario((current) => updateAddOn(current, addOn.id, updater))
                  }
                  onRemove={() => updateScenario((current) => removeAddOn(current, addOn.id))}
                />
              ))}
            </div>
            <AddOnFences design={design} scenario={scenario} />
          </section>
        </div>

        <FindingsDock findings={findings} scenario={scenario} />
      </div>
    </section>
  );
}
