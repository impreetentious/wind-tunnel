const SQRT_TWO = Math.SQRT2;
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);
const Z_90 = 1.2815515655446004;

function horner(value: number, coefficients: readonly number[]): number {
  return coefficients.reduce((result, coefficient) => result * value + coefficient);
}

function logGamma(value: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.001208650973866179, -0.000005395239384953,
  ];
  let y = value;
  let series = 1.000000000190015;
  const temporary = value + 5.5 - (value + 0.5) * Math.log(value + 5.5);
  for (const coefficient of coefficients) {
    y += 1;
    series += coefficient / y;
  }
  return -temporary + Math.log((2.5066282746310005 * series) / value);
}

function regularizedGammaQ(shape: number, value: number): number {
  if (value === 0) return 1;
  if (value < shape + 1) return 1 - regularizedGammaP(shape, value);

  const epsilon = 1e-15;
  const minimum = Number.MIN_VALUE / epsilon;
  let b = value + 1 - shape;
  let c = 1 / minimum;
  let d = 1 / b;
  let fraction = d;
  for (let index = 1; index <= 1_000; index += 1) {
    const numerator = -index * (index - shape);
    b += 2;
    d = numerator * d + b;
    if (Math.abs(d) < minimum) d = minimum;
    c = b + numerator / c;
    if (Math.abs(c) < minimum) c = minimum;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) <= epsilon) {
      return Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * fraction;
    }
  }
  throw new Error("Regularized gamma continued fraction did not converge.");
}

function regularizedGammaP(shape: number, value: number): number {
  if (value === 0) return 0;
  if (value >= shape + 1) return 1 - regularizedGammaQ(shape, value);

  const epsilon = 1e-15;
  let term = 1 / shape;
  let sum = term;
  let denominator = shape;
  for (let index = 1; index <= 1_000; index += 1) {
    denominator += 1;
    term *= value / denominator;
    sum += term;
    if (Math.abs(term) <= Math.abs(sum) * epsilon) {
      return sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
    }
  }
  throw new Error("Regularized gamma series did not converge.");
}

function erfc(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return 0;
  if (value === Number.NEGATIVE_INFINITY) return 2;
  if (!Number.isFinite(value)) return Number.NaN;
  const result = regularizedGammaQ(0.5, value * value);
  return value < 0 ? 2 - result : result;
}

/** Error function derived from the regularized incomplete gamma function. */
export function erf(value: number): number {
  if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY)
    return Math.sign(value);
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.sign(value) * regularizedGammaP(0.5, value * value);
}

/** Standard normal CDF Φ. */
export function normalCdf(value: number): number {
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (!Number.isFinite(value)) return Number.NaN;
  return value < 0 ? 0.5 * erfc(-value / SQRT_TWO) : 1 - 0.5 * erfc(value / SQRT_TWO);
}

function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / SQRT_TWO_PI;
}

/** Acklam's rational approximation, polished with Newton steps. */
export function normalInv(probability: number): number {
  if (!(probability > 0 && probability < 1)) {
    throw new RangeError("normalInv probability must be strictly between 0 and 1.");
  }

  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  let result: number;

  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    result = horner(q, c) / horner(q, [...d, 1]);
  } else if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    result = -horner(q, c) / horner(q, [...d, 1]);
  } else {
    const q = probability - 0.5;
    const r = q * q;
    result = (q * horner(r, a)) / horner(r, [...b, 1]);
  }

  // A few refinements comfortably bring central and practical-tail values to
  // double precision without introducing an external numeric dependency.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    result -= (normalCdf(result) - probability) / normalPdf(result);
  }
  return result;
}

export interface LognormalDistribution {
  mu: number;
  sigma: number;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
}

function assertValidDistribution(distribution: LognormalDistribution): void {
  if (!Number.isFinite(distribution.mu)) throw new RangeError("Lognormal mu must be finite.");
  assertNonNegativeFinite(distribution.sigma, "Lognormal sigma");
}

export function lognormalPdf(value: number, distribution: LognormalDistribution): number {
  assertValidDistribution(distribution);
  if (value <= 0 || distribution.sigma === 0) return 0;
  const standardized = (Math.log(value) - distribution.mu) / distribution.sigma;
  return Math.exp(-0.5 * standardized * standardized) / (value * distribution.sigma * SQRT_TWO_PI);
}

export function lognormalCdf(value: number, distribution: LognormalDistribution): number {
  assertValidDistribution(distribution);
  if (value <= 0) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (distribution.sigma === 0) return value < Math.exp(distribution.mu) ? 0 : 1;
  return normalCdf((Math.log(value) - distribution.mu) / distribution.sigma);
}

export function lognormalQuantile(
  probability: number,
  distribution: LognormalDistribution,
): number {
  assertValidDistribution(distribution);
  if (!(probability >= 0 && probability <= 1)) {
    throw new RangeError("Lognormal quantile probability must be between 0 and 1.");
  }
  if (probability === 0) return 0;
  if (probability === 1) return Number.POSITIVE_INFINITY;
  return Math.exp(distribution.mu + distribution.sigma * normalInv(probability));
}

/** E[X · 1(lower < X ≤ upper)] for a lognormal random variable. */
export function lognormalPartialExpectation(
  lower: number,
  upper: number,
  distribution: LognormalDistribution,
): number {
  assertValidDistribution(distribution);
  assertNonNegativeFinite(lower, "Partial-expectation lower bound");
  if (!(upper >= lower) || Number.isNaN(upper)) {
    throw new RangeError("Partial-expectation upper bound must be at least the lower bound.");
  }

  const point = Math.exp(distribution.mu);
  if (distribution.sigma === 0) return lower < point && point <= upper ? point : 0;

  const mean = Math.exp(distribution.mu + (distribution.sigma * distribution.sigma) / 2);
  const lowerTerm =
    lower === 0
      ? 1
      : normalCdf(
          (distribution.mu + distribution.sigma * distribution.sigma - Math.log(lower)) /
            distribution.sigma,
        );
  const upperTerm =
    upper === Number.POSITIVE_INFINITY
      ? 0
      : normalCdf(
          (distribution.mu + distribution.sigma * distribution.sigma - Math.log(upper)) /
            distribution.sigma,
        );
  return mean * (lowerTerm - upperTerm);
}

/** Fits the P10/P90 lognormal band contract used by model assumptions. */
export function fitLognormalBand(q10: number, q90: number): LognormalDistribution {
  if (!(Number.isFinite(q10) && Number.isFinite(q90) && q10 > 0 && q90 > 0 && q10 <= q90)) {
    throw new RangeError("A lognormal P10/P90 band must be finite, positive, and ordered.");
  }
  return {
    mu: (Math.log(q10) + Math.log(q90)) / 2,
    sigma: Math.log(q90 / q10) / (2 * Z_90),
  };
}

/** A standard, median-one lognormal used for within-segment scale ε. */
export function scaleDistribution(sigma: number): LognormalDistribution {
  assertNonNegativeFinite(sigma, "Scale sigma");
  return { mu: 0, sigma };
}
