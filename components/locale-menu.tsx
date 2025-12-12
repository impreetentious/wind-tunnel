"use client";

import { BUILT_IN_LOCALES } from "@/lib/state/formatting";
import { useScenarioStore } from "@/lib/state/scenario-store";

export function LocaleMenu() {
  const settings = useScenarioStore((state) => state.scenario.settings);
  const setSettings = useScenarioStore((state) => state.setSettings);
  return (
    <label className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-canvas-raised px-3 text-sm font-medium text-ink">
      Locale
      <select
        aria-label="Scenario locale"
        className="bg-transparent text-sm text-ink"
        onChange={(event) => {
          const choice = BUILT_IN_LOCALES.find((entry) => entry.code === event.target.value);
          if (choice) setSettings({ locale: choice.code, currency: choice.suggestedCurrency });
        }}
        value={settings.locale}
      >
        {BUILT_IN_LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.label}
          </option>
        ))}
      </select>
    </label>
  );
}
