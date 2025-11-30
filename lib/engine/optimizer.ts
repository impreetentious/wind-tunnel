import { simulateEconomics, sweepTierPrice } from "./economics";
import { expandOffers } from "./offers";
import { mulberry32 } from "./montecarlo";
import type {
  EconomicsInput,
  PriceMetric,
  PriceSweepSegmentInput,
  TierPriceSweepInput,
} from "./types";

export interface OptimizerTier {
  tierId: string;
  currentPrice: number;
  priceMetric: PriceMetric;
}

export interface JointOptimizerInput {
  /** Per-segment inputs, in the same contract used by tier price sweeps. */
  segments: readonly PriceSweepSegmentInput[];
  /** The tiers to optimize; every tier ID must be present in every segment's expansion. */
  tiers: readonly OptimizerTier[];
  /** Seed for perturbation-based multi-start; determinism relies on this. */
  seed: number;
  /** Random-perturbation multi-start count (default 4). */
  starts?: number;
  /**
   * Coordinate-descent cycle cap per start. Each cycle sweeps every tier once,
   * picking that tier's best price on the current menu. Default 4.
   */
  maxCycles?: number;
  /**
   * Perturbation half-width around each tier's current price when generating
   * a new start (default 0.4 = ±40%). The very first start always uses the
   * unperturbed current prices verbatim so the baseline is included.
   */
  perturbationRatio?: number;
}

export interface OptimizerTierPrice {
  tierId: string;
  price: number;
}

export interface OptimizerCandidate {
  startIndex: number;
  startPrices: readonly OptimizerTierPrice[];
  finalPrices: readonly OptimizerTierPrice[];
  finalMrr: number;
  cyclesRun: number;
  improvedFromStart: boolean;
}

export type JointOptimizerStatus = "localOptimum" | "noImprovement";

export interface JointOptimizerResult {
  baselineMrr: number;
  bestMrr: number;
  bestPrices: readonly OptimizerTierPrice[];
  candidates: readonly OptimizerCandidate[];
  status: JointOptimizerStatus;
  /** Required "local search, not truth" framing (§4.14 / D-07 / D-24). */
  disclosure: string;
  /** Set only when status = localOptimum. Positive; measured in MRR units. */
  mrrLift?: number;
}

const DISCLOSURE =
  "Local coordinate-descent search under the current assumptions; not a global " +
  "optimum. Read alongside per-tier sweeps and the sensitivity tornado — those " +
  "remain the primary reading.";

function assertValidInput(input: JointOptimizerInput): void {
  if (input.tiers.length === 0) {
    throw new RangeError("Joint optimizer needs at least one tier to search over.");
  }
  if (input.segments.length === 0) {
    throw new RangeError("Joint optimizer needs at least one segment.");
  }
  for (const tier of input.tiers) {
    if (!tier.tierId) throw new RangeError("Every optimizer tier needs a non-empty ID.");
    if (!(Number.isFinite(tier.currentPrice) && tier.currentPrice >= 0)) {
      throw new RangeError(
        `Optimizer tier “${tier.tierId}” needs a finite, non-negative current price.`,
      );
    }
    for (const segment of input.segments) {
      const found = segment.offerExpansion.tiers.find((candidate) => candidate.id === tier.tierId);
      if (!found) {
        throw new RangeError(
          `Optimizer tier “${tier.tierId}” is missing from segment “${segment.id}”.`,
        );
      }
    }
  }
}

function applyPricesToSegment(
  segment: PriceSweepSegmentInput,
  prices: ReadonlyMap<string, number>,
): PriceSweepSegmentInput {
  return {
    ...segment,
    offerExpansion: {
      ...segment.offerExpansion,
      tiers: segment.offerExpansion.tiers.map((tier) =>
        prices.has(tier.id) ? { ...tier, price: prices.get(tier.id)! } : tier,
      ),
    },
  };
}

function economicsInputFromSegments(segments: readonly PriceSweepSegmentInput[]): EconomicsInput {
  return {
    segments: segments.map((segment) => {
      const featureSum = Object.values(segment.offerExpansion.featureValues).reduce(
        (sum, value) => sum + value,
        0,
      );
      const catalogValue = segment.fullCatalogValue ?? featureSum;
      return {
        id: segment.id,
        prospectCount: segment.prospectCount,
        fullCatalogValue: catalogValue,
        sigma: segment.sigma,
        offers: expandOffers(segment.offerExpansion),
        selectionOptions: segment.selectionOptions,
      };
    }),
  };
}

function evaluateMrr(
  segments: readonly PriceSweepSegmentInput[],
  prices: ReadonlyMap<string, number>,
): number {
  const applied = segments.map((segment) => applyPricesToSegment(segment, prices));
  return simulateEconomics(economicsInputFromSegments(applied)).mrr;
}

function coordinateDescent(
  input: JointOptimizerInput,
  startPrices: ReadonlyMap<string, number>,
  maxCycles: number,
): { finalPrices: Map<string, number>; finalMrr: number; cyclesRun: number } {
  const current = new Map(startPrices);
  let previousMrr = evaluateMrr(input.segments, current);
  let cyclesRun = 0;

  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    let improvedThisCycle = false;
    for (const tier of input.tiers) {
      const appliedSegments = input.segments.map((segment) =>
        applyPricesToSegment(segment, current),
      );
      const sweepInput: TierPriceSweepInput = {
        tierId: tier.tierId,
        segments: appliedSegments,
      };
      const sweep = sweepTierPrice(sweepInput);
      const best = sweep.bestPoint;
      const candidate = new Map(current);
      candidate.set(tier.tierId, best.price);
      const candidateMrr = evaluateMrr(input.segments, candidate);
      if (candidateMrr > previousMrr + 1e-9) {
        current.set(tier.tierId, best.price);
        previousMrr = candidateMrr;
        improvedThisCycle = true;
      }
    }
    cyclesRun = cycle + 1;
    if (!improvedThisCycle) break;
  }

  return { finalPrices: current, finalMrr: previousMrr, cyclesRun };
}

function perturbedStart(
  input: JointOptimizerInput,
  random: () => number,
  perturbationRatio: number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const tier of input.tiers) {
    const scale = 1 + (random() * 2 - 1) * perturbationRatio;
    const perturbed = Math.max(0, tier.currentPrice * scale);
    map.set(tier.tierId, perturbed);
  }
  return map;
}

/**
 * Joint price optimizer implementing §4.14. Coordinate descent per start,
 * each single-tier line search reuses `sweepTierPrice` so a discovered local
 * optimum is consistent with the tier's own sweep chart. Multi-start
 * perturbations use `mulberry32` seeded from `input.seed`; identical inputs
 * yield identical results.
 */
export function optimizeJointPrices(input: JointOptimizerInput): JointOptimizerResult {
  assertValidInput(input);
  const starts = Math.max(1, input.starts ?? 4);
  const maxCycles = Math.max(1, input.maxCycles ?? 4);
  const perturbationRatio = Math.min(0.9, Math.max(0, input.perturbationRatio ?? 0.4));

  const baselinePrices = new Map(input.tiers.map((tier) => [tier.tierId, tier.currentPrice]));
  const baselineMrr = evaluateMrr(input.segments, baselinePrices);
  const random = mulberry32(input.seed >>> 0 || 1);
  const candidates: OptimizerCandidate[] = [];

  for (let index = 0; index < starts; index += 1) {
    const startPrices =
      index === 0 ? new Map(baselinePrices) : perturbedStart(input, random, perturbationRatio);
    const startMrr = evaluateMrr(input.segments, startPrices);
    const outcome = coordinateDescent(input, startPrices, maxCycles);
    candidates.push({
      startIndex: index,
      startPrices: [...startPrices.entries()].map(([tierId, price]) => ({ tierId, price })),
      finalPrices: [...outcome.finalPrices.entries()].map(([tierId, price]) => ({ tierId, price })),
      finalMrr: outcome.finalMrr,
      cyclesRun: outcome.cyclesRun,
      improvedFromStart: outcome.finalMrr > startMrr + 1e-9,
    });
  }

  const best = candidates.reduce((winner, candidate) =>
    candidate.finalMrr > winner.finalMrr ? candidate : winner,
  );
  const status: JointOptimizerStatus =
    best.finalMrr > baselineMrr + 1e-9 ? "localOptimum" : "noImprovement";
  return {
    baselineMrr,
    bestMrr: best.finalMrr,
    bestPrices: best.finalPrices,
    candidates,
    status,
    disclosure: DISCLOSURE,
    ...(status === "localOptimum" ? { mrrLift: best.finalMrr - baselineMrr } : {}),
  };
}
