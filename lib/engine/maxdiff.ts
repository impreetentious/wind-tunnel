import { mulberry32 } from "./montecarlo";

export interface MaxDiffTask {
  id: string;
  itemIds: readonly string[];
}

export interface MaxDiffResponse {
  respondentId: string;
  taskId: string;
  bestItemId: string;
  worstItemId: string;
}

export interface MaxDiffScore {
  itemId: string;
  appearances: number;
  bestCount: number;
  worstCount: number;
  rawScore: number;
  normalizedScore: number;
}

export type MaxDiffResult =
  | { ok: true; scores: readonly MaxDiffScore[] }
  | {
      ok: false;
      status: "unseenItems" | "invalidResponse";
      error: string;
      unseenItemIds?: readonly string[];
    };

export function scoreMaxDiff(
  itemIds: readonly string[],
  tasks: readonly MaxDiffTask[],
  responses: readonly MaxDiffResponse[],
): MaxDiffResult {
  if (
    itemIds.length < 2 ||
    itemIds.some((itemId) => !itemId) ||
    new Set(itemIds).size !== itemIds.length
  ) {
    throw new RangeError("MaxDiff item IDs must contain at least two non-empty unique values.");
  }
  const itemSet = new Set(itemIds);
  const taskById = new Map<string, MaxDiffTask>();
  for (const task of tasks) {
    if (
      !task.id ||
      taskById.has(task.id) ||
      task.itemIds.length < 2 ||
      new Set(task.itemIds).size !== task.itemIds.length ||
      task.itemIds.some((itemId) => !itemSet.has(itemId))
    ) {
      throw new RangeError("Every MaxDiff task needs a unique ID and distinct known items.");
    }
    taskById.set(task.id, task);
  }
  const counts = new Map(itemIds.map((itemId) => [itemId, { appearances: 0, best: 0, worst: 0 }]));
  for (const response of responses) {
    const task = taskById.get(response.taskId);
    if (
      !task ||
      response.bestItemId === response.worstItemId ||
      !task.itemIds.includes(response.bestItemId) ||
      !task.itemIds.includes(response.worstItemId)
    ) {
      return {
        ok: false,
        status: "invalidResponse",
        error: `Response for task “${response.taskId}” must choose distinct displayed best and worst items.`,
      };
    }
    for (const itemId of task.itemIds) {
      const count = counts.get(itemId);
      if (count) count.appearances += 1;
    }
    const best = counts.get(response.bestItemId);
    const worst = counts.get(response.worstItemId);
    if (best) best.best += 1;
    if (worst) worst.worst += 1;
  }
  const unseenItemIds = itemIds.filter((itemId) => (counts.get(itemId)?.appearances ?? 0) === 0);
  if (unseenItemIds.length > 0) {
    return {
      ok: false,
      status: "unseenItems",
      unseenItemIds,
      error: `No observed task exposure for: ${unseenItemIds.join(", ")}.`,
    };
  }
  const raw = itemIds.map((itemId) => {
    const count = counts.get(itemId)!;
    return (count.best - count.worst) / count.appearances;
  });
  const minimum = Math.min(...raw);
  const shifted = raw.map((value) => value - minimum);
  const total = shifted.reduce((sum, value) => sum + value, 0);
  return {
    ok: true,
    scores: itemIds.map((itemId, index) => {
      const count = counts.get(itemId)!;
      return {
        itemId,
        appearances: count.appearances,
        bestCount: count.best,
        worstCount: count.worst,
        rawScore: raw[index],
        normalizedScore: total === 0 ? 100 / itemIds.length : (shifted[index] / total) * 100,
      };
    }),
  };
}

function shuffle<T>(values: T[], random: () => number) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

export interface MaxDiffMnlUtility {
  itemId: string;
  utility: number;
  standardError: number;
  ci90: readonly [number, number];
}

export interface MaxDiffMnlShare {
  itemId: string;
  share: number;
}

export type MaxDiffMnlStatus = "ok" | "nonIdentifiable" | "separated" | "nonConverged";

export interface MaxDiffMnlEstimate {
  status: MaxDiffMnlStatus;
  iterations: number;
  logLikelihoodHistory: readonly number[];
  respondentCount: number;
  observationCount: number;
  utilities?: readonly MaxDiffMnlUtility[];
  normalizedShares?: readonly MaxDiffMnlShare[];
  reason: string;
}

interface PreparedTask {
  itemIndices: readonly number[];
  bestIndex: number;
  worstIndex: number;
}

const CI90_Z_MNL = 1.645;
const MNL_GRAD_TOL = 1e-8;
const MNL_MAX_ITER = 60;
const MNL_PIVOT_TOLERANCE = 1e-11;

function solveLinear(
  matrix: readonly (readonly number[])[],
  values: readonly number[],
): number[] | undefined {
  const size = values.length;
  const work = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
    }
    if (Math.abs(work[pivot][column]) <= MNL_PIVOT_TOLERANCE) return undefined;
    [work[column], work[pivot]] = [work[pivot], work[column]];
    const divisor = work[column][column];
    for (let index = column; index <= size; index += 1) work[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = work[row][column];
      for (let index = column; index <= size; index += 1)
        work[row][index] -= factor * work[column][index];
    }
  }
  return work.map((row) => row[size]);
}

function invertLinear(matrix: readonly (readonly number[])[]): number[][] | undefined {
  const size = matrix.length;
  const result: number[][] = Array.from({ length: size }, () => Array<number>(size).fill(0));
  for (let column = 0; column < size; column += 1) {
    const unit = Array<number>(size).fill(0);
    unit[column] = 1;
    const solution = solveLinear(matrix, unit);
    if (!solution) return undefined;
    for (let row = 0; row < size; row += 1) result[row][column] = solution[row];
  }
  return result;
}

function reconstructUtility(freeCoefficients: readonly number[], itemCount: number): number[] {
  const values = [...freeCoefficients];
  const last = -freeCoefficients.reduce((sum, value) => sum + value, 0);
  values.push(last);
  if (values.length !== itemCount) {
    throw new RangeError("Utility vector length mismatch.");
  }
  return values;
}

function contributionForTask(
  utilities: readonly number[],
  itemIndices: readonly number[],
  chosenIndex: number,
  polarity: 1 | -1,
): {
  logProb: number;
  probabilities: number[];
} {
  const utilitiesInTask = itemIndices.map((index) => polarity * utilities[index]);
  const max = Math.max(...utilitiesInTask);
  const weights = utilitiesInTask.map((value) => Math.exp(value - max));
  const denominator = weights.reduce((sum, value) => sum + value, 0);
  const probabilities = weights.map((weight) => weight / denominator);
  const chosenLocalIndex = itemIndices.indexOf(chosenIndex);
  if (chosenLocalIndex < 0) {
    throw new RangeError("Chosen item is not shown in the task.");
  }
  const logProb = utilitiesInTask[chosenLocalIndex] - (max + Math.log(denominator));
  return { logProb, probabilities };
}

function buildDerivatives(
  freeCoefficients: readonly number[],
  itemCount: number,
  prepared: readonly PreparedTask[],
) {
  const utilities = reconstructUtility(freeCoefficients, itemCount);
  const gradientFull = Array<number>(itemCount).fill(0);
  const hessianFull = Array.from({ length: itemCount }, () => Array<number>(itemCount).fill(0));
  let logLikelihood = 0;

  for (const task of prepared) {
    // Best pick: utilities are +u for items in task; chosen = bestIndex.
    const best = contributionForTask(utilities, task.itemIndices, task.bestIndex, 1);
    logLikelihood += best.logProb;
    for (let localI = 0; localI < task.itemIndices.length; localI += 1) {
      const i = task.itemIndices[localI];
      gradientFull[i] += (i === task.bestIndex ? 1 : 0) - best.probabilities[localI];
      for (let localJ = 0; localJ < task.itemIndices.length; localJ += 1) {
        const j = task.itemIndices[localJ];
        hessianFull[i][j] -=
          best.probabilities[localI] * ((localI === localJ ? 1 : 0) - best.probabilities[localJ]);
      }
    }

    // Worst pick: utilities are -u for items in task; chosen = worstIndex.
    const worst = contributionForTask(utilities, task.itemIndices, task.worstIndex, -1);
    logLikelihood += worst.logProb;
    for (let localI = 0; localI < task.itemIndices.length; localI += 1) {
      const i = task.itemIndices[localI];
      gradientFull[i] += -((i === task.worstIndex ? 1 : 0) - worst.probabilities[localI]);
      for (let localJ = 0; localJ < task.itemIndices.length; localJ += 1) {
        const j = task.itemIndices[localJ];
        hessianFull[i][j] -=
          worst.probabilities[localI] * ((localI === localJ ? 1 : 0) - worst.probabilities[localJ]);
      }
    }
  }

  const free = itemCount - 1;
  const gradientFree = Array<number>(free).fill(0);
  const hessianFree = Array.from({ length: free }, () => Array<number>(free).fill(0));
  for (let row = 0; row < free; row += 1) {
    gradientFree[row] = gradientFull[row] - gradientFull[itemCount - 1];
    for (let column = 0; column < free; column += 1) {
      hessianFree[row][column] =
        hessianFull[row][column] -
        hessianFull[row][itemCount - 1] -
        hessianFull[itemCount - 1][column] +
        hessianFull[itemCount - 1][itemCount - 1];
    }
  }
  return { logLikelihood, gradientFree, hessianFree };
}

/**
 * Joint-MNL best-worst estimator (§4.10 MNL best-worst addendum). Fits per-item
 * utilities under the sum-to-zero identifying constraint by damped Newton-Raphson
 * over the (m − 1) free parameters. Best and worst picks contribute two MNL
 * observations per response: best is `softmax(+u)` across the shown items,
 * worst is `softmax(−u)`. The counting scorer (`scoreMaxDiff`) continues to
 * ship as the lightweight lens; this MNL estimator is available whenever there
 * are enough responses to identify the utility vector.
 */
export function estimateMaxDiffMnl(
  itemIds: readonly string[],
  tasks: readonly MaxDiffTask[],
  responses: readonly MaxDiffResponse[],
): MaxDiffMnlEstimate {
  if (
    itemIds.length < 2 ||
    itemIds.some((itemId) => !itemId) ||
    new Set(itemIds).size !== itemIds.length
  ) {
    throw new RangeError("MaxDiff item IDs must contain at least two non-empty unique values.");
  }
  const itemIndex = new Map(itemIds.map((itemId, index) => [itemId, index]));
  const respondentCount = new Set(responses.map((response) => response.respondentId)).size;
  const preparedTasks: PreparedTask[] = [];
  const taskById = new Map<string, MaxDiffTask>();
  for (const task of tasks) {
    if (!task.id || taskById.has(task.id)) {
      throw new RangeError("Every MaxDiff task needs a unique ID.");
    }
    if (task.itemIds.length < 2 || task.itemIds.some((itemId) => !itemIndex.has(itemId))) {
      throw new RangeError(`MaxDiff task “${task.id}” references unknown or too few items.`);
    }
    taskById.set(task.id, task);
  }
  for (const response of responses) {
    const task = taskById.get(response.taskId);
    if (!task) {
      return {
        status: "nonIdentifiable",
        iterations: 0,
        logLikelihoodHistory: [],
        respondentCount,
        observationCount: 0,
        reason: `Response references unknown MaxDiff task “${response.taskId}”.`,
      };
    }
    if (
      response.bestItemId === response.worstItemId ||
      !task.itemIds.includes(response.bestItemId) ||
      !task.itemIds.includes(response.worstItemId)
    ) {
      return {
        status: "nonIdentifiable",
        iterations: 0,
        logLikelihoodHistory: [],
        respondentCount,
        observationCount: 0,
        reason: `Response for task “${response.taskId}” must choose distinct displayed best and worst items.`,
      };
    }
    preparedTasks.push({
      itemIndices: task.itemIds.map((itemId) => itemIndex.get(itemId)!),
      bestIndex: itemIndex.get(response.bestItemId)!,
      worstIndex: itemIndex.get(response.worstItemId)!,
    });
  }

  if (preparedTasks.length === 0) {
    return {
      status: "nonIdentifiable",
      iterations: 0,
      logLikelihoodHistory: [],
      respondentCount,
      observationCount: 0,
      reason: "MaxDiff MNL needs at least one observed best-worst response.",
    };
  }

  const itemCount = itemIds.length;
  const free = itemCount - 1;
  let coefficients = Array<number>(free).fill(0);
  const history: number[] = [];

  for (let iteration = 0; iteration <= MNL_MAX_ITER; iteration += 1) {
    const derivatives = buildDerivatives(coefficients, itemCount, preparedTasks);
    if (history.length === 0) history.push(derivatives.logLikelihood);
    const gradientNorm = Math.max(...derivatives.gradientFree.map(Math.abs));
    const coefficientNorm = Math.max(...coefficients.map(Math.abs));
    if (coefficientNorm > 20 && derivatives.logLikelihood > -1e-7) {
      return {
        status: "separated",
        iterations: iteration,
        logLikelihoodHistory: history,
        respondentCount,
        observationCount: preparedTasks.length * 2,
        reason: "Choices are perfectly or nearly separated.",
      };
    }
    if (gradientNorm < MNL_GRAD_TOL) {
      const information = derivatives.hessianFree.map((row) => row.map((value) => -value));
      const inverse = invertLinear(information);
      if (!inverse) {
        return {
          status: "nonIdentifiable",
          iterations: iteration,
          logLikelihoodHistory: history,
          respondentCount,
          observationCount: preparedTasks.length * 2,
          reason: "Observed information is singular; the utility vector is not identified.",
        };
      }
      const utilitiesFull = reconstructUtility(coefficients, itemCount);
      // Standard errors: for i < m, direct diagonal; for i = m, var(-Σ β_free) = Σ_i Σ_j Cov(β_i, β_j).
      const utilities: MaxDiffMnlUtility[] = itemIds.map((itemId, index) => {
        let variance: number;
        if (index < free) {
          variance = inverse[index][index];
        } else {
          variance = 0;
          for (let row = 0; row < free; row += 1) {
            for (let column = 0; column < free; column += 1) {
              variance += inverse[row][column];
            }
          }
        }
        const standardError = Math.sqrt(Math.max(0, variance));
        return {
          itemId,
          utility: utilitiesFull[index],
          standardError,
          ci90: [
            utilitiesFull[index] - CI90_Z_MNL * standardError,
            utilitiesFull[index] + CI90_Z_MNL * standardError,
          ],
        };
      });
      const softMax = Math.max(...utilitiesFull);
      const softWeights = utilitiesFull.map((value) => Math.exp(value - softMax));
      const softDenom = softWeights.reduce((sum, value) => sum + value, 0);
      const normalizedShares = itemIds.map((itemId, index) => ({
        itemId,
        share: softWeights[index] / softDenom,
      }));
      return {
        status: "ok",
        iterations: iteration,
        logLikelihoodHistory: history,
        respondentCount,
        observationCount: preparedTasks.length * 2,
        utilities,
        normalizedShares,
        reason: "Best-worst MNL converged at the specified gradient tolerance.",
      };
    }
    if (iteration === MNL_MAX_ITER) break;
    const information = derivatives.hessianFree.map((row) => row.map((value) => -value));
    const step = solveLinear(information, derivatives.gradientFree);
    if (!step) {
      return {
        status: "nonIdentifiable",
        iterations: iteration,
        logLikelihoodHistory: history,
        respondentCount,
        observationCount: preparedTasks.length * 2,
        reason: "Observed information is singular during Newton step.",
      };
    }
    let damping = 1;
    let accepted: number[] | undefined;
    let acceptedLikelihood = derivatives.logLikelihood;
    while (damping >= 2 ** -20) {
      const candidate = coefficients.map((value, index) => value + damping * step[index]);
      const next = buildDerivatives(candidate, itemCount, preparedTasks);
      if (next.logLikelihood > derivatives.logLikelihood + 1e-14) {
        accepted = candidate;
        acceptedLikelihood = next.logLikelihood;
        break;
      }
      damping /= 2;
    }
    if (!accepted) {
      return {
        status: "nonConverged",
        iterations: iteration,
        logLikelihoodHistory: history,
        respondentCount,
        observationCount: preparedTasks.length * 2,
        reason: "No likelihood-improving Newton step was found.",
      };
    }
    coefficients = accepted;
    history.push(acceptedLikelihood);
  }
  return {
    status: "nonConverged",
    iterations: MNL_MAX_ITER,
    logLikelihoodHistory: history,
    respondentCount,
    observationCount: preparedTasks.length * 2,
    reason: "The Newton iteration limit was reached.",
  };
}

export function generateMaxDiffDesign(
  itemIds: readonly string[],
  taskCount: number,
  itemsPerTask: number,
  seed: number,
) {
  if (itemIds.length < itemsPerTask || itemsPerTask < 3 || itemsPerTask > 5) {
    throw new RangeError("MaxDiff tasks show 3–5 distinct items from a large-enough item list.");
  }
  if (!(
    Number.isInteger(taskCount) &&
    taskCount > 0 &&
    taskCount * itemsPerTask >= itemIds.length
  )) {
    throw new RangeError(
      "MaxDiff task count must be positive and expose every item at least once.",
    );
  }
  if (new Set(itemIds).size !== itemIds.length || itemIds.some((itemId) => !itemId)) {
    throw new RangeError("MaxDiff item IDs must be non-empty and unique.");
  }
  const slots = taskCount * itemsPerTask;
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const random = mulberry32((seed + attempt * 0x9e3779b9) >>> 0);
    const sequence = shuffle(
      Array.from({ length: slots }, (_, index) => itemIds[index % itemIds.length]),
      random,
    );
    const tasks = Array.from({ length: taskCount }, (_, index) => ({
      id: `maxdiff-${index + 1}`,
      itemIds: sequence.slice(index * itemsPerTask, (index + 1) * itemsPerTask),
    }));
    if (tasks.every((task) => new Set(task.itemIds).size === task.itemIds.length)) return tasks;
  }
  throw new RangeError("Could not generate a balanced duplicate-free MaxDiff design.");
}
