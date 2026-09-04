import { describe, expect, it } from "vitest";

import { appendScenarioSnapshot, diffScenarios, type ScenarioDiffCategory } from "./scenario-diff";
import { scenarioSchema, type Scenario } from "./schemas";
import { salesLedB2bTemplate } from "./templates";

function baseScenario() {
  return scenarioSchema.parse(salesLedB2bTemplate);
}

/**
 * One durable edit per field family that the diff has to see. Every entry is schema-parsed, so
 * these are edits a user can actually persist rather than hand-built shapes.
 */
function durableEdits(): readonly {
  label: string;
  category: ScenarioDiffCategory;
  after: Scenario;
}[] {
  const base = baseScenario();
  const design = base.designs.find((entry) => entry.id === base.activeDesignId)!;
  const withMetric = (scenario: Scenario, extra: Partial<Scenario["model"]>) =>
    scenarioSchema.parse({ ...scenario, model: { ...scenario.model, ...extra } });
  const metered = withMetric(base, {
    usageMetrics: [{ id: "api-calls", name: "API calls", unitLabel: "calls" }],
    segments: base.model.segments.map((segment) => ({
      ...segment,
      usageBands: { "api-calls": { p10: 100, p50: 200, p90: 400 } },
    })),
  });

  return [
    {
      label: "a §4.1.1 pair interaction is added",
      category: "interactions",
      after: withMetric(base, {
        interactions: [{ featureIds: ["core", "automation"], valueFraction: 0.15 }],
      }),
    },
    {
      label: "a §4.15 usage metric is renamed",
      category: "usageMetrics",
      after: withMetric(metered, {
        usageMetrics: [{ id: "api-calls", name: "API requests", unitLabel: "calls" }],
      }),
    },
    {
      label: "a segment's §4.15 usage band moves",
      category: "segments",
      after: withMetric(metered, {
        segments: metered.model.segments.map((segment) =>
          segment.id === "midmarket"
            ? { ...segment, usageBands: { "api-calls": { p10: 100, p50: 300, p90: 400 } } }
            : segment,
        ),
      }),
    },
    {
      label: "a segment gains §4.16 trial and retention assumptions",
      category: "segments",
      after: withMetric(base, {
        segments: base.model.segments.map((segment) =>
          segment.id === "midmarket"
            ? {
                ...segment,
                timeDynamics: {
                  trialLengthMonths: 1,
                  trialConversion: 0.6,
                  monthlyRetention: 0.95,
                  contractTerm: "annual" as const,
                },
              }
            : segment,
        ),
      }),
    },
    {
      label: "a §4.19 discount floor is permitted on a tier",
      category: "designs",
      after: scenarioSchema.parse({
        ...base,
        designs: base.designs.map((candidate) =>
          candidate.id === design.id
            ? {
                ...candidate,
                discountPolicies: [
                  {
                    tierId: design.tiers[0].id,
                    floorFraction: 0.2,
                    hitRateBySegment: { midmarket: 0.4 },
                  },
                ],
              }
            : candidate,
        ),
      }),
    },
    {
      label: "a Van Westendorp study is fielded",
      category: "research",
      after: scenarioSchema.parse({
        ...base,
        research: {
          vanWestendorp: {
            source: "survey" as const,
            responses: [{ tooCheap: 100, cheap: 200, expensive: 400, tooExpensive: 800 }],
          },
        },
      }),
    },
  ];
}

describe("scenario diff", () => {
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

  // The diff is the predicate `appendScenarioSnapshot` uses to decide whether an edit is worth
  // recording, so a field it cannot see is a field whose edits never enter the local history and
  // never show up in the decision-support "what changed" view.
  it.each(durableEdits())("sees $label", ({ category, after }) => {
    const entries = diffScenarios(baseScenario(), after);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((entry) => entry.category)).toContain(category);
  });

  it("records a history snapshot for every kind of durable edit", () => {
    for (const { label, after } of durableEdits()) {
      const history = appendScenarioSnapshot([], {
        id: "s0",
        label: "base",
        createdAt: "2026-08-01T00:00:00Z",
        scenario: baseScenario(),
      });
      const next = appendScenarioSnapshot(history, {
        id: "s1",
        label,
        createdAt: "2026-08-01T00:00:05Z",
        scenario: after,
      });
      expect(next, label).toHaveLength(2);
    }
  });

  it("can produce every declared diff category", () => {
    const base = baseScenario();
    const produced = new Set<ScenarioDiffCategory>(
      durableEdits().flatMap(({ after }) =>
        diffScenarios(base, after).map((entry) => entry.category),
      ),
    );
    // The remaining categories come from the edits the other cases in this file already cover.
    const renamed = { ...base, name: "Renamed" };
    const settings = { ...base, settings: { ...base.settings, currency: "EUR" } };
    const featureRenamed = {
      ...base,
      model: {
        ...base.model,
        features: base.model.features.map((feature, index) =>
          index === 0 ? { ...feature, name: "Renamed feature" } : feature,
        ),
      },
    };
    const design = base.designs.find((entry) => entry.id === base.activeDesignId)!;
    const repriced = {
      ...base,
      designs: base.designs.map((candidate) => ({
        ...candidate,
        tiers: candidate.tiers.map((tier, index) =>
          index === 0 ? { ...tier, price: tier.price + 100 } : tier,
        ),
        addOns: [
          {
            id: "extra",
            name: "Extra",
            price: 99,
            priceMetric: "flat" as const,
            featureIds: ["governance"],
          },
        ],
      })),
    };
    const withCompetitor = {
      ...base,
      competitors: [
        {
          id: "rival",
          name: "Rival",
          price: 900,
          priceMetric: "flat" as const,
          valueBySegment: Object.fromEntries(
            base.model.segments.map((segment) => [segment.id, 800]),
          ),
        },
      ],
    };
    const withMigration = {
      ...base,
      designs: [
        ...base.designs,
        { ...design, id: "proposal", name: "Proposal", discountPolicies: undefined },
      ],
      activeDesignId: "proposal",
      migration: {
        policy: "grandfather" as const,
        incumbentDesignId: design.id,
        base: base.model.segments.map((segment) => ({
          segmentId: segment.id,
          incumbentTierId: design.tiers[0].id,
          baseCount: 50,
          switchingCost: 0,
        })),
      },
    };
    for (const candidate of [
      renamed,
      settings,
      featureRenamed,
      repriced,
      withCompetitor,
      withMigration,
    ]) {
      for (const entry of diffScenarios(base, scenarioSchema.parse(candidate))) {
        produced.add(entry.category);
      }
    }

    const declared: readonly ScenarioDiffCategory[] = [
      "settings",
      "model",
      "segments",
      "features",
      "designs",
      "tiers",
      "addOns",
      "competitors",
      "interactions",
      "usageMetrics",
      "migration",
      "research",
    ];
    // A category no edit can produce is either dead in the type or a field the diff is blind to.
    expect([...produced].sort()).toEqual([...declared].sort());
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
