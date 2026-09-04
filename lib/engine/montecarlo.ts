import { fitLognormalBand, lognormalQuantile } from "./stats";
import type {
  MonteCarloBand,
  MonteCarloComparison,
  MonteCarloDistribution,
  MonteCarloDraw,
  MonteCarloInput,
  MonteCarloParameter,
  MonteCarloPercentiles,
  MonteCarloResult,
  MonteCarloTornadoDriver,
  SeededRandom,
} from "./types";

export const MIN_MONTE_CARLO_DRAWS = 200;
export const MAX_MONTE_CARLO_DRAWS = 5_000;

/**
 * A compact seeded PRNG with a stable uint32 implementation. The generator
 * is intentionally exported so callers may inject it explicitly in tests.
 */
export function mulberry32(seed: number): SeededRandom {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function assertBand(band: MonteCarloBand, label: string): void {
  const values = [band.p10, band.p50, band.p90];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${label} must contain finite, positive P10/P50/P90 values.`);
  }
  if (band.p10 > band.p50 || band.p50 > band.p90) {
    throw new RangeError(`${label} must be ordered P10 ≤ P50 ≤ P90.`);
  }
  const expectedMedian = Math.sqrt(band.p10 * band.p90);
  const scale = Math.max(1, expectedMedian, band.p50);
  if (Math.abs(expectedMedian - band.p50) > scale * 1e-10) {
    throw new RangeError(`${label} P50 must be the geometric midpoint of P10 and P90.`);
  }
}

function assertInput(input: MonteCarloInput): void {
  if (!(Number.isInteger(input.seed) && input.seed >= 0 && input.seed <= 4_294_967_295)) {
    throw new RangeError("Monte Carlo seed must be a uint32 integer.");
  }
  if (!(
    Number.isInteger(input.drawCount) &&
    input.drawCount >= MIN_MONTE_CARLO_DRAWS &&
    input.drawCount <= MAX_MONTE_CARLO_DRAWS
  )) {
    throw new RangeError(
      `Monte Carlo draw count must be an integer between ${MIN_MONTE_CARLO_DRAWS} and ${MAX_MONTE_CARLO_DRAWS}.`,
    );
  }
  if (input.parameters.length === 0) {
    throw new RangeError("Monte Carlo needs at least one uncertain parameter.");
  }
  if (input.designs.length === 0) throw new RangeError("Monte Carlo needs at least one design.");

  const parameterIds = new Set<string>();
  for (const parameter of input.parameters) {
    if (!parameter.id || parameterIds.has(parameter.id)) {
      throw new RangeError("Monte Carlo parameter IDs must be non-empty and unique.");
    }
    parameterIds.add(parameter.id);
    assertBand(parameter.band, `Monte Carlo parameter “${parameter.label || parameter.id}”`);
  }

  const designIds = new Set<string>();
  for (const design of input.designs) {
    if (!design.id || designIds.has(design.id)) {
      throw new RangeError("Monte Carlo design IDs must be non-empty and unique.");
    }
    designIds.add(design.id);
  }
  if (!designIds.has(input.referenceDesignId)) {
    throw new RangeError("The Monte Carlo reference design must be included in the design list.");
  }
}

function baseValues(parameters: readonly MonteCarloParameter[]): Record<string, number> {
  return Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter.band.p50]));
}

function sampleValues(
  parameters: readonly MonteCarloParameter[],
  random: SeededRandom,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const parameter of parameters) {
    if (parameter.band.p10 === parameter.band.p90) {
      values[parameter.id] = parameter.band.p50;
      continue;
    }
    const next = random();
    if (!(Number.isFinite(next) && next >= 0 && next < 1)) {
      throw new RangeError("The injected Monte Carlo PRNG must return a value in [0, 1).");
    }
    // Exact 0 is valid for an injected PRNG but would map to a lognormal 0.
    // Clamping preserves the positive-domain contract without bias in practice.
    const probability = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, next));
    values[parameter.id] = lognormalQuantile(
      probability,
      fitLognormalBand(parameter.band.p10, parameter.band.p90),
    );
  }
  return values;
}

function evaluate(
  input: MonteCarloInput,
  designId: string,
  parameterValues: Readonly<Record<string, number>>,
): number {
  const mrr = input.evaluate(designId, parameterValues);
  if (!(Number.isFinite(mrr) && mrr >= 0)) {
    throw new RangeError(`Monte Carlo evaluator returned an invalid MRR for design “${designId}”.`);
  }
  return mrr;
}

/** Linear interpolation at rank p × (n − 1), never a confidence interval. */
export function empiricalPercentile(values: readonly number[], probability: number): number {
  if (values.length === 0) throw new RangeError("A percentile needs at least one value.");
  if (!(probability >= 0 && probability <= 1)) {
    throw new RangeError("Percentile probability must be between 0 and 1.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function distribution(
  design: MonteCarloInput["designs"][number],
  mrr: readonly number[],
): MonteCarloDistribution {
  const mean = mrr.reduce((sum, value) => sum + value, 0) / mrr.length;
  const percentiles: MonteCarloPercentiles = {
    p10: empiricalPercentile(mrr, 0.1),
    p50: empiricalPercentile(mrr, 0.5),
    p90: empiricalPercentile(mrr, 0.9),
    mean,
  };
  return { designId: design.id, label: design.label, mrr, percentiles };
}

function compareDesigns(
  referenceDesignId: string,
  challengerDesignId: string,
  draws: readonly MonteCarloDraw[],
): MonteCarloComparison {
  let referenceWins = 0;
  let challengerWins = 0;
  let ties = 0;
  for (const draw of draws) {
    const reference = draw.mrrByDesign[referenceDesignId];
    const challenger = draw.mrrByDesign[challengerDesignId];
    if (challenger > reference) challengerWins += 1;
    else if (reference > challenger) referenceWins += 1;
    else ties += 1;
  }
  return {
    referenceDesignId,
    challengerDesignId,
    referenceWins,
    challengerWins,
    ties,
    challengerWinRate: challengerWins / draws.length,
  };
}

function tornadoDrivers(input: MonteCarloInput): readonly MonteCarloTornadoDriver[] {
  const base = baseValues(input.parameters);
  const baseMrr = evaluate(input, input.referenceDesignId, base);
  const drivers = input.parameters.map((parameter) => {
    const lowMrr = evaluate(input, input.referenceDesignId, {
      ...base,
      [parameter.id]: parameter.band.p10,
    });
    const highMrr = evaluate(input, input.referenceDesignId, {
      ...base,
      [parameter.id]: parameter.band.p90,
    });
    const lowDelta = lowMrr - baseMrr;
    const highDelta = highMrr - baseMrr;
    return {
      parameterId: parameter.id,
      label: parameter.label,
      baseMrr,
      lowMrr,
      highMrr,
      lowDelta,
      highDelta,
      maximumAbsoluteDelta: Math.max(Math.abs(lowDelta), Math.abs(highDelta)),
    };
  });
  return drivers.sort((left, right) => {
    const difference = right.maximumAbsoluteDelta - left.maximumAbsoluteDelta;
    if (difference !== 0) return difference;
    return left.parameterId < right.parameterId ? -1 : left.parameterId > right.parameterId ? 1 : 0;
  });
}

/**
 * Samples only P10/P90 assumption bands. All designs consume the same indexed
 * draw vector, which makes comparison win rates paired and deterministic.
 */
export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  assertInput(input);
  const random = (input.randomFactory ?? mulberry32)(input.seed);
  const draws: MonteCarloDraw[] = [];

  for (let index = 0; index < input.drawCount; index += 1) {
    const parameterValues = sampleValues(input.parameters, random);
    const mrrByDesign: Record<string, number> = {};
    for (const design of input.designs) {
      mrrByDesign[design.id] = evaluate(input, design.id, parameterValues);
    }
    draws.push({ index, parameterValues, mrrByDesign });
  }

  const distributions = input.designs.map((design) =>
    distribution(
      design,
      draws.map((draw) => draw.mrrByDesign[design.id]),
    ),
  );
  const comparisons = input.designs
    .filter((design) => design.id !== input.referenceDesignId)
    .map((design) => compareDesigns(input.referenceDesignId, design.id, draws));

  return {
    seed: input.seed,
    drawCount: input.drawCount,
    draws,
    distributions,
    comparisons,
    tornado: tornadoDrivers(input),
  };
}
