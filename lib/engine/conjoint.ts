import { mulberry32 } from "./montecarlo";

export interface ConjointAttribute {
  id: string;
  name: string;
  levels: readonly string[];
}

export interface ConjointAlternative {
  id: string;
  levels?: Readonly<Record<string, string>>;
  price?: number;
  none?: boolean;
}

export interface ConjointTask {
  id: string;
  alternatives: readonly ConjointAlternative[];
}

export interface ConjointObservation {
  respondentId: string;
  taskId: string;
  chosenAlternativeId: string;
}

export interface ConjointStudy {
  attributes: readonly ConjointAttribute[];
  tasks: readonly ConjointTask[];
  observations: readonly ConjointObservation[];
  numericPrice: boolean;
}

export interface ConjointDerivatives {
  logLikelihood: number;
  gradient: readonly number[];
  hessian: readonly (readonly number[])[];
}

export type ConjointStatus = "ok" | "nonIdentifiable" | "separated" | "nonConverged";

export interface ConjointCoefficient {
  id: string;
  estimate: number;
  standardError: number;
  ci90: readonly [number, number];
}

export interface ConjointPartWorth {
  attributeId: string;
  level: string;
  estimate: number;
  standardError: number;
  ci90: readonly [number, number];
}

export interface ConjointEstimate {
  status: ConjointStatus;
  iterations: number;
  logLikelihoodHistory: readonly number[];
  respondentCount: number;
  observationCount: number;
  hitRate?: number;
  freeCoefficients?: readonly ConjointCoefficient[];
  partWorths?: readonly ConjointPartWorth[];
  priceCoefficient?: ConjointCoefficient;
  noneCoefficient?: ConjointCoefficient;
  covariance?: readonly (readonly number[])[];
  bridgeEnabled: boolean;
  bridgeReason: string;
}

interface ParameterLayout {
  attributeOffsets: ReadonlyMap<string, number>;
  parameterLabels: readonly string[];
  priceIndex?: number;
  noneIndex?: number;
  count: number;
}

interface PreparedObservation {
  alternatives: readonly (readonly number[])[];
  chosenIndex: number;
}

interface PreparedStudy {
  layout: ParameterLayout;
  observations: readonly PreparedObservation[];
}

const CI90_Z = 1.645;
const GRADIENT_TOLERANCE = 1e-8;
const MAX_ITERATIONS = 50;
const PIVOT_TOLERANCE = 1e-11;

function assertUnique(values: readonly string[], label: string) {
  if (values.some((value) => !value) || new Set(values).size !== values.length) {
    throw new RangeError(`${label} must be non-empty and unique.`);
  }
}

function layoutFor(study: ConjointStudy): ParameterLayout {
  if (study.attributes.length < 1 || study.attributes.length > 5) {
    throw new RangeError("Conjoint needs 1–5 non-price attributes.");
  }
  assertUnique(
    study.attributes.map((attribute) => attribute.id),
    "Conjoint attribute IDs",
  );
  const offsets = new Map<string, number>();
  const labels: string[] = [];
  for (const attribute of study.attributes) {
    if (attribute.levels.length < 2 || attribute.levels.length > 4) {
      throw new RangeError(`Conjoint attribute “${attribute.name}” needs 2–4 levels.`);
    }
    assertUnique(attribute.levels, `Levels for conjoint attribute “${attribute.name}”`);
    offsets.set(attribute.id, labels.length);
    for (const level of attribute.levels.slice(0, -1)) labels.push(`${attribute.id}:${level}`);
  }
  const priceIndex = study.numericPrice ? labels.length : undefined;
  if (priceIndex !== undefined) labels.push("price");
  const hasNone = study.tasks.some((task) =>
    task.alternatives.some((alternative) => alternative.none),
  );
  const noneIndex = hasNone ? labels.length : undefined;
  if (noneIndex !== undefined) labels.push("none");
  return {
    attributeOffsets: offsets,
    parameterLabels: labels,
    priceIndex,
    noneIndex,
    count: labels.length,
  };
}

function vectorFor(
  study: ConjointStudy,
  layout: ParameterLayout,
  alternative: ConjointAlternative,
) {
  const vector = Array<number>(layout.count).fill(0);
  if (alternative.none) {
    if (layout.noneIndex === undefined)
      throw new RangeError("A None alternative needs a None coefficient.");
    vector[layout.noneIndex] = 1;
    return vector;
  }
  for (const attribute of study.attributes) {
    const level = alternative.levels?.[attribute.id];
    const levelIndex = attribute.levels.indexOf(level ?? "");
    if (levelIndex < 0) {
      throw new RangeError(
        `Alternative “${alternative.id}” is missing a valid ${attribute.name} level.`,
      );
    }
    const offset = layout.attributeOffsets.get(attribute.id);
    if (offset === undefined) throw new RangeError(`Unknown conjoint attribute “${attribute.id}”.`);
    if (levelIndex === attribute.levels.length - 1) {
      for (let index = 0; index < attribute.levels.length - 1; index += 1)
        vector[offset + index] = -1;
    } else {
      vector[offset + levelIndex] = 1;
    }
  }
  if (layout.priceIndex !== undefined) {
    if (!(Number.isFinite(alternative.price) && (alternative.price ?? -1) >= 0)) {
      throw new RangeError(
        `Alternative “${alternative.id}” needs a non-negative numeric account-month price.`,
      );
    }
    vector[layout.priceIndex] = alternative.price ?? 0;
  }
  return vector;
}

function prepare(study: ConjointStudy): PreparedStudy {
  if (study.tasks.length === 0 || study.observations.length === 0) {
    throw new RangeError("Conjoint estimation needs tasks and observed choices.");
  }
  assertUnique(
    study.tasks.map((task) => task.id),
    "Conjoint task IDs",
  );
  const layout = layoutFor(study);
  const tasks = new Map(
    study.tasks.map((task) => {
      if (task.alternatives.length < 2)
        throw new RangeError(`Task “${task.id}” needs at least two alternatives.`);
      assertUnique(
        task.alternatives.map((alternative) => alternative.id),
        `Alternative IDs in task “${task.id}”`,
      );
      const keys = task.alternatives
        .filter((alternative) => !alternative.none)
        .map((alternative) =>
          JSON.stringify([alternative.levels, study.numericPrice ? alternative.price : undefined]),
        );
      if (new Set(keys).size !== keys.length)
        throw new RangeError(`Task “${task.id}” contains duplicate concepts.`);
      return [
        task.id,
        {
          task,
          vectors: task.alternatives.map((alternative) => vectorFor(study, layout, alternative)),
        },
      ] as const;
    }),
  );
  const observations = study.observations.map((observation) => {
    const preparedTask = tasks.get(observation.taskId);
    if (!preparedTask)
      throw new RangeError(`Observation references unknown task “${observation.taskId}”.`);
    const chosenIndex = preparedTask.task.alternatives.findIndex(
      (alternative) => alternative.id === observation.chosenAlternativeId,
    );
    if (chosenIndex < 0)
      throw new RangeError(
        `Observation selects an unknown alternative in task “${observation.taskId}”.`,
      );
    return { alternatives: preparedTask.vectors, chosenIndex };
  });
  return { layout, observations };
}

function dot(left: readonly number[], right: readonly number[]) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function objective(prepared: PreparedStudy, beta: readonly number[]): ConjointDerivatives {
  if (beta.length !== prepared.layout.count || !beta.every(Number.isFinite)) {
    throw new RangeError(
      `Conjoint beta must contain ${prepared.layout.count} finite coefficients.`,
    );
  }
  const gradient = Array<number>(beta.length).fill(0);
  const hessian = Array.from({ length: beta.length }, () => Array<number>(beta.length).fill(0));
  let logLikelihood = 0;
  for (const observation of prepared.observations) {
    const utilities = observation.alternatives.map((vector) => dot(vector, beta));
    const maximum = Math.max(...utilities);
    const weights = utilities.map((utility) => Math.exp(utility - maximum));
    const denominator = weights.reduce((sum, value) => sum + value, 0);
    const probabilities = weights.map((weight) => weight / denominator);
    logLikelihood += utilities[observation.chosenIndex] - (maximum + Math.log(denominator));
    const mean = Array<number>(beta.length).fill(0);
    for (let alternative = 0; alternative < observation.alternatives.length; alternative += 1) {
      const vector = observation.alternatives[alternative];
      const probability = probabilities[alternative];
      for (let row = 0; row < beta.length; row += 1) mean[row] += probability * vector[row];
    }
    const chosen = observation.alternatives[observation.chosenIndex];
    for (let row = 0; row < beta.length; row += 1) gradient[row] += chosen[row] - mean[row];
    for (let alternative = 0; alternative < observation.alternatives.length; alternative += 1) {
      const vector = observation.alternatives[alternative];
      const probability = probabilities[alternative];
      for (let row = 0; row < beta.length; row += 1) {
        for (let column = 0; column < beta.length; column += 1) {
          hessian[row][column] -=
            probability * (vector[row] - mean[row]) * (vector[column] - mean[column]);
        }
      }
    }
  }
  const count = prepared.observations.length;
  return {
    logLikelihood: logLikelihood / count,
    gradient: gradient.map((value) => value / count),
    hessian: hessian.map((row) => row.map((value) => value / count)),
  };
}

export function conjointParameterCount(study: ConjointStudy) {
  return layoutFor(study).count;
}

/** Average log-likelihood and consistently normalized analytic derivatives. */
export function conjointDerivatives(study: ConjointStudy, beta: readonly number[]) {
  return objective(prepare(study), beta);
}

function matrixRank(matrix: readonly (readonly number[])[], columns: number) {
  const work = matrix.map((row) => [...row]);
  let rank = 0;
  for (let column = 0; column < columns && rank < work.length; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < work.length; row += 1) {
      if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
    }
    if (Math.abs(work[pivot]?.[column] ?? 0) <= PIVOT_TOLERANCE) continue;
    [work[rank], work[pivot]] = [work[pivot], work[rank]];
    const divisor = work[rank][column];
    for (let index = column; index < columns; index += 1) work[rank][index] /= divisor;
    for (let row = 0; row < work.length; row += 1) {
      if (row === rank) continue;
      const factor = work[row][column];
      for (let index = column; index < columns; index += 1)
        work[row][index] -= factor * work[rank][index];
    }
    rank += 1;
  }
  return rank;
}

function designRows(prepared: PreparedStudy) {
  return prepared.observations.flatMap((observation) => {
    const reference = observation.alternatives[0];
    return observation.alternatives
      .slice(1)
      .map((vector) => vector.map((value, index) => value - reference[index]));
  });
}

function solve(matrix: readonly (readonly number[])[], values: readonly number[]) {
  const size = values.length;
  const work = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
    }
    if (Math.abs(work[pivot][column]) <= PIVOT_TOLERANCE) return undefined;
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

function inverse(matrix: readonly (readonly number[])[]) {
  const columns = matrix.length;
  const result = Array.from({ length: columns }, () => Array<number>(columns).fill(0));
  for (let column = 0; column < columns; column += 1) {
    const unit = Array<number>(columns).fill(0);
    unit[column] = 1;
    const solution = solve(matrix, unit);
    if (!solution) return undefined;
    for (let row = 0; row < columns; row += 1) result[row][column] = solution[row];
  }
  return result;
}

function baseResult(
  status: ConjointStatus,
  iterations: number,
  history: readonly number[],
  study: ConjointStudy,
  reason: string,
): ConjointEstimate {
  return {
    status,
    iterations,
    logLikelihoodHistory: history,
    respondentCount: new Set(study.observations.map((observation) => observation.respondentId))
      .size,
    observationCount: study.observations.length,
    bridgeEnabled: false,
    bridgeReason: reason,
  };
}

function coefficient(id: string, estimate: number, variance: number): ConjointCoefficient {
  const standardError = Math.sqrt(Math.max(0, variance));
  return {
    id,
    estimate,
    standardError,
    ci90: [estimate - CI90_Z * standardError, estimate + CI90_Z * standardError],
  };
}

function successfulEstimate(
  study: ConjointStudy,
  prepared: PreparedStudy,
  beta: readonly number[],
  iterations: number,
  history: readonly number[],
  derivatives: ConjointDerivatives,
): ConjointEstimate {
  const information = derivatives.hessian.map((row) => row.map((value) => -value));
  const inverseAverage = inverse(information);
  if (!inverseAverage) {
    return baseResult(
      "nonIdentifiable",
      iterations,
      history,
      study,
      "Observed information is singular.",
    );
  }
  const count = prepared.observations.length;
  const covariance = inverseAverage.map((row) => row.map((value) => value / count));
  const freeCoefficients = prepared.layout.parameterLabels.map((label, index) =>
    coefficient(label, beta[index], covariance[index][index]),
  );
  const partWorths: ConjointPartWorth[] = [];
  for (const attribute of study.attributes) {
    const offset = prepared.layout.attributeOffsets.get(attribute.id) ?? 0;
    for (let levelIndex = 0; levelIndex < attribute.levels.length; levelIndex += 1) {
      let estimate = 0;
      let variance = 0;
      if (levelIndex < attribute.levels.length - 1) {
        estimate = beta[offset + levelIndex];
        variance = covariance[offset + levelIndex][offset + levelIndex];
      } else {
        for (let row = 0; row < attribute.levels.length - 1; row += 1) {
          estimate -= beta[offset + row];
          for (let column = 0; column < attribute.levels.length - 1; column += 1) {
            variance += covariance[offset + row][offset + column];
          }
        }
      }
      const entry = coefficient(
        `${attribute.id}:${attribute.levels[levelIndex]}`,
        estimate,
        variance,
      );
      partWorths.push({
        attributeId: attribute.id,
        level: attribute.levels[levelIndex],
        estimate: entry.estimate,
        standardError: entry.standardError,
        ci90: entry.ci90,
      });
    }
  }
  const priceCoefficient =
    prepared.layout.priceIndex === undefined
      ? undefined
      : freeCoefficients[prepared.layout.priceIndex];
  const noneCoefficient =
    prepared.layout.noneIndex === undefined
      ? undefined
      : freeCoefficients[prepared.layout.noneIndex];
  let correct = 0;
  for (const observation of prepared.observations) {
    const utilities = observation.alternatives.map((vector) => dot(vector, beta));
    const predicted = utilities.reduce(
      (winner, value, index) => (value > utilities[winner] ? index : winner),
      0,
    );
    if (predicted === observation.chosenIndex) correct += 1;
  }
  const bridgeEnabled =
    priceCoefficient !== undefined &&
    priceCoefficient.estimate + CI90_Z * priceCoefficient.standardError < 0;
  return {
    status: "ok",
    iterations,
    logLikelihoodHistory: history,
    respondentCount: new Set(study.observations.map((observation) => observation.respondentId))
      .size,
    observationCount: study.observations.length,
    hitRate: correct / prepared.observations.length,
    freeCoefficients,
    partWorths,
    priceCoefficient,
    noneCoefficient,
    covariance,
    bridgeEnabled,
    bridgeReason: bridgeEnabled
      ? "Numeric account-month price is significantly negative at the one-sided 90% gate."
      : priceCoefficient
        ? "The numeric price coefficient is not significantly negative."
        : "A numeric account-month price column is required.",
  };
}

/** Damped Newton-Raphson pooled MNL estimator with explicit failure states. */
export function estimateConjoint(study: ConjointStudy): ConjointEstimate {
  const prepared = prepare(study);
  if (matrixRank(designRows(prepared), prepared.layout.count) < prepared.layout.count) {
    return baseResult("nonIdentifiable", 0, [], study, "The task design is not full column rank.");
  }
  let beta = Array<number>(prepared.layout.count).fill(0);
  const history: number[] = [];
  for (let iteration = 0; iteration <= MAX_ITERATIONS; iteration += 1) {
    const current = objective(prepared, beta);
    if (history.length === 0) history.push(current.logLikelihood);
    const gradientNorm = Math.max(...current.gradient.map(Math.abs));
    const coefficientNorm = Math.max(...beta.map(Math.abs));
    if (coefficientNorm > 15 && current.logLikelihood > -1e-7) {
      return baseResult(
        "separated",
        iteration,
        history,
        study,
        "Choices are perfectly or nearly separated.",
      );
    }
    if (gradientNorm < GRADIENT_TOLERANCE) {
      return successfulEstimate(study, prepared, beta, iteration, history, current);
    }
    if (iteration === MAX_ITERATIONS) break;
    const information = current.hessian.map((row) => row.map((value) => -value));
    const step = solve(information, current.gradient);
    if (!step)
      return baseResult(
        "nonIdentifiable",
        iteration,
        history,
        study,
        "Observed information is singular.",
      );
    let damping = 1;
    let accepted: number[] | undefined;
    let acceptedLikelihood = current.logLikelihood;
    while (damping >= 2 ** -20) {
      const candidate = beta.map((value, index) => value + damping * step[index]);
      const next = objective(prepared, candidate);
      if (next.logLikelihood > current.logLikelihood + 1e-14) {
        accepted = candidate;
        acceptedLikelihood = next.logLikelihood;
        break;
      }
      damping /= 2;
    }
    if (!accepted) {
      return baseResult(
        "nonConverged",
        iteration,
        history,
        study,
        "No likelihood-improving Newton step was found.",
      );
    }
    beta = accepted;
    history.push(acceptedLikelihood);
  }
  return baseResult(
    "nonConverged",
    MAX_ITERATIONS,
    history,
    study,
    "The 50-iteration limit was reached.",
  );
}

export interface ConjointWtpContrast {
  enabled: boolean;
  reason: string;
  deltaWtp?: number;
}

export function conjointWtpContrast(
  estimate: ConjointEstimate,
  attributeId: string,
  levelOne: string,
  levelZero: string,
): ConjointWtpContrast {
  if (estimate.status !== "ok" || !estimate.bridgeEnabled || !estimate.priceCoefficient) {
    return { enabled: false, reason: estimate.bridgeReason };
  }
  const first = estimate.partWorths?.find(
    (partWorth) => partWorth.attributeId === attributeId && partWorth.level === levelOne,
  );
  const zero = estimate.partWorths?.find(
    (partWorth) => partWorth.attributeId === attributeId && partWorth.level === levelZero,
  );
  if (!first || !zero)
    return { enabled: false, reason: "Select two valid levels from one attribute." };
  return {
    enabled: true,
    reason: "Pooled conjoint-inferred WTP under the modeled attribute levels.",
    deltaWtp: -(first.estimate - zero.estimate) / estimate.priceCoefficient.estimate,
  };
}

function shuffle<T>(values: T[], random: () => number) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function balanced<T>(values: readonly T[], count: number, random: () => number) {
  const sequence = Array.from({ length: count }, (_, index) => values[index % values.length]);
  return shuffle(sequence, random);
}

export interface ConjointDesignOptions {
  attributes: readonly ConjointAttribute[];
  taskCount: number;
  alternativesPerTask: number;
  priceLevels?: readonly number[];
  includeNone?: boolean;
  seed: number;
}

export interface GeneratedConjointDesign {
  tasks: readonly ConjointTask[];
  levelCounts: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export function generateConjointDesign(options: ConjointDesignOptions): GeneratedConjointDesign {
  if (!(Number.isInteger(options.taskCount) && options.taskCount > 0))
    throw new RangeError("Task count must be positive.");
  if (!(
    Number.isInteger(options.alternativesPerTask) &&
    options.alternativesPerTask >= 2 &&
    options.alternativesPerTask <= 5
  )) {
    throw new RangeError("Each conjoint task needs 2–5 concepts.");
  }
  const numericPrice = options.priceLevels !== undefined;
  if (
    numericPrice &&
    (!options.priceLevels?.length ||
      options.priceLevels.some((value) => !Number.isFinite(value) || value < 0))
  ) {
    throw new RangeError("Numeric conjoint price levels must be finite and non-negative.");
  }
  const slots = options.taskCount * options.alternativesPerTask;
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const random = mulberry32((options.seed + attempt * 0x9e3779b9) >>> 0);
    const sequences = new Map(
      options.attributes.map((attribute) => [
        attribute.id,
        balanced(attribute.levels, slots, random),
      ]),
    );
    const prices = numericPrice ? balanced(options.priceLevels ?? [], slots, random) : undefined;
    const tasks: ConjointTask[] = Array.from({ length: options.taskCount }, (_, taskIndex) => ({
      id: `task-${taskIndex + 1}`,
      alternatives: [
        ...Array.from({ length: options.alternativesPerTask }, (_, alternativeIndex) => {
          const slot = taskIndex * options.alternativesPerTask + alternativeIndex;
          return {
            id: `concept-${alternativeIndex + 1}`,
            levels: Object.fromEntries(
              options.attributes.map((attribute) => [
                attribute.id,
                sequences.get(attribute.id)?.[slot] ?? attribute.levels[0],
              ]),
            ),
            ...(prices ? { price: prices[slot] } : {}),
          };
        }),
        ...(options.includeNone ? [{ id: "none", none: true as const }] : []),
      ],
    }));
    const hasDuplicate = tasks.some((task) => {
      const keys = task.alternatives
        .filter((alternative) => !alternative.none)
        .map((alternative) => JSON.stringify([alternative.levels, alternative.price]));
      return new Set(keys).size !== keys.length;
    });
    if (hasDuplicate) continue;
    const study: ConjointStudy = {
      attributes: options.attributes,
      tasks,
      numericPrice,
      observations: tasks.map((task) => ({
        respondentId: "design-check",
        taskId: task.id,
        chosenAlternativeId: task.alternatives[0].id,
      })),
    };
    const prepared = prepare(study);
    if (matrixRank(designRows(prepared), prepared.layout.count) < prepared.layout.count) continue;
    const levelCounts = Object.fromEntries(
      options.attributes.map((attribute) => [
        attribute.id,
        Object.fromEntries(
          attribute.levels.map((level) => [
            level,
            tasks
              .flatMap((task) => task.alternatives)
              .filter((alternative) => alternative.levels?.[attribute.id] === level).length,
          ]),
        ),
      ]),
    );
    return { tasks, levelCounts };
  }
  throw new RangeError(
    "Could not generate a duplicate-free, full-rank balanced conjoint design for these dimensions.",
  );
}

/**
 * Computes the log-determinant of a positive-definite symmetric matrix via
 * Cholesky decomposition. Returns undefined when the matrix is not
 * positive-definite (i.e. the design is not identified).
 */
function symmetricLogDeterminant(matrix: readonly (readonly number[])[]): number | undefined {
  const size = matrix.length;
  const lower = Array.from({ length: size }, () => Array<number>(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row][column];
      for (let index = 0; index < column; index += 1)
        value -= lower[row][index] * lower[column][index];
      if (row === column) {
        if (value <= PIVOT_TOLERANCE) return undefined;
        lower[row][column] = Math.sqrt(value);
      } else {
        lower[row][column] = value / lower[column][column];
      }
    }
  }
  let logDet = 0;
  for (let row = 0; row < size; row += 1) logDet += 2 * Math.log(lower[row][row]);
  return logDet;
}

interface DesignScoreOutcome {
  logDeterminant: number | undefined;
  parameterCount: number;
}

function scoreDesign(study: ConjointStudy): DesignScoreOutcome {
  const layout = layoutFor(study);
  const dummy: ConjointStudy = {
    ...study,
    observations: study.tasks.map((task) => ({
      respondentId: "design-score",
      taskId: task.id,
      chosenAlternativeId: task.alternatives[0].id,
    })),
  };
  const prepared = prepare(dummy);
  if (matrixRank(designRows(prepared), layout.count) < layout.count) {
    return { logDeterminant: undefined, parameterCount: layout.count };
  }
  const zeros = Array<number>(layout.count).fill(0);
  const derivatives = objective(prepared, zeros);
  const observationCount = prepared.observations.length;
  const information = derivatives.hessian.map((row) =>
    row.map((value) => -value * observationCount),
  );
  return { logDeterminant: symmetricLogDeterminant(information), parameterCount: layout.count };
}

function tasksWithSwappedLevel(
  tasks: readonly ConjointTask[],
  fromIndex: number,
  fromAlternative: number,
  toIndex: number,
  toAlternative: number,
  attributeId: string,
): ConjointTask[] {
  const replacement = tasks.map((task) => ({
    ...task,
    alternatives: task.alternatives.map((alternative) => ({ ...alternative })),
  }));
  const fromLevels = { ...(replacement[fromIndex].alternatives[fromAlternative].levels ?? {}) };
  const toLevels = { ...(replacement[toIndex].alternatives[toAlternative].levels ?? {}) };
  const holder = fromLevels[attributeId];
  fromLevels[attributeId] = toLevels[attributeId];
  toLevels[attributeId] = holder;
  replacement[fromIndex].alternatives[fromAlternative].levels = fromLevels;
  replacement[toIndex].alternatives[toAlternative].levels = toLevels;
  return replacement;
}

function taskHasDuplicateConcepts(task: ConjointTask, numericPrice: boolean): boolean {
  const keys = task.alternatives
    .filter((alternative) => !alternative.none)
    .map((alternative) =>
      JSON.stringify([alternative.levels, numericPrice ? alternative.price : undefined]),
    );
  return new Set(keys).size !== keys.length;
}

export interface DEfficientDesignOptions extends ConjointDesignOptions {
  /** Random-balanced restart count (default 8). Higher values search harder for improvements. */
  starts?: number;
  /** Maximum accepted swaps per start (default 200). */
  maxSwaps?: number;
}

export interface DEfficientDesignResult extends GeneratedConjointDesign {
  logDeterminant: number;
  baselineLogDeterminant: number;
  /** Total accepted swaps across the winning start. */
  swapCount: number;
  starts: number;
  status: "improved" | "baseline" | "unimprovable";
}

/**
 * Modified-Fedorov D-efficient design generator, seeded from the existing
 * random-balanced generator (@spec §4.10 D-efficient addendum). It preserves
 * per-attribute level balance by only ever swapping level assignments between
 * pairs of alternatives — the total level counts never change. Multi-start
 * restarts pick the largest log|X'X| across seeds. Returns the random-balanced
 * baseline (with status `baseline` or `unimprovable`) when no swap improves it.
 */
export function generateDEfficientConjointDesign(
  options: DEfficientDesignOptions,
): DEfficientDesignResult {
  const starts = options.starts ?? 8;
  const maxSwaps = options.maxSwaps ?? 200;
  if (!(Number.isInteger(starts) && starts >= 1))
    throw new RangeError("D-efficient generator needs at least one random-balanced start.");
  if (!(Number.isInteger(maxSwaps) && maxSwaps >= 0))
    throw new RangeError("D-efficient generator maxSwaps must be a non-negative integer.");

  const numericPrice = options.priceLevels !== undefined;
  let bestResult: DEfficientDesignResult | undefined;

  for (let start = 0; start < starts; start += 1) {
    const seed = (options.seed + start * 0x9e3779b9) >>> 0;
    const baseline = generateConjointDesign({ ...options, seed });
    const baselineStudy: ConjointStudy = {
      attributes: options.attributes,
      tasks: baseline.tasks,
      numericPrice,
      observations: [],
    };
    const baselineScore = scoreDesign(baselineStudy);
    if (baselineScore.logDeterminant === undefined) continue;

    let currentTasks: ConjointTask[] = baseline.tasks.map((task) => ({
      ...task,
      alternatives: task.alternatives.map((alternative) => ({ ...alternative })),
    }));
    let currentScore = baselineScore.logDeterminant;
    let swapCount = 0;
    let improved = false;
    let unimprovable = true;

    for (let iteration = 0; iteration < maxSwaps; iteration += 1) {
      let bestGain = 0;
      let bestSwap:
        { i: number; ai: number; j: number; aj: number; attributeId: string } | undefined;

      for (let i = 0; i < currentTasks.length; i += 1) {
        for (let j = i; j < currentTasks.length; j += 1) {
          const taskI = currentTasks[i];
          const taskJ = currentTasks[j];
          for (let ai = 0; ai < taskI.alternatives.length; ai += 1) {
            if (taskI.alternatives[ai].none) continue;
            for (let aj = 0; aj < taskJ.alternatives.length; aj += 1) {
              if (taskJ.alternatives[aj].none) continue;
              if (i === j && ai >= aj) continue;
              for (const attribute of options.attributes) {
                const fromLevel = taskI.alternatives[ai].levels?.[attribute.id];
                const toLevel = taskJ.alternatives[aj].levels?.[attribute.id];
                if (fromLevel === toLevel) continue;
                const candidateTasks = tasksWithSwappedLevel(
                  currentTasks,
                  i,
                  ai,
                  j,
                  aj,
                  attribute.id,
                );
                if (
                  taskHasDuplicateConcepts(candidateTasks[i], numericPrice) ||
                  (i !== j && taskHasDuplicateConcepts(candidateTasks[j], numericPrice))
                ) {
                  continue;
                }
                const candidateStudy: ConjointStudy = {
                  attributes: options.attributes,
                  tasks: candidateTasks,
                  numericPrice,
                  observations: [],
                };
                const candidateScore = scoreDesign(candidateStudy);
                if (candidateScore.logDeterminant === undefined) continue;
                const gain = candidateScore.logDeterminant - currentScore;
                if (gain > bestGain + 1e-12) {
                  bestGain = gain;
                  bestSwap = { i, ai, j, aj, attributeId: attribute.id };
                }
              }
            }
          }
        }
      }

      if (!bestSwap) {
        unimprovable = swapCount === 0;
        break;
      }
      currentTasks = tasksWithSwappedLevel(
        currentTasks,
        bestSwap.i,
        bestSwap.ai,
        bestSwap.j,
        bestSwap.aj,
        bestSwap.attributeId,
      );
      currentScore += bestGain;
      swapCount += 1;
      improved = true;
    }

    const levelCounts = Object.fromEntries(
      options.attributes.map((attribute) => [
        attribute.id,
        Object.fromEntries(
          attribute.levels.map((level) => [
            level,
            currentTasks
              .flatMap((task) => task.alternatives)
              .filter((alternative) => alternative.levels?.[attribute.id] === level).length,
          ]),
        ),
      ]),
    );
    const outcome: DEfficientDesignResult = {
      tasks: currentTasks,
      levelCounts,
      logDeterminant: currentScore,
      baselineLogDeterminant: baselineScore.logDeterminant,
      swapCount,
      starts,
      status: improved ? "improved" : unimprovable ? "unimprovable" : "baseline",
    };
    if (!bestResult || outcome.logDeterminant > bestResult.logDeterminant + 1e-12) {
      bestResult = outcome;
    }
  }

  if (!bestResult) {
    throw new RangeError(
      "Could not generate an identified D-efficient conjoint design for these dimensions.",
    );
  }
  return bestResult;
}
