import { expect, test } from "@playwright/test";

test("extended surfaces connect Model, Design, Analyze, and Share", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).nth(2).click();

  await page.getByRole("button", { name: "Add interaction" }).click();
  await expect(page.getByText("Feature interactions")).toBeVisible();

  await page.getByRole("button", { name: "Add metric" }).click();
  await page.getByLabel("New usage metric metric name").fill("API calls");
  await page.getByLabel("Mid-market teams API calls P90").fill("400");
  await page.getByLabel("Mid-market teams API calls P50").fill("200");
  await page.getByLabel("Mid-market teams API calls P10").fill("100");
  await expect(page.getByText("API calls").first()).toBeVisible();

  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.getByRole("button", { name: "Add usage line" }).first().click();
  await page.getByLabel("Growth per unit price").fill("0.01");
  await page.getByLabel("Mid-market teams trial months").fill("1");

  await page.getByRole("tab", { name: "Analyze", exact: true }).click();
  await page.getByRole("tab", { name: "Price search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A local search for more revenue near this menu" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Usage", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Expected metered bill by segment" }),
  ).toBeVisible();
  await expect(page.getByText("Expected effective price")).toBeVisible();
  await page.getByRole("tab", { name: "Time", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Trials, conversion, and retention over time" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Positioning", exact: true }).click();
  await page.getByRole("button", { name: "Add competitor" }).click();
  await expect(page.getByText("Survey shortcut")).toBeVisible();

  await page.getByRole("tab", { name: "Share", exact: true }).click();
  await page.getByRole("tab", { name: "Decision support", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "From a changed assumption to a defensible consequence" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PNG" })).toBeVisible();
});

test("visual exports contain captured complete decision evidence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use this template" }).nth(2).click();
  await page.getByRole("tab", { name: "Share", exact: true }).click();
  await page.getByRole("tab", { name: "Decision support", exact: true }).click();
  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  const png = await pngPromise;
  expect(await png.failure()).toBeNull();
  const pngStream = await png.createReadStream();
  const pngChunks = [];
  for await (const chunk of pngStream!) pngChunks.push(chunk);
  const pngBytes = Buffer.concat(pngChunks);
  expect(pngBytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const bundlePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export slide bundle", exact: true }).click();
  const bundle = await bundlePromise;
  const stream = await bundle.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(bytes.toString("utf8")).toContain("Complete structured record");
  expect(bytes.toString("utf8")).toContain("Complete decision evidence");
});

test("all twenty history snapshots are inspectable and restore is undoable", async ({ page }) => {
  const current = {
    schemaVersion: 1,
    id: "fixture",
    name: "Current",
    status: "draft",
    model: { features: [], segments: [], interactions: [], usageMetrics: [] },
    designs: [{ id: "design", name: "Design", tiers: [], addOns: [] }],
    activeDesignId: "design",
    competitors: [],
    research: {},
    settings: { seed: 1, currency: "USD", theme: "system", locale: "en-US" },
  };
  await page.addInitScript((scenario) => {
    localStorage.setItem("wind-tunnel.scenario.v1", JSON.stringify(scenario));
    localStorage.setItem(
      "wind-tunnel.scenario-history.v1",
      JSON.stringify(
        Array.from({ length: 20 }, (_, i) => ({
          id: `snapshot-${i}`,
          label: `Snapshot ${i}`,
          createdAt: new Date(Date.UTC(2026, 9, 3, 0, 20 - i)).toISOString(),
          scenario: { ...scenario, name: `Snapshot ${i}` },
        })),
      ),
    );
  }, current);
  await page.goto("/");
  await page.getByRole("tab", { name: "Share", exact: true }).click();
  await page.getByRole("tab", { name: "Decision support", exact: true }).click();
  const history = page.getByText("What changed in this browser", { exact: true }).locator("..");
  await expect(history.locator("summary")).toHaveCount(6);
  await history.getByRole("button", { name: "Show all saved snapshots", exact: true }).click();
  await expect(history.locator("summary")).toHaveCount(20);
  const last = history.locator("summary").last();
  await last.focus();
  await page.keyboard.press("Enter");
  await expect(last.locator("..").locator("dl")).toContainText("Current");
  const before = await page.evaluate(() => localStorage.getItem("wind-tunnel.scenario.v1"));
  expect(before).toBe(JSON.stringify(current));
  await last.locator("..").getByRole("button", { name: "Restore snapshot", exact: true }).click();
  await expect(
    history.getByRole("button", { name: "Export pre-restore scenario", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wind-tunnel.scenario.v1")!),
  );
  expect(after.name).toBe("Current");
  expect(after.model).toEqual(current.model);
});
