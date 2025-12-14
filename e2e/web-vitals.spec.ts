import { expect, test } from "@playwright/test";

test("cold-cache runtime Web Vitals and input-to-paint stay inside the local release budget", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "LCP/INP PerformanceObserver coverage is calibrated in Chromium.",
  );
  // A fresh context has no HTTP cache or localStorage; this is deliberately a cold visit.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const metrics = { lcp: 0, cls: 0, inp: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[])
        metrics.lcp = Math.max(metrics.lcp, entry.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value?: number;
        hadRecentInput?: boolean;
      })[])
        if (!entry.hadRecentInput) metrics.cls += entry.value ?? 0;
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { duration?: number })[])
        metrics.inp = Math.max(metrics.inp, entry.duration ?? 0);
    }).observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit & { durationThreshold: number });
    (window as Window & { __windVitals?: typeof metrics }).__windVitals = metrics;
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Use this template" }).first().click();
  await page.waitForTimeout(250);
  const coldMetrics = await page.evaluate(
    () =>
      (window as Window & { __windVitals?: { lcp: number; cls: number; inp: number } })
        .__windVitals,
  );
  expect(coldMetrics?.lcp ?? 0).toBeLessThan(2_500);
  expect(coldMetrics?.cls ?? 0).toBeLessThan(0.1);

  const input = page.getByLabel("Growing teams account-level WTP confidence band P50 (USD)");
  await page.evaluate(() => {
    const target = document.querySelector<HTMLInputElement>(
      "input[aria-label='Growing teams account-level WTP confidence band P50 (USD)']",
    );
    target?.addEventListener(
      "input",
      () => {
        const start = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            (window as Window & { __inputToPaint?: number }).__inputToPaint =
              performance.now() - start;
          }),
        );
      },
      { once: true },
    );
  });
  await input.fill("2500");
  await expect(
    page.getByText("Potential value").locator("xpath=following-sibling::*"),
  ).toBeVisible();
  await page.waitForTimeout(50);
  const inputToPaint = await page.evaluate(
    () =>
      (window as Window & { __inputToPaint?: number }).__inputToPaint ?? Number.POSITIVE_INFINITY,
  );
  expect(inputToPaint).toBeLessThan(32);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.waitForTimeout(50);
  const afterInteraction = await page.evaluate(
    () => (window as Window & { __windVitals?: { inp: number } }).__windVitals?.inp ?? 0,
  );
  expect(afterInteraction).toBeLessThan(200);
  await context.close();
});
