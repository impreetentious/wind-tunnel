/**
 * A tiny locale/currency-aware formatting layer built on `Intl.NumberFormat`
 * without another dependency. Every UI surface reads
 * `scenario.settings.locale` and `scenario.settings.currency` through this
 * layer instead of hard-coding "en-US"/"USD" at the call site, so switching a
 * scenario's locale flips the readout without patching each surface.
 *
 * Formatter instances are cached per (locale, currency, options) key to
 * amortize construction cost — `Intl.NumberFormat` is expensive to build and
 * cheap to reuse. The cache is unbounded but keyed on stable strings; a normal
 * session churns through at most a handful of keys per surface. If a locale is
 * malformed the constructor throws — callers should validate at the scenario
 * boundary (the settings schema) rather than defensively per format call.
 */

import { scenarioStore } from "./scenario-store";

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * UI-only compatibility bridge for legacy presentation helpers. It reads the
 * current durable scenario setting, so old readout components can participate
 * in the locale switch while their formatting moves to the shared helpers.
 */
export function currentScenarioLocale(): string {
  return scenarioStore.getState().scenario.settings.locale;
}

function cacheKey(locale: string, options: Intl.NumberFormatOptions): string {
  return `${locale}|${JSON.stringify(options)}`;
}

function getFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = cacheKey(locale, options);
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export interface FormatMoneyOptions {
  compact?: boolean;
  maximumFractionDigits?: number;
}

export function formatMoney(
  value: number,
  currency: string,
  locale = "en-US",
  options: FormatMoneyOptions = {},
): string {
  if (!Number.isFinite(value)) return "—";
  const formatterOptions: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
  };
  if (options.compact) {
    formatterOptions.notation = "compact";
    formatterOptions.compactDisplay = "short";
  }
  return getFormatter(locale, formatterOptions).format(value);
}

export function formatPercent(value: number, locale = "en-US", maximumFractionDigits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return getFormatter(locale, {
    style: "percent",
    maximumFractionDigits,
  }).format(value);
}

export function formatCount(value: number, locale = "en-US", maximumFractionDigits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return getFormatter(locale, { maximumFractionDigits }).format(value);
}

export function formatNumber(
  value: number,
  locale = "en-US",
  options: Intl.NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) return "—";
  return getFormatter(locale, options).format(value);
}

/**
 * A minimal glossary of built-in currency/locale pairs shipped with the app.
 * Not an exhaustive list — every ISO-4217 currency and every BCP-47 locale
 * `Intl.NumberFormat` accepts is valid at runtime; this is only what the
 * template picker offers by default and what the tests need to iterate. A
 * scenario can carry any other pair by editing `settings.currency` and
 * `settings.locale` directly.
 */
export const BUILT_IN_LOCALES = [
  { code: "en-US", label: "English (US)", suggestedCurrency: "USD" },
  { code: "en-GB", label: "English (UK)", suggestedCurrency: "GBP" },
  { code: "de-DE", label: "Deutsch", suggestedCurrency: "EUR" },
  { code: "fr-FR", label: "Français", suggestedCurrency: "EUR" },
  { code: "es-ES", label: "Español", suggestedCurrency: "EUR" },
  { code: "ja-JP", label: "日本語", suggestedCurrency: "JPY" },
  { code: "ko-KR", label: "한국어", suggestedCurrency: "KRW" },
  { code: "hi-IN", label: "हिन्दी", suggestedCurrency: "INR" },
  { code: "pt-BR", label: "Português (Brasil)", suggestedCurrency: "BRL" },
] as const;
