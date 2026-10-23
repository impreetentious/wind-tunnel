/**
 * Structural diff between two Scenario snapshots for a "what changed?" readout.
 * The diff intentionally lives in `lib/state/` (not the engine): it consumes
 * the durable Zod-parsed shape only and never touches the pricing math. Two
 * kinds of entries appear:
 *
 * - Value entries — a named path changed (feature.name, tier.price, ...).
 * - Collection entries — a segment/tier/design/competitor was added or removed.
 *
 * Entries are stable-sorted by category then path so an unchanged scenario
 * always produces `[]` and a re-run of the same edit produces byte-identical
 * output. This is what makes the diff safe to render in the Share/Decision
 * Record: no jitter across renders.
 */

import type { Scenario } from "./schemas";

export type ScenarioDiffCategory =
  | "settings"
  | "model"
  | "segments"
  | "features"
  | "designs"
  | "tiers"
  | "addOns"
  | "competitors"
  | "interactions"
  | "usageMetrics"
  | "migration"
  | "research";

export type ScenarioDiffKind = "added" | "removed" | "changed";

export interface ScenarioDiffEntry {
  category: ScenarioDiffCategory;
  kind: ScenarioDiffKind;
  path: string;
  before?: string;
  after?: string;
}

function fmt(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface PushInput {
  category: ScenarioDiffCategory;
  kind: ScenarioDiffKind;
  path: string;
  before?: unknown;
  after?: unknown;
}

function push(entries: ScenarioDiffEntry[], entry: PushInput): void {
  entries.push({
    category: entry.category,
    kind: entry.kind,
    path: entry.path,
    before: entry.before !== undefined ? fmt(entry.before) : undefined,
    after: entry.after !== undefined ? fmt(entry.after) : undefined,
  });
}

function diffSettings(a: Scenario["settings"], b: Scenario["settings"], out: ScenarioDiffEntry[]) {
  for (const key of Object.keys({ ...a, ...b }) as (keyof Scenario["settings"])[]) {
    if (a[key] !== b[key]) {
      push(out, {
        category: "settings",
        kind: "changed",
        path: `settings.${String(key)}`,
        before: a[key],
        after: b[key],
      });
    }
  }
}

function diffCollectionByIds<T extends { id: string; name?: string }>(
  before: readonly T[],
  after: readonly T[],
  category: ScenarioDiffCategory,
  pathPrefix: string,
  itemDiff: (b: T, a: T, path: string, out: ScenarioDiffEntry[]) => void,
  out: ScenarioDiffEntry[],
) {
  const beforeMap = new Map(before.map((entry) => [entry.id, entry]));
  const afterMap = new Map(after.map((entry) => [entry.id, entry]));
  for (const id of [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort()) {
    const b = beforeMap.get(id);
    const a = afterMap.get(id);
    const path = `${pathPrefix}.${id}`;
    if (!b && a) {
      push(out, { category, kind: "added", path, after: a.name ?? a.id });
    } else if (b && !a) {
      push(out, { category, kind: "removed", path, before: b.name ?? b.id });
    } else if (b && a) {
      itemDiff(b, a, path, out);
    }
  }
}

function diffFeature(
  before: Scenario["model"]["features"][number],
  after: Scenario["model"]["features"][number],
  path: string,
  out: ScenarioDiffEntry[],
) {
  if (before.name !== after.name) {
    push(out, {
      category: "features",
      kind: "changed",
      path: `${path}.name`,
      before: before.name,
      after: after.name,
    });
  }
}

function diffSegment(
  before: Scenario["model"]["segments"][number],
  after: Scenario["model"]["segments"][number],
  path: string,
  out: ScenarioDiffEntry[],
) {
  if (before.name !== after.name) {
    push(out, {
      category: "segments",
      kind: "changed",
      path: `${path}.name`,
      before: before.name,
      after: after.name,
    });
  }
  if (before.seatCount !== after.seatCount) {
    push(out, {
      category: "segments",
      kind: "changed",
      path: `${path}.seatCount`,
      before: before.seatCount,
      after: after.seatCount,
    });
  }
  if (before.withinSegmentSigma !== after.withinSegmentSigma) {
    push(out, {
      category: "segments",
      kind: "changed",
      path: `${path}.withinSegmentSigma`,
      before: before.withinSegmentSigma,
      after: after.withinSegmentSigma,
    });
  }
  for (const key of ["p10", "p50", "p90"] as const) {
    if (before.prospectBand[key] !== after.prospectBand[key]) {
      push(out, {
        category: "segments",
        kind: "changed",
        path: `${path}.prospectBand.${key}`,
        before: before.prospectBand[key],
        after: after.prospectBand[key],
      });
    }
    if (before.wtpBand[key] !== after.wtpBand[key]) {
      push(out, {
        category: "segments",
        kind: "changed",
        path: `${path}.wtpBand.${key}`,
        before: before.wtpBand[key],
        after: after.wtpBand[key],
      });
    }
  }
  for (const featureId of Object.keys({
    ...before.featureAllocation,
    ...after.featureAllocation,
  }).sort()) {
    if (before.featureAllocation[featureId] !== after.featureAllocation[featureId]) {
      push(out, {
        category: "segments",
        kind: "changed",
        path: `${path}.allocation.${featureId}`,
        before: before.featureAllocation[featureId],
        after: after.featureAllocation[featureId],
      });
    }
  }
  // §4.15 usage bands and §4.16 trial/retention move simulated revenue without touching any
  // field above, so a diff that skipped them would report "no change" on a real repricing —
  // the same reason `diffTier` carries metering.
  for (const metricId of Object.keys({
    ...before.usageBands,
    ...after.usageBands,
  }).sort()) {
    for (const key of ["p10", "p50", "p90"] as const) {
      const b = before.usageBands?.[metricId]?.[key];
      const a = after.usageBands?.[metricId]?.[key];
      if (b !== a) {
        push(out, {
          category: "segments",
          kind: "changed",
          path: `${path}.usageBands.${metricId}.${key}`,
          before: b,
          after: a,
        });
      }
    }
  }
  for (const key of [
    "trialLengthMonths",
    "trialConversion",
    "monthlyRetention",
    "contractTerm",
  ] as const) {
    const b = before.timeDynamics?.[key];
    const a = after.timeDynamics?.[key];
    if (b !== a) {
      push(out, {
        category: "segments",
        kind: "changed",
        path: `${path}.timeDynamics.${key}`,
        before: b,
        after: a,
      });
    }
  }
}

/**
 * §4.1.1 pair interactions, keyed by the unordered pair rather than by array position, so
 * reordering the list is not a change and editing one pair's adjustment is.
 */
function diffInteractions(
  before: Scenario["model"]["interactions"],
  after: Scenario["model"]["interactions"],
  out: ScenarioDiffEntry[],
) {
  const key = (interaction: Scenario["model"]["interactions"][number]) =>
    [...interaction.featureIds].sort().join("+");
  const beforeByPair = new Map(before.map((entry) => [key(entry), entry]));
  const afterByPair = new Map(after.map((entry) => [key(entry), entry]));
  for (const pair of [...new Set([...beforeByPair.keys(), ...afterByPair.keys()])].sort()) {
    const b = beforeByPair.get(pair);
    const a = afterByPair.get(pair);
    const path = `interactions.${pair}`;
    if (!b || !a) {
      push(out, {
        category: "interactions",
        kind: b ? "removed" : "added",
        path,
        before: b?.valueFraction,
        after: a?.valueFraction,
      });
      continue;
    }
    for (const field of ["valueFraction", "note"] as const) {
      if (b[field] !== a[field]) {
        push(out, {
          category: "interactions",
          kind: "changed",
          path: `${path}.${field}`,
          before: b[field],
          after: a[field],
        });
      }
    }
  }
}

/** §4.15/§4.17 metric catalog. `unitKind` is diffed because U3 reads consumption and outcome
 * lines differently, so flipping it changes which findings the linter reports. */
function diffUsageMetric(
  before: Scenario["model"]["usageMetrics"][number],
  after: Scenario["model"]["usageMetrics"][number],
  path: string,
  out: ScenarioDiffEntry[],
) {
  for (const field of ["name", "unitLabel", "unitKind"] as const) {
    if (before[field] !== after[field]) {
      push(out, {
        category: "usageMetrics",
        kind: "changed",
        path: `${path}.${field}`,
        before: before[field],
        after: after[field],
      });
    }
  }
}

/**
 * §4.19 discount policies, keyed by the tier they govern. A policy is design state that changes
 * achieved MRR and the P-family linter findings, so it belongs in the structural diff even
 * though it never touches a list price.
 */
function diffDiscountPolicies(
  before: Scenario["designs"][number],
  after: Scenario["designs"][number],
  path: string,
  out: ScenarioDiffEntry[],
) {
  const byTier = (design: Scenario["designs"][number]) =>
    new Map((design.discountPolicies ?? []).map((policy) => [policy.tierId, policy]));
  const beforeByTier = byTier(before);
  const afterByTier = byTier(after);
  const describe = (policy: NonNullable<Scenario["designs"][number]["discountPolicies"]>[number]) =>
    `floor ${policy.floorFraction}`;
  for (const tierId of [...new Set([...beforeByTier.keys(), ...afterByTier.keys()])].sort()) {
    const b = beforeByTier.get(tierId);
    const a = afterByTier.get(tierId);
    const policyPath = `${path}.discountPolicies.${tierId}`;
    if (!b || !a) {
      push(out, {
        category: "designs",
        kind: b ? "removed" : "added",
        path: policyPath,
        before: b ? describe(b) : undefined,
        after: a ? describe(a) : undefined,
      });
      continue;
    }
    if (b.floorFraction !== a.floorFraction) {
      push(out, {
        category: "designs",
        kind: "changed",
        path: `${policyPath}.floorFraction`,
        before: b.floorFraction,
        after: a.floorFraction,
      });
    }
    for (const segmentId of Object.keys({
      ...b.hitRateBySegment,
      ...a.hitRateBySegment,
    }).sort()) {
      const beforeRate = b.hitRateBySegment?.[segmentId];
      const afterRate = a.hitRateBySegment?.[segmentId];
      if (beforeRate !== afterRate) {
        push(out, {
          category: "designs",
          kind: "changed",
          path: `${policyPath}.hitRate.${segmentId}`,
          before: beforeRate,
          after: afterRate,
        });
      }
    }
    const bands = (policy: typeof b) =>
      (policy.approvalBands ?? [])
        .map((band) => `${band.approver} ≤ ${band.upToFraction}`)
        .sort()
        .join(" · ");
    if (bands(b) !== bands(a)) {
      push(out, {
        category: "designs",
        kind: "changed",
        path: `${policyPath}.approvalBands`,
        before: bands(b) || "none",
        after: bands(a) || "none",
      });
    }
  }
}

/**
 * Research artifacts, summarized by study shape rather than row by row: a respondent-level diff
 * of a 1,000-row PSM study is noise, while "the study arrived, grew, or was replaced" is the
 * change a reader of the history needs. Fielding evidence is a scenario change like any other.
 */
function diffResearch(
  before: Scenario["research"],
  after: Scenario["research"],
  out: ScenarioDiffEntry[],
) {
  const labels = {
    vanWestendorp: (study: NonNullable<Scenario["research"]["vanWestendorp"]>) =>
      `${study.source}, ${study.responses.length} responses`,
    conjoint: (study: NonNullable<Scenario["research"]["conjoint"]>) =>
      `${study.attributes.length} attributes, ${study.tasks.length} tasks, ${study.observations.length} observations${study.numericPrice ? ", numeric price" : ""}`,
    maxDiff: (study: NonNullable<Scenario["research"]["maxDiff"]>) =>
      `${study.items.length} items, ${study.tasks.length} tasks, ${study.responses.length} responses`,
  } as const;

  for (const key of ["conjoint", "maxDiff", "vanWestendorp"] as const) {
    const b = before[key];
    const a = after[key];
    if (!b && !a) continue;
    // A widening `labels` lookup would lose the per-study type; resolve it per branch instead.
    const label = (study: NonNullable<typeof b> | NonNullable<typeof a>) =>
      (labels[key] as (value: typeof study) => string)(study);
    if (!b || !a) {
      push(out, {
        category: "research",
        kind: b ? "removed" : "added",
        path: `research.${key}`,
        before: b ? label(b) : undefined,
        after: a ? label(a) : undefined,
      });
      continue;
    }
    if (label(b) !== label(a)) {
      push(out, {
        category: "research",
        kind: "changed",
        path: `research.${key}`,
        before: label(b),
        after: label(a),
      });
    }
  }
}

function diffTier(
  before: Scenario["designs"][number]["tiers"][number],
  after: Scenario["designs"][number]["tiers"][number],
  path: string,
  out: ScenarioDiffEntry[],
) {
  const fields: (keyof typeof before)[] = ["name", "price", "priceMetric"];
  for (const field of fields) {
    if (before[field] !== after[field]) {
      push(out, {
        category: "tiers",
        kind: "changed",
        path: `${path}.${String(field)}`,
        before: before[field],
        after: after[field],
      });
    }
  }
  if (before.featureIds.join(",") !== after.featureIds.join(",")) {
    push(out, {
      category: "tiers",
      kind: "changed",
      path: `${path}.featureIds`,
      before: [...before.featureIds].sort().join(", "),
      after: [...after.featureIds].sort().join(", "),
    });
  }
  // §4.15 metered lines and §4.17 packs move a tier's effective price without touching its
  // list price, so a diff that skipped them would show "no change" on a real repricing.
  const meteringLabel = (offer: typeof before) =>
    [
      ...(offer.usagePricing ?? []).map(
        (line) => `${line.metricId} @ ${line.perUnitPrice}/unit after ${line.includedUnits ?? 0}`,
      ),
      ...(offer.creditPacks ?? []).map(
        (pack) =>
          `${pack.metricId} pack ${pack.packUnits} @ ${pack.packPrice}${
            pack.overagePerUnit === undefined ? "" : ` +${pack.overagePerUnit}/overage`
          }${pack.expiresAtPeriodEnd === false ? " (rolls over)" : ""}`,
      ),
    ]
      .sort()
      .join(" · ");
  if (meteringLabel(before) !== meteringLabel(after)) {
    push(out, {
      category: "tiers",
      kind: "changed",
      path: `${path}.metering`,
      before: meteringLabel(before) || "none",
      after: meteringLabel(after) || "none",
    });
  }
}

function diffDesign(
  before: Scenario["designs"][number],
  after: Scenario["designs"][number],
  path: string,
  out: ScenarioDiffEntry[],
) {
  if (before.name !== after.name) {
    push(out, {
      category: "designs",
      kind: "changed",
      path: `${path}.name`,
      before: before.name,
      after: after.name,
    });
  }
  diffCollectionByIds(before.tiers, after.tiers, "tiers", `${path}.tiers`, diffTier, out);
  diffCollectionByIds(before.addOns, after.addOns, "addOns", `${path}.addOns`, diffTier, out);
  diffDiscountPolicies(before, after, path, out);
}

function diffCompetitor(
  before: Scenario["competitors"][number],
  after: Scenario["competitors"][number],
  path: string,
  out: ScenarioDiffEntry[],
) {
  if (before.name !== after.name) {
    push(out, {
      category: "competitors",
      kind: "changed",
      path: `${path}.name`,
      before: before.name,
      after: after.name,
    });
  }
  if (before.price !== after.price) {
    push(out, {
      category: "competitors",
      kind: "changed",
      path: `${path}.price`,
      before: before.price,
      after: after.price,
    });
  }
  if (before.priceMetric !== after.priceMetric) {
    push(out, {
      category: "competitors",
      kind: "changed",
      path: `${path}.priceMetric`,
      before: before.priceMetric,
      after: after.priceMetric,
    });
  }
  for (const segmentId of Object.keys({
    ...before.valueBySegment,
    ...after.valueBySegment,
  }).sort()) {
    if (before.valueBySegment[segmentId] !== after.valueBySegment[segmentId]) {
      push(out, {
        category: "competitors",
        kind: "changed",
        path: `${path}.valueBySegment.${segmentId}`,
        before: before.valueBySegment[segmentId],
        after: after.valueBySegment[segmentId],
      });
    }
  }
}

/**
 * §4.18 installed base. The base rows are keyed by segment rather than by a row id, so a
 * segment gaining or losing its base reads as added/removed and a resized one as changed.
 */
function diffMigration(
  before: Scenario["migration"],
  after: Scenario["migration"],
  out: ScenarioDiffEntry[],
) {
  if (!before && !after) return;
  if (!before || !after) {
    push(out, {
      category: "migration",
      kind: before ? "removed" : "added",
      path: "migration",
      before: before ? `${before.policy} from ${before.incumbentDesignId}` : undefined,
      after: after ? `${after.policy} from ${after.incumbentDesignId}` : undefined,
    });
    return;
  }
  for (const key of ["policy", "incumbentDesignId"] as const) {
    if (before[key] !== after[key]) {
      push(out, {
        category: "migration",
        kind: "changed",
        path: `migration.${key}`,
        before: before[key],
        after: after[key],
      });
    }
  }
  const beforeRows = new Map(before.base.map((row) => [row.segmentId, row]));
  const afterRows = new Map(after.base.map((row) => [row.segmentId, row]));
  for (const segmentId of [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort()) {
    const b = beforeRows.get(segmentId);
    const a = afterRows.get(segmentId);
    const path = `migration.base.${segmentId}`;
    if (!b || !a) {
      push(out, {
        category: "migration",
        kind: b ? "removed" : "added",
        path,
        before: b?.baseCount,
        after: a?.baseCount,
      });
      continue;
    }
    for (const key of ["incumbentTierId", "baseCount", "switchingCost"] as const) {
      if (b[key] !== a[key]) {
        push(out, {
          category: "migration",
          kind: "changed",
          path: `${path}.${key}`,
          before: b[key],
          after: a[key],
        });
      }
    }
  }
}

/**
 * Compute the structural diff between two Scenario snapshots. Returns a list
 * ordered by category then path — an unchanged scenario always yields `[]`,
 * so callers can render "no changes since last save" without further logic.
 */
export function diffScenarios(before: Scenario, after: Scenario): readonly ScenarioDiffEntry[] {
  const out: ScenarioDiffEntry[] = [];
  if (before.name !== after.name) {
    push(out, {
      category: "model",
      kind: "changed",
      path: "name",
      before: before.name,
      after: after.name,
    });
  }
  if (before.status !== after.status) {
    push(out, {
      category: "model",
      kind: "changed",
      path: "status",
      before: before.status,
      after: after.status,
    });
  }
  if (before.activeDesignId !== after.activeDesignId) {
    push(out, {
      category: "designs",
      kind: "changed",
      path: "activeDesignId",
      before: before.activeDesignId,
      after: after.activeDesignId,
    });
  }
  diffSettings(before.settings, after.settings, out);
  diffCollectionByIds(
    before.model.features,
    after.model.features,
    "features",
    "features",
    diffFeature,
    out,
  );
  diffCollectionByIds(
    before.model.segments,
    after.model.segments,
    "segments",
    "segments",
    diffSegment,
    out,
  );
  diffInteractions(before.model.interactions, after.model.interactions, out);
  diffCollectionByIds(
    before.model.usageMetrics,
    after.model.usageMetrics,
    "usageMetrics",
    "usageMetrics",
    diffUsageMetric,
    out,
  );
  diffCollectionByIds(before.designs, after.designs, "designs", "designs", diffDesign, out);
  diffMigration(before.migration, after.migration, out);
  diffResearch(before.research, after.research, out);
  diffCollectionByIds(
    before.competitors,
    after.competitors,
    "competitors",
    "competitors",
    diffCompetitor,
    out,
  );
  out.sort((left, right) => {
    const category = compareStrings(left.category, right.category);
    if (category !== 0) return category;
    const kind = compareStrings(left.kind, right.kind);
    if (kind !== 0) return kind;
    return compareStrings(left.path, right.path);
  });
  return out;
}

/**
 * Diff two designs of the *same* scenario against each other — the current packaging against
 * the proposal that would replace it (§4.18).
 *
 * `diffScenarios` compares designs by id, so two designs that both exist read as one added and
 * one removed rather than as a change. Repricing is the case where that is exactly the wrong
 * answer: the whole question is what moved between them. This ignores the id mismatch and
 * reports the tier-by-tier delta for the version-history view.
 *
 * Tiers and add-ons are matched by id across the two designs, so a proposal that renames or
 * reprices a tier reads as a change while one that introduces a genuinely new tier reads as an
 * addition. Entries are sorted the same way `diffScenarios` sorts, so the two are renderable by
 * one component.
 */
export function diffDesignPair(
  incumbent: Scenario["designs"][number],
  proposed: Scenario["designs"][number],
): readonly ScenarioDiffEntry[] {
  const out: ScenarioDiffEntry[] = [];
  if (incumbent.name !== proposed.name) {
    push(out, {
      category: "designs",
      kind: "changed",
      path: "design.name",
      before: incumbent.name,
      after: proposed.name,
    });
  }
  diffCollectionByIds(incumbent.tiers, proposed.tiers, "tiers", "tiers", diffTier, out);
  diffCollectionByIds(incumbent.addOns, proposed.addOns, "addOns", "addOns", diffTier, out);
  out.sort((left, right) => {
    const category = compareStrings(left.category, right.category);
    if (category !== 0) return category;
    const kind = compareStrings(left.kind, right.kind);
    if (kind !== 0) return kind;
    return compareStrings(left.path, right.path);
  });
  return out;
}

/**
 * A named snapshot for the version-history UI. Snapshots are opaque — the
 * store keeps them in-memory for the current session; localStorage
 * persistence of the version list is the caller's decision (typically the
 * autosave layer).
 */
export interface ScenarioSnapshot {
  id: string;
  label: string;
  createdAt: string;
  scenario: Scenario;
}

/**
 * Append a snapshot to a version list, keeping the newest first and capping
 * at `maxEntries` (defaults to 20 to bound memory). Two snapshots whose
 * scenario data compares equal by `diffScenarios(before, after) === []` are
 * treated as a no-op — a rapid string of unchanged saves does not fill the
 * history with duplicates.
 */
export function appendScenarioSnapshot(
  history: readonly ScenarioSnapshot[],
  snapshot: ScenarioSnapshot,
  maxEntries = 20,
): readonly ScenarioSnapshot[] {
  const last = history[0];
  if (last && diffScenarios(last.scenario, snapshot.scenario).length === 0) {
    return history;
  }
  return [snapshot, ...history].slice(0, maxEntries);
}
