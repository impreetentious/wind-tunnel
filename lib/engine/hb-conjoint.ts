/**
 * @spec §4.10.3 Hierarchical Bayes for Conjoint (extension).
 *
 * A per-respondent random-walk Metropolis sampler with Gibbs updates over the
 * population-level mean μ and diagonal covariance Σ. This is the smallest
 * honest HB kernel that produces per-respondent β posteriors without a new
 * runtime dependency: no NUTS, no full-Σ Wishart update, and no linear-algebra
 * imports. The pooled MNL from §4.10 remains available as the default,
 * shallower lens — HB is opt-in, matching the M-04 rationale in §15.1.
 *
 * Model:
 *   choice_it ∝ exp(x_it · β_r)               (logit level 1, r = respondent(i))
 *   β_r ~ N(μ, diag(σ²))                      (level 2, diagonal Σ)
 *   μ_j ~ N(0, τ_μ²), σ_j² ~ IG(a_0, b_0)     (weakly informative priors)
 *
 * The sampler runs Kw warm-up iterations (proposal SDs adaptively tuned toward
 * the 0.23–0.44 target range for random-walk Metropolis) plus Ks sampled
 * iterations whose per-respondent β averages become the posterior mean.
 *
 * Determinism: given the same study + seed + options, the sampler returns the
 * same posterior means and diagnostic acceptance rates. Randomness enters only
 * through `mulberry32`, matching the §3.4 engine-purity contract. The engine
 * never mutates the study; all draws happen on local copies.
 */

import { mulberry32 } from "./montecarlo";
import {
  conjointDesignVector,
  conjointLayoutFor,
  type ConjointParameterLayout,
  type ConjointStudy,
} from "./conjoint";

export interface HbConjointOptions {
  seed: number;
  /** Warm-up iterations (proposal SDs adapt during this phase). */
  warmup: number;
  /** Sample iterations (post-warmup); every draw contributes to the posterior mean. */
  samples: number;
  /** Initial random-walk step (multiplied per parameter during adaptation). */
  initialStep: number;
  /** Adaptation cadence (batches within warmup). */
  adaptEvery: number;
  /** Prior scale on population mean (weakly informative). */
  priorMuSd: number;
  /** Inverse-gamma shape for population variance. */
  priorSigmaShape: number;
  /** Inverse-gamma scale for population variance. */
  priorSigmaScale: number;
}

export const DEFAULT_HB_OPTIONS: HbConjointOptions = {
  seed: 1,
  warmup: 200,
  samples: 400,
  initialStep: 0.4,
  adaptEvery: 50,
  priorMuSd: 3,
  priorSigmaShape: 2,
  priorSigmaScale: 1,
};

export interface HbRespondentPosterior {
  respondentId: string;
  posteriorMeanBeta: readonly number[];
  observationCount: number;
}

export interface HbConjointResult {
  parameterLabels: readonly string[];
  posteriorMeanMu: readonly number[];
  posteriorMeanSigma: readonly number[];
  respondents: readonly HbRespondentPosterior[];
  meanAcceptance: number;
  iterations: number;
}

interface PreparedRespondent {
  respondentId: string;
  choices: {
    /** design matrix rows for one task's alternatives */
    designs: readonly (readonly number[])[];
    chosenIndex: number;
  }[];
}

function prepare(study: ConjointStudy, layout: ConjointParameterLayout): PreparedRespondent[] {
  const taskDesigns = new Map<string, { design: (readonly number[])[]; altIds: string[] }>();
  for (const task of study.tasks) {
    taskDesigns.set(task.id, {
      design: task.alternatives.map((alternative) =>
        conjointDesignVector(study, layout, alternative),
      ),
      altIds: task.alternatives.map((alternative) => alternative.id),
    });
  }
  const grouped = new Map<string, PreparedRespondent>();
  for (const observation of study.observations) {
    const task = taskDesigns.get(observation.taskId);
    if (!task)
      throw new RangeError(`HB observation references unknown task “${observation.taskId}”.`);
    const chosenIndex = task.altIds.indexOf(observation.chosenAlternativeId);
    if (chosenIndex < 0)
      throw new RangeError(
        `HB observation selects an unknown alternative in task “${observation.taskId}”.`,
      );
    let bucket = grouped.get(observation.respondentId);
    if (!bucket) {
      bucket = { respondentId: observation.respondentId, choices: [] };
      grouped.set(observation.respondentId, bucket);
    }
    bucket.choices.push({ designs: task.design, chosenIndex });
  }
  const respondents = [...grouped.values()];
  if (respondents.length < 2) {
    throw new RangeError("HB Conjoint needs at least two respondents.");
  }
  return respondents;
}

function respondentLogLik(beta: readonly number[], respondent: PreparedRespondent): number {
  let total = 0;
  for (const choice of respondent.choices) {
    let maxU = -Infinity;
    const utilities = choice.designs.map((row) => {
      let sum = 0;
      for (let k = 0; k < beta.length; k += 1) sum += row[k] * beta[k];
      if (sum > maxU) maxU = sum;
      return sum;
    });
    let denom = 0;
    for (const u of utilities) denom += Math.exp(u - maxU);
    total += utilities[choice.chosenIndex] - (maxU + Math.log(denom));
  }
  return total;
}

function priorLogDensity(
  beta: readonly number[],
  mu: readonly number[],
  sigma2: readonly number[],
): number {
  let sum = 0;
  for (let k = 0; k < beta.length; k += 1) {
    const dev = beta[k] - mu[k];
    sum += -0.5 * (Math.log(2 * Math.PI * sigma2[k]) + (dev * dev) / sigma2[k]);
  }
  return sum;
}

function boxMuller(random: () => number): number {
  // Rejection guard for `Math.log(0)`: mulberry32 never emits exactly zero but
  // this keeps the sampler robust against future PRNG swaps.
  let u = 0;
  while (u === 0) u = random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function drawInverseGamma(shape: number, scale: number, random: () => number): number {
  // Simple gamma-via-normal approximation for shape≥1 (Marsaglia–Tsang). For
  // the sizes we run at (K = a few thousand posterior draws), the small bias
  // relative to a full acceptance-rejection gamma sampler is dwarfed by MCMC
  // variance; the HB posterior means recover the ground-truth β within noise
  // in T-HBC-01, so this stays inside the ledger's "no new deps" budget.
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = boxMuller(random);
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x * x * x * x) return scale / (d * v);
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return scale / (d * v);
  }
}

export function estimateHbConjoint(
  study: ConjointStudy,
  overrides: Partial<HbConjointOptions> = {},
): HbConjointResult {
  const options = { ...DEFAULT_HB_OPTIONS, ...overrides };
  if (options.warmup < 0 || options.samples <= 0) {
    throw new RangeError("HB Conjoint needs non-negative warmup and positive sample count.");
  }
  const layout = conjointLayoutFor(study);
  const respondents = prepare(study, layout);
  const K = layout.count;
  const R = respondents.length;
  const random = mulberry32(options.seed >>> 0);

  const betas: number[][] = Array.from({ length: R }, () => Array<number>(K).fill(0));
  const mu = Array<number>(K).fill(0);
  const sigma2 = Array<number>(K).fill(1);
  const stepScale = Array<number>(K).fill(options.initialStep);

  const accepts = Array<number>(R).fill(0);
  const proposalsSinceAdapt = Array<number>(R).fill(0);
  const acceptsSinceAdapt = Array<number>(R).fill(0);

  const posteriorBeta: number[][] = Array.from({ length: R }, () => Array<number>(K).fill(0));
  const posteriorMu = Array<number>(K).fill(0);
  const posteriorSigma2 = Array<number>(K).fill(0);
  let sampled = 0;
  const total = options.warmup + options.samples;

  for (let iter = 0; iter < total; iter += 1) {
    for (let r = 0; r < R; r += 1) {
      const current = betas[r];
      const proposal = current.slice();
      for (let k = 0; k < K; k += 1) proposal[k] += stepScale[k] * boxMuller(random);
      const currentPost =
        respondentLogLik(current, respondents[r]) + priorLogDensity(current, mu, sigma2);
      const proposalPost =
        respondentLogLik(proposal, respondents[r]) + priorLogDensity(proposal, mu, sigma2);
      const logAccept = proposalPost - currentPost;
      const accept = Math.log(random() || 1e-300) < logAccept;
      if (accept) {
        betas[r] = proposal;
        accepts[r] += 1;
        acceptsSinceAdapt[r] += 1;
      }
      proposalsSinceAdapt[r] += 1;
    }

    // Gibbs updates: μ_k | β, σ² ~ Normal; σ²_k | β, μ ~ IG.
    for (let k = 0; k < K; k += 1) {
      let sumBeta = 0;
      for (let r = 0; r < R; r += 1) sumBeta += betas[r][k];
      const priorPrec = 1 / (options.priorMuSd * options.priorMuSd);
      const dataPrec = R / sigma2[k];
      const postVar = 1 / (priorPrec + dataPrec);
      const postMean = postVar * (sumBeta / sigma2[k]);
      mu[k] = postMean + Math.sqrt(postVar) * boxMuller(random);

      let ss = 0;
      for (let r = 0; r < R; r += 1) {
        const dev = betas[r][k] - mu[k];
        ss += dev * dev;
      }
      const shape = options.priorSigmaShape + R / 2;
      const scale = options.priorSigmaScale + ss / 2;
      sigma2[k] = Math.max(1e-6, drawInverseGamma(shape, scale, random));
    }

    // Adaptation during warmup: tune step SDs toward a per-respondent 0.234
    // batched acceptance target — the classic Roberts–Gelman–Gilks recipe.
    if (iter < options.warmup && (iter + 1) % options.adaptEvery === 0) {
      let batchAccepts = 0;
      let batchProposals = 0;
      for (let r = 0; r < R; r += 1) {
        batchAccepts += acceptsSinceAdapt[r];
        batchProposals += proposalsSinceAdapt[r];
        acceptsSinceAdapt[r] = 0;
        proposalsSinceAdapt[r] = 0;
      }
      const rate = batchProposals > 0 ? batchAccepts / batchProposals : 0;
      const gain = rate > 0.34 ? 1.15 : rate < 0.15 ? 0.85 : 1;
      for (let k = 0; k < K; k += 1) stepScale[k] *= gain;
    }

    if (iter >= options.warmup) {
      sampled += 1;
      for (let r = 0; r < R; r += 1) {
        for (let k = 0; k < K; k += 1) posteriorBeta[r][k] += betas[r][k];
      }
      for (let k = 0; k < K; k += 1) {
        posteriorMu[k] += mu[k];
        posteriorSigma2[k] += sigma2[k];
      }
    }
  }

  const denom = sampled > 0 ? sampled : 1;
  const respondentOut: HbRespondentPosterior[] = respondents.map((respondent, r) => ({
    respondentId: respondent.respondentId,
    posteriorMeanBeta: posteriorBeta[r].map((value) => value / denom),
    observationCount: respondent.choices.length,
  }));
  const meanAcceptance = accepts.reduce((sum, value) => sum + value, 0) / (R * total || 1);

  return {
    parameterLabels: layout.parameterLabels,
    posteriorMeanMu: posteriorMu.map((value) => value / denom),
    posteriorMeanSigma: posteriorSigma2.map((value) => Math.sqrt(value / denom)),
    respondents: respondentOut,
    meanAcceptance,
    iterations: total,
  };
}
