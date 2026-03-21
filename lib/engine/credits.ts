import {
  fitLognormalBand,
  lognormalCdf,
  lognormalPartialExpectation,
  type LognormalDistribution,
} from "./stats";
import type { UsageBand, UsagePricing } from "./usage";

/**
 * Credit packs, breakage, and outcome pricing — the rest of the hybrid menu (§4.17).
 *
 * §4.15 gave the menu a usage line: an allowance and a per-unit overage rate. That covers
 * classic metered pricing, but it is not how the current generation of hybrid menus is
 * actually sold. Two primitives are missing, and both change what a buyer pays:
 *
 * - **Prepaid credit packs.** The buyer buys a block of units up front and spends it during
 *   the period. The vendor books the whole pack; the buyer consumes some fraction of it. The
 *   difference is **breakage** — revenue with no delivery behind it. Every pricing page that
 *   sells credits is quietly relying on breakage, and almost nobody computes it. Here it is a
 *   number rather than a hope: expected unused units are `E[(packUnits − U)⁺]`, the partial
 *   expectation of the segment's own usage band, and the same lognormal machinery §4.8 already
 *   uses supplies it.
 * - **Outcome-priced lines.** A usage metric whose unit is a *result* — a resolved ticket, a
 *   completed task — rather than a unit of consumption. Structurally it is the same metric; the
 *   distinction is carried explicitly because it changes nothing in the arithmetic and
 *   everything in how the line should be read, and conflating the two silently would let an
 *   outcome line masquerade as a consumption line in the linter's dead-zone check.
 *
 * The screening insight carries over unchanged: an allowance is a fence in usage space exactly
 * as a feature set is a fence in value space, so all of this stays inside the upper-envelope
 * primitive rather than starting a second engine.
 */

/**
 * Re-exported from `usage.ts`, where the metric definition that carries it lives. The kind is
 * declared there so a metric and its unit meaning stay in one place; it is surfaced here because
 * this module is where the distinction earns its keep.
 */
export type { UsageUnitKind } from "./usage";

/**
 * A prepaid block of units. `expiresAtPeriodEnd` is the default and the interesting case —
 * a pack that rolls over indefinitely is a deferred-revenue question, not a pricing one, and
 * carries no breakage.
 */
export interface CreditPack {
  metricId: string;
  packUnits: number;
  packPrice: number;
  /** Rate charged on usage past the pack. Omitted means overage is not sold. */
  overagePerUnit?: number;
  /** Default true: unused units are forfeited at period end. */
  expiresAtPeriodEnd?: boolean;
}

export interface CreditPackReadout {
  metricId: string;
  packUnits: number;
  packPrice: number;
  /** Implied price of a unit inside the pack, for comparison against the overage rate. */
  impliedUnitPrice: number;
  /** `E[(packUnits − U)⁺]` — expected units bought and never used. */
  expectedUnusedUnits: number;
  /** Those units at the pack's own implied price: revenue with nothing delivered behind it. */
  expectedBreakageRevenue: number;
  /** `E[(U − packUnits)⁺]` — expected units past the pack, billed at the overage rate. */
  expectedOverageUnits: number;
  expectedOverageRevenue: number;
  /** What the buyer expects to pay: the pack, plus expected overage. */
  expectedBuyerCost: number;
  /** Probability the buyer exhausts the pack and starts paying overage. */
  probabilityOfOverage: number;
  /** Share of the pack the buyer expects to actually use. */
  utilisation: number;
  /** True when overage costs more per unit than the pack — the cliff a buyer will notice. */
  overageCliff: boolean;
}

const EPSILON = 1e-12;

function assertPack(pack: CreditPack): void {
  if (!(Number.isFinite(pack.packUnits) && pack.packUnits > 0)) {
    throw new RangeError(`Credit pack for “${pack.metricId}” needs a positive unit count.`);
  }
  if (!(Number.isFinite(pack.packPrice) && pack.packPrice >= 0)) {
    throw new RangeError(`Credit pack for “${pack.metricId}” needs a non-negative price.`);
  }
  if (
    pack.overagePerUnit !== undefined &&
    !(Number.isFinite(pack.overagePerUnit) && pack.overagePerUnit >= 0)
  ) {
    throw new RangeError(`Overage rate for “${pack.metricId}” must be non-negative.`);
  }
}

/**
 * The lognormal a segment's usage band implies.
 *
 * Spread comes from P10/P90 through the same `fitLognormalBand` every other uncertain quantity
 * in this engine uses, and the median is pinned to the band's own P50. Where the band satisfies
 * the §4.1 contract `P50 = √(P10·P90)` the two
 * are the same number; where an imported band does not, centering on P50 keeps the pack readout
 * consistent with the metered line in `expectedUsageCost`, which reads P50 directly.
 *
 * A band with a non-positive P10 or P90 has no lognormal fit — `log 0` is not a number — so it
 * degenerates to a point mass at P50 rather than inventing a spread. `null` means the segment is
 * expected to consume nothing at all, which the caller handles separately.
 */
function usageDistribution(band: UsageBand): LognormalDistribution | null {
  if (!(band.p50 > 0)) return null;
  const sigma = band.p10 > 0 && band.p90 > 0 ? fitLognormalBand(band.p10, band.p90).sigma : 0;
  return { mu: Math.log(band.p50), sigma };
}

/**
 * Prices one pack against a segment's own usage band.
 *
 * Breakage is computed on the same distribution as everything else rather than on a second,
 * private model of usage. `E[(k − U)⁺]` follows from the partial expectation by the identity
 * `E[(k − U)⁺] = k·F(k) − E[U · 1{U ≤ k}]`, which needs no new integral.
 */
export function evaluateCreditPack(pack: CreditPack, band: UsageBand): CreditPackReadout {
  assertPack(pack);
  const distribution = usageDistribution(band);
  const belowMass = distribution ? lognormalCdf(pack.packUnits, distribution) : 1;
  const expectedBelow = distribution
    ? lognormalPartialExpectation(0, pack.packUnits, distribution)
    : 0;
  const expectedUnusedUnits = Math.max(0, pack.packUnits * belowMass - expectedBelow);
  const mean = distribution
    ? lognormalPartialExpectation(0, Number.POSITIVE_INFINITY, distribution)
    : 0;
  const expectedOverageUnits = Math.max(0, mean - (pack.packUnits - expectedUnusedUnits));
  const impliedUnitPrice = pack.packUnits > EPSILON ? pack.packPrice / pack.packUnits : 0;
  const expires = pack.expiresAtPeriodEnd ?? true;
  const overagePerUnit = pack.overagePerUnit ?? 0;
  const expectedOverageRevenue = expectedOverageUnits * overagePerUnit;
  return {
    metricId: pack.metricId,
    packUnits: pack.packUnits,
    packPrice: pack.packPrice,
    impliedUnitPrice,
    // A pack that rolls over is not breakage; the units are still owed to the buyer.
    expectedUnusedUnits: expires ? expectedUnusedUnits : 0,
    expectedBreakageRevenue: expires ? expectedUnusedUnits * impliedUnitPrice : 0,
    expectedOverageUnits,
    expectedOverageRevenue,
    expectedBuyerCost: pack.packPrice + expectedOverageRevenue,
    probabilityOfOverage: 1 - belowMass,
    utilisation:
      pack.packUnits > EPSILON
        ? Math.min(1, (pack.packUnits - expectedUnusedUnits) / pack.packUnits)
        : 0,
    overageCliff: overagePerUnit > impliedUnitPrice + EPSILON,
  };
}

export interface HybridLineInput {
  /** Metered lines, as §4.15 already defines them. */
  usagePricing?: readonly UsagePricing[];
  /** Prepaid packs on the same or other metrics. */
  creditPacks?: readonly CreditPack[];
  usageBands: Readonly<Record<string, UsageBand>>;
}

export interface HybridCostSummary {
  /** What the buyer expects to pay above the tier's list price. */
  expectedSurcharge: number;
  /** The breakage inside that surcharge — revenue the vendor keeps for nothing. */
  expectedBreakageRevenue: number;
  /** Overage revenue, separated because it is the part that scales with delivery. */
  expectedOverageRevenue: number;
  packs: readonly CreditPackReadout[];
}

/**
 * Total expected surcharge for one offer's hybrid lines, split so the conservation identity can
 * carry a breakage term of its own. A pack whose metric has no configured band is inert rather
 * than throwing, matching `summarizeUsageCost`'s policy for stale metric references.
 */
export function summarizeHybridCost(input: HybridLineInput): HybridCostSummary {
  const packs: CreditPackReadout[] = [];
  for (const pack of input.creditPacks ?? []) {
    const band = input.usageBands[pack.metricId];
    if (!band) continue;
    packs.push(evaluateCreditPack(pack, band));
  }
  const expectedSurcharge = packs.reduce((total, pack) => total + pack.expectedBuyerCost, 0);
  return {
    expectedSurcharge,
    expectedBreakageRevenue: packs.reduce((total, pack) => total + pack.expectedBreakageRevenue, 0),
    expectedOverageRevenue: packs.reduce((total, pack) => total + pack.expectedOverageRevenue, 0),
    packs,
  };
}

export interface AllowanceDeadZone {
  metricId: string;
  /** The allowance nobody in this segment is expected to reach. */
  includedUnits: number;
  /** Probability the segment uses more than the allowance. */
  probabilityOfExceeding: number;
}

/**
 * An allowance so far above a segment's usage that it never binds is not a fence — it is a
 * number on a pricing page doing nothing. This finds those, so the menu can be told that one
 * of its screens is inert for this segment.
 */
export function allowanceDeadZones(
  lines: readonly UsagePricing[],
  bands: Readonly<Record<string, UsageBand>>,
  threshold = 0.05,
): AllowanceDeadZone[] {
  const zones: AllowanceDeadZone[] = [];
  for (const line of lines) {
    const included = line.includedUnits ?? 0;
    if (included <= 0) continue;
    const band = bands[line.metricId];
    if (!band) continue;
    const distribution = usageDistribution(band);
    const exceeding = distribution ? 1 - lognormalCdf(included, distribution) : 0;
    if (exceeding < threshold) {
      zones.push({
        metricId: line.metricId,
        includedUnits: included,
        probabilityOfExceeding: exceeding,
      });
    }
  }
  return zones;
}
