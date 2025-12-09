/**
 * @spec §15 M-11 currency/i18n foundation.
 *
 * A tiny locale/currency-aware formatting layer built on `Intl.NumberFormat`
 * (no new dependency — ledger D-41). Every UI surface eventually reads
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

const formatterCache = new Map<string, Intl.NumberFormat>();

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

/**
 * Locale-aware compact percentage — useful for chart labels where "12.34%"
 * would clutter axis ticks. Falls back to fixed one-decimal below 1000×.
 */
export function formatPercentCompact(value: number, locale = "en-US"): string {
  if (!Number.isFinite(value)) return "—";
  return getFormatter(locale, {
    style: "percent",
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
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

export type LocaleCode = (typeof BUILT_IN_LOCALES)[number]["code"];
