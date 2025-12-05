/**
 * @spec §4.15 usage-based pricing (extension). A tier or add-on may attach a
 * usage line: base list price plus a per-unit charge on a named metric. The
 * segment carries an expected-usage band per metric (median = P50). The engine
 * summarizes each buyer's monthly usage bill to its per-segment expected value
 * and folds that into the offer's `effectivePrice`, keeping the envelope
 * primitive (§4.2) intact and the additive model (§4.1) unchanged when no
 * usage pricing is configured. This is deliberately a per-segment expected-cost
 * approximation, not a per-buyer joint distribution over usage and ε: the
 * `local-cost` model states the assumption explicitly rather than hiding it.
 *
 * Design rationale (D-40, §15 Batch 3):
 * - Backwards-compatible extension. Existing scenarios that omit
 *   `usagePricing` and `usageBands` compute a byte-identical effective price,
 *   so every existing test and template continues to hold.
 * - The `includedUnits` free allowance is subtracted before multiplying; a
 *   segment whose median usage is at or below the allowance pays no usage
 *   surcharge, matching how billing pages read to buyers.
 * - The effective price is floored at zero, mirroring the envelope contract in
 *   `offers.ts`: nothing anywhere in the app can produce a negative price.
 */

export interface UsageMetricDefinition {
  id: string;
  name: string;
  /** Free-form label shown in UI: "API calls", "GB egress", … */
  unitLabel: string;
}

/**
 * Segment-level expected monthly usage of one metric. Base is `p50`; `p10` and
 * `p90` bound the Monte Carlo band used by §4.8. All three must be positive
 * finite numbers ordered P10 ≤ P50 ≤ P90, matching the WTP/prospect contract.
 */
export interface UsageBand {
  p10: number;
  p50: number;
  p90: number;
}

/**
 * A per-unit usage line on a tier or add-on. `perUnitPrice` is $/unit/month
 * (flat regardless of seat count — usage scales the volume, not the seat). An
 * optional free allowance `includedUnits ≥ 0` reduces the billed volume.
 */
export interface UsagePricing {
  metricId: string;
  perUnitPrice: number;
  includedUnits?: number;
}

export interface ExpectedUsageCostInput {
  usagePricing: UsagePricing;
  band: UsageBand;
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
}

function assertBand(band: UsageBand, metricId: string): void {
  assertFiniteNonNegative(band.p10, `Usage band P10 for metric “${metricId}”`);
  assertFiniteNonNegative(band.p50, `Usage band P50 for metric “${metricId}”`);
  assertFiniteNonNegative(band.p90, `Usage band P90 for metric “${metricId}”`);
  if (!(band.p10 <= band.p50 && band.p50 <= band.p90)) {
    throw new RangeError(`Usage band for metric “${metricId}” must be P10 ≤ P50 ≤ P90.`);
  }
}

/**
 * Expected monthly cost of one usage line at a given median usage. The billed
 * volume is `max(0, expectedUsage − includedUnits)`; multiplying by the per-unit
 * rate yields the surcharge. Returns 0 when there is no usage above the
 * allowance, so a "usage tier with a comfortable free allowance" reads to the
 * envelope as its base list price alone.
 */
export function expectedUsageCost(input: ExpectedUsageCostInput): number {
  const { usagePricing, band } = input;
  assertFiniteNonNegative(usagePricing.perUnitPrice, "Usage per-unit price");
  if (usagePricing.includedUnits !== undefined) {
    assertFiniteNonNegative(usagePricing.includedUnits, "Included units");
  }
  assertBand(band, usagePricing.metricId);
  const billed = Math.max(0, band.p50 - (usagePricing.includedUnits ?? 0));
  return billed * usagePricing.perUnitPrice;
}

export interface UsageCostSummaryInput {
  usagePricing?: readonly UsagePricing[];
  usageBands: Readonly<Record<string, UsageBand>>;
}

/**
 * Total expected usage surcharge across every usage line on one offer. A line
 * whose metric has no band configured is inert (returns 0 for that line) rather
 * than throwing — a stale metric reference on a template scenario mirrors the
 * `interactionValueForFeatures` policy in `offers.ts` for the same reason: keep
 * imports composable without hidden footguns.
 */
export function summarizeUsageCost(input: UsageCostSummaryInput): number {
  const lines = input.usagePricing ?? [];
  if (lines.length === 0) return 0;
  return lines.reduce((total, line) => {
    const band = input.usageBands[line.metricId];
    if (!band) return total;
    return total + expectedUsageCost({ usagePricing: line, band });
  }, 0);
}
