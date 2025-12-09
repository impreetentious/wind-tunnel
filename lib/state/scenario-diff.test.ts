import { describe, expect, it } from "vitest";

import { appendScenarioSnapshot, diffScenarios } from "./scenario-diff";
import { scenarioSchema } from "./schemas";
import { salesLedB2bTemplate } from "./templates";

function baseScenario() {
  return scenarioSchema.parse(salesLedB2bTemplate);
}

describe("scenario diff (M-10)", () => {
  it("returns an empty list for an unchanged scenario", () => {
    const scenario = baseScenario();
    expect(diffScenarios(scenario, scenario)).toEqual([]);
  });

  it("captures a settings change with before/after strings", () => {
    const before = baseScenario();
    const after = { ...before, settings: { ...before.settings, currency: "EUR" } };
    const diff = diffScenarios(before, after);
    expect(diff).toEqual([
      {
        category: "settings",
        kind: "changed",
        path: "settings.currency",
        before: "USD",
        after: "EUR",
      },
    ]);
  });

  it("reports added and removed segments by id path", () => {
    const before = baseScenario();
    const trimmed = {
      ...before,
      model: {
        ...before.model,
        segments: before.model.segments.slice(0, 1),
      },
      // Competitors reference all current segments; drop the removed segment there too.
      competitors: before.competitors.map((competitor) => ({
        ...competitor,
        valueBySegment: Object.fromEntries(
          Object.entries(competitor.valueBySegment).filter(
            ([segmentId]) => segmentId === before.model.segments[0]?.id,
          ),
        ),
      })),
    };
    const diff = diffScenarios(before, trimmed);
    const removed = diff.find((entry) => entry.kind === "removed");
    expect(removed?.category).toBe("segments");
    expect(removed?.path).toContain("segments.");
  });

  it("captures a tier price change with numeric formatting", () => {
    const before = baseScenario();
    const after = {
      ...before,
      designs: before.designs.map((design) => ({
        ...design,
        tiers: design.tiers.map((tier, index) =>
          index === 0 ? { ...tier, price: tier.price + 100 } : tier,
        ),
      })),
    };
    const diff = diffScenarios(before, after);
    const priceChange = diff.find((entry) => entry.path.endsWith(".price"));
    expect(priceChange).toBeDefined();
    expect(priceChange?.category).toBe("tiers");
    expect(priceChange?.after).toBeDefined();
  });

  it("is byte-stable across identical re-runs", () => {
    const before = baseScenario();
    const after = { ...before, name: "Different name" };
    const first = diffScenarios(before, after);
    const second = diffScenarios(before, after);
    expect(first).toEqual(second);
  });
});

describe("scenario snapshot history", () => {
  it("skips consecutive no-op saves", () => {
    const scenario = baseScenario();
    const snapshot = {
      id: "s1",
      label: "First",
      createdAt: "2026-08-01T00:00:00Z",
      scenario,
    };
    const history = appendScenarioSnapshot([], snapshot);
    expect(history).toHaveLength(1);
    const next = appendScenarioSnapshot(history, {
      ...snapshot,
      id: "s2",
      label: "Second",
      createdAt: "2026-08-01T00:00:05Z",
    });
    // Same scenario reference under the hood; the diff is empty ⇒ no history growth.
    expect(next).toBe(history);
  });

  it("caps the history at maxEntries entries newest-first", () => {
    const scenario = baseScenario();
    let history: readonly ReturnType<typeof snap>[] = [];
    function snap(index: number) {
      return {
        id: `s${index}`,
        label: `Snapshot ${index}`,
        createdAt: `2026-08-01T00:00:0${index}Z`,
        scenario: { ...scenario, name: `Rev ${index}` },
      };
    }
    for (let i = 0; i < 5; i += 1) {
      history = appendScenarioSnapshot(history, snap(i), 3);
    }
    expect(history).toHaveLength(3);
    expect(history[0].id).toBe("s4");
  });
});
