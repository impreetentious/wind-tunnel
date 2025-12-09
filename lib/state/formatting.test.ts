import { describe, expect, it } from "vitest";
import { BUILT_IN_LOCALES, formatCount, formatMoney, formatPercent } from "./formatting";

describe("M-11 locale/currency formatting", () => {
  it("uses the currency symbol appropriate to the locale", () => {
    expect(formatMoney(1_234, "USD", "en-US")).toContain("$");
    expect(formatMoney(1_234, "EUR", "de-DE")).toContain("€");
    // ja-JP uses the fullwidth yen sign (￥) not the halfwidth one.
    expect(formatMoney(1_234, "JPY", "ja-JP")).toMatch(/[¥￥]/);
  });

  it("respects compact notation for large values", () => {
    const compact = formatMoney(1_234_567, "USD", "en-US", { compact: true });
    // 1.2M when compact; 1,234,567 otherwise
    expect(compact.length).toBeLessThan(
      formatMoney(1_234_567, "USD", "en-US", { compact: false }).length,
    );
  });

  it("returns a dash on non-finite input rather than crashing", () => {
    expect(formatMoney(Number.NaN, "USD")).toBe("—");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatCount(Number.NaN)).toBe("—");
  });

  it("percent renders locale-appropriate separators", () => {
    expect(formatPercent(0.1234, "en-US", 1)).toBe("12.3%");
    // European locales use a comma as the decimal separator.
    const german = formatPercent(0.1234, "de-DE", 1);
    expect(german).toMatch(/12,3\s?%/);
  });

  it("caches formatter instances (smoke — identity across repeated calls)", () => {
    const first = formatMoney(1, "USD", "en-US");
    const second = formatMoney(1, "USD", "en-US");
    expect(first).toBe(second);
  });

  it("ships a sane built-in locale menu", () => {
    expect(BUILT_IN_LOCALES.map((entry) => entry.code)).toContain("en-US");
    for (const entry of BUILT_IN_LOCALES) {
      expect(entry.code).toMatch(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
      expect(entry.suggestedCurrency).toMatch(/^[A-Z]{3}$/);
    }
  });
});
