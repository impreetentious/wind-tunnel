"use client";

import { formatRecordMoney } from "@/lib/state/decision-record";
import { activeDesign } from "@/lib/state/design-editing";
import { useScenarioStore } from "@/lib/state/scenario-store";

export function PricingPageSurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const design = activeDesign(scenario);
  const featureNames = new Map(
    scenario.model.features.map((feature) => [feature.id, feature.name]),
  );
  const currency = scenario.settings.currency;

  return (
    <section
      aria-labelledby="pricing-mock-title"
      className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8"
    >
      <div>
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Pricing-page mock
        </p>
        <h1
          className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
          id="pricing-mock-title"
        >
          Preview the active menu as buyers would see it
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted">
          This is a presentation layer over {design.name}. Change prices or fences in Design; the
          mock never keeps a second copy of the menu.
        </p>
      </div>

      <article
        className="mt-7 rounded-3xl border border-line bg-canvas p-5 sm:p-8"
        data-testid="pricing-page-mock"
      >
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-accent">{scenario.name}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink">
            Choose the package that fits your team
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Monthly list prices shown in {currency}. Feature availability comes directly from the
            active design.
          </p>
        </header>

        {design.tiers.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
            Add a tier in Design to create the pricing-page preview.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {design.tiers.map((tier, index) => (
              <section
                className={`flex flex-col rounded-2xl border p-5 ${
                  index === design.tiers.length - 1
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-canvas-raised"
                }`}
                key={tier.id}
              >
                <div>
                  <p className="text-lg font-semibold text-ink">{tier.name}</p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] tabular-nums text-ink">
                    {formatRecordMoney(tier.price, currency)}
                    <span className="ml-1 text-xs font-normal tracking-normal text-muted">
                      /{tier.priceMetric === "per-seat" ? "seat" : "account"}/month
                    </span>
                  </p>
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-sm text-ink">
                  {tier.featureIds.length === 0 ? (
                    <li className="text-muted">No catalog features are included yet.</li>
                  ) : (
                    tier.featureIds.map((featureId) => (
                      <li className="flex gap-2" key={featureId}>
                        <span aria-hidden="true" className="font-semibold text-accent">
                          ✓
                        </span>
                        <span>{featureNames.get(featureId) ?? featureId}</span>
                      </li>
                    ))
                  )}
                </ul>
                <span
                  aria-disabled="true"
                  className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg border border-accent px-4 text-sm font-semibold text-accent-strong"
                >
                  Preview only
                </span>
              </section>
            ))}
          </div>
        )}

        {design.addOns.length > 0 ? (
          <section
            className="mt-6 rounded-2xl border border-line bg-canvas-raised p-5"
            aria-labelledby="mock-addons-title"
          >
            <h3 className="font-semibold text-ink" id="mock-addons-title">
              Optional add-ons
            </h3>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {design.addOns.map((addOn) => (
                <li
                  className="flex items-baseline justify-between gap-4 border-b border-line pb-2 text-sm"
                  key={addOn.id}
                >
                  <span className="font-medium text-ink">{addOn.name}</span>
                  <span className="tabular-nums text-muted">
                    {formatRecordMoney(addOn.price, currency)}/
                    {addOn.priceMetric === "per-seat" ? "seat" : "account"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </section>
  );
}
