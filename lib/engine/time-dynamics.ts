/**
 * @spec §4.16 Trials & time dynamics (extension).
 *
 * The engine lifts the §4.3 single-period screening readout into a multi-period
 * one that captures a paid trial and month-over-month retention. It is
 * deliberately deterministic — trial conversion and retention are point
 * assumptions per segment, not a stochastic churn hazard — matching the
 * §4.1/§4.8 split between within-segment heterogeneity (ε) and assumption
 * uncertainty (Monte Carlo bands). Aggregate KPIs sum monthly MRR over
 * segments; the extension never mutates §4.2 shares or §4.3 waterfall terms
 * for the acquisition month itself.
 *
 * Zero-default behavior (T-TIME-01): `trialLength = 0`, `trialConversion = 1`,
 * `monthlyRetention = 1`, `contractTerm = 'monthly'`, `periods = 0` collapses
 * to the §4.3 readout byte-identical to the pre-extension engine.
 */

export type ContractTerm = "monthly" | "annual";

export interface SegmentTimeDynamics {
  id: string;
  /** Whole months of paid trial before conversion; 0 = no trial. */
  trialLength: number;
  /** Probability a paid selector converts at trial-end; 1 = no leakage. */
  trialConversion: number;
  /** Month-over-month retention among converted buyers; 1 = no churn. */
  monthlyRetention: number;
  contractTerm: ContractTerm;
  /** Monthly MRR from a converted buyer at post-trial (§4.3 readout). */
  monthlyMrr: number;
  /** Average revenue per converted account (used for LTV). */
  arpa: number;
  /** Acquisition-month buyer count (before trial conversion). */
  paidSelectors: number;
}

export interface TimeDynamicsInput {
  segments: readonly SegmentTimeDynamics[];
  /** Horizon (months) beyond `t = 0`. `periods = 0` returns just the readout at t=0. */
  periods: number;
}

export interface SegmentPeriodPoint {
  period: number;
  mrr: number;
  activeBuyers: number;
}

export interface SegmentTimeReadout {
  id: string;
  points: readonly SegmentPeriodPoint[];
  cumulativeRevenue: number;
  /** Truncated LTV over the horizon per acquired paid selector (before trial). */
  ltvPerAcquired: number;
}

export interface TimeDynamicsReadout {
  segments: readonly SegmentTimeReadout[];
  points: readonly SegmentPeriodPoint[];
  cumulativeRevenue: number;
  periods: number;
}

function assertUnit(value: number, name: string): void {
  if (!(Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError(`${name} must be a finite number in [0, 1].`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
}

function isRetentionMonth(period: number, contract: ContractTerm, trialLength: number): boolean {
  if (contract === "monthly") return true;
  return (period - trialLength) % 12 === 0 && period > trialLength;
}

/**
 * Multi-period MRR for one segment. Under a monthly contract, retention
 * compounds every month past the trial; under annual, retention applies once
 * per twelve-month renewal so the intra-year MRR is flat and drops at the
 * anniversary. Annual bills up front commercially, but for the studio's
 * economics readout the annualized revenue is spread evenly across the twelve
 * months of the term — v1 does not model up-front cash timing.
 */
function projectSegment(input: SegmentTimeDynamics, periods: number): SegmentTimeReadout {
  assertNonNegativeInteger(input.trialLength, `trialLength for segment “${input.id}”`);
  assertUnit(input.trialConversion, `trialConversion for segment “${input.id}”`);
  assertUnit(input.monthlyRetention, `monthlyRetention for segment “${input.id}”`);
  assertFiniteNonNegative(input.monthlyMrr, `monthlyMrr for segment “${input.id}”`);
  assertFiniteNonNegative(input.arpa, `arpa for segment “${input.id}”`);
  assertFiniteNonNegative(input.paidSelectors, `paidSelectors for segment “${input.id}”`);

  const points: SegmentPeriodPoint[] = [];
  const convertedBuyers = input.paidSelectors * input.trialConversion;
  let retentionFactor = 1;
  let cumulativeRevenue = 0;

  for (let period = 0; period <= periods; period += 1) {
    if (period < input.trialLength) {
      points.push({ period, mrr: 0, activeBuyers: input.paidSelectors });
      continue;
    }
    if (period === input.trialLength) {
      const mrr = convertedBuyers > 0 ? input.monthlyMrr : 0;
      points.push({ period, mrr, activeBuyers: convertedBuyers });
      cumulativeRevenue += mrr;
      continue;
    }
    if (isRetentionMonth(period, input.contractTerm, input.trialLength)) {
      retentionFactor *= input.monthlyRetention;
    }
    const activeBuyers = convertedBuyers * retentionFactor;
    const mrr =
      convertedBuyers > 0 ? input.monthlyMrr * (retentionFactor === 0 ? 0 : retentionFactor) : 0;
    points.push({ period, mrr, activeBuyers });
    cumulativeRevenue += mrr;
  }

  const ltvPerAcquired = input.paidSelectors > 0 ? cumulativeRevenue / input.paidSelectors : 0;

  return { id: input.id, points, cumulativeRevenue, ltvPerAcquired };
}

function aggregatePoints(
  segments: readonly SegmentTimeReadout[],
  periods: number,
): SegmentPeriodPoint[] {
  const rows: SegmentPeriodPoint[] = [];
  for (let period = 0; period <= periods; period += 1) {
    let mrr = 0;
    let activeBuyers = 0;
    for (const segment of segments) {
      const point = segment.points[period];
      if (!point) continue;
      mrr += point.mrr;
      activeBuyers += point.activeBuyers;
    }
    rows.push({ period, mrr, activeBuyers });
  }
  return rows;
}

/**
 * Project a scenario's per-segment monthly readouts over `periods` months. A
 * `periods = 0` horizon returns just the acquisition month, which — under the
 * zero-default trial/retention values — equals the §4.3 readout byte-identical
 * to the pre-extension engine. The scenario adapter is responsible for
 * supplying `paidSelectors`, `monthlyMrr`, and `arpa` per segment from
 * `computeScenarioEconomics`; this engine stays pure.
 */
export function projectTimeDynamics(input: TimeDynamicsInput): TimeDynamicsReadout {
  assertNonNegativeInteger(input.periods, "periods");
  const segments = input.segments.map((segment) => projectSegment(segment, input.periods));
  const points = aggregatePoints(segments, input.periods);
  const cumulativeRevenue = segments.reduce(
    (total, segment) => total + segment.cumulativeRevenue,
    0,
  );
  return { segments, points, cumulativeRevenue, periods: input.periods };
}
