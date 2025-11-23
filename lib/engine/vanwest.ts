/**
 * Deterministic Van Westendorp Price Sensitivity Meter (PSM) calculations.
 * This module deliberately knows nothing about persisted scenario or UI data.
 */

export interface VanWestendorpResponse {
  tooCheap: number;
  cheap: number;
  expensive: number;
  tooExpensive: number;
}

export type VanWestendorpPointId = "pmc" | "pme" | "ipp" | "opp";

export interface VanWestendorpViolation {
  index: number;
  response: VanWestendorpResponse;
  reason: string;
}

export interface VanWestendorpCurvePoint {
  price: number;
  /** Fractions in [0, 1], ready for both a chart and a tabular alternative. */
  tooCheap: number;
  cheap: number;
  expensive: number;
  tooExpensive: number;
  notCheap: number;
  notExpensive: number;
}

export interface VanWestendorpPoint {
  id: VanWestendorpPointId;
  label: string;
  /** Undefined means that the sampled curves do not produce this crossing. */
  price: number | undefined;
}

export interface VanWestendorpResult {
  validResponses: readonly VanWestendorpResponse[];
  violations: readonly VanWestendorpViolation[];
  curves: readonly VanWestendorpCurvePoint[];
  points: Readonly<Record<VanWestendorpPointId, VanWestendorpPoint>>;
  /** The operational PSM range [PMC, PME], when both crossings are ordered. */
  acceptableRange: { low: number; high: number } | undefined;
}

const pointLabels: Record<VanWestendorpPointId, string> = {
  pmc: "Point of marginal cheapness (PMC)",
  pme: "Point of marginal expensiveness (PME)",
  ipp: "Indifference price point (IPP)",
  opp: "Optimal price point (OPP)",
};

function isFinitePrice(value: number) {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Keeps the study data intact while identifying respondents that cannot form a
 * monotonic PSM quadruple. Those rows are intentionally excluded from every
 * curve rather than repaired or silently re-ordered.
 */
export function validateVanWestendorpResponses(
  responses: readonly VanWestendorpResponse[],
): Pick<VanWestendorpResult, "validResponses" | "violations"> {
  const validResponses: VanWestendorpResponse[] = [];
  const violations: VanWestendorpViolation[] = [];

  responses.forEach((response, index) => {
    const values = [response.tooCheap, response.cheap, response.expensive, response.tooExpensive];
    if (!values.every(isFinitePrice)) {
      violations.push({
        index,
        response,
        reason: "All four prices must be finite, non-negative numbers.",
      });
      return;
    }
    if (
      response.tooCheap > response.cheap ||
      response.cheap > response.expensive ||
      response.expensive > response.tooExpensive
    ) {
      violations.push({
        index,
        response,
        reason: "Expected too cheap ≤ cheap ≤ expensive ≤ too expensive.",
      });
      return;
    }
    validResponses.push(response);
  });

  return { validResponses, violations };
}

function curvesFor(
  responses: readonly VanWestendorpResponse[],
): readonly VanWestendorpCurvePoint[] {
  const grid = [
    ...new Set(
      responses.flatMap((response) => [
        response.tooCheap,
        response.cheap,
        response.expensive,
        response.tooExpensive,
      ]),
    ),
  ].sort((left, right) => left - right);
  const denominator = responses.length;

  return grid.map((price) => {
    const descending = (field: keyof VanWestendorpResponse) =>
      responses.filter((response) => response[field] >= price).length / denominator;
    const ascending = (field: keyof VanWestendorpResponse) =>
      responses.filter((response) => response[field] <= price).length / denominator;
    const cheap = descending("cheap");
    const expensive = ascending("expensive");
    return {
      price,
      tooCheap: descending("tooCheap"),
      cheap,
      expensive,
      tooExpensive: ascending("tooExpensive"),
      notCheap: 1 - cheap,
      notExpensive: 1 - expensive,
    };
  });
}

/** Finds the first zero or sign-changing pair and linearly interpolates it. */
function interpolatedCrossing(
  curves: readonly VanWestendorpCurvePoint[],
  left: (point: VanWestendorpCurvePoint) => number,
  right: (point: VanWestendorpCurvePoint) => number,
): number | undefined {
  if (curves.length < 2) return undefined;

  for (let index = 0; index < curves.length; index += 1) {
    const current = curves[index];
    const currentDifference = left(current) - right(current);
    if (currentDifference === 0) return current.price;

    const next = curves[index + 1];
    if (!next) continue;
    const nextDifference = left(next) - right(next);
    if (nextDifference === 0) return next.price;
    if (currentDifference * nextDifference > 0) continue;

    const denominator = Math.abs(currentDifference) + Math.abs(nextDifference);
    if (denominator === 0) continue;
    return (
      current.price + ((next.price - current.price) * Math.abs(currentDifference)) / denominator
    );
  }
  return undefined;
}

function point(id: VanWestendorpPointId, price: number | undefined): VanWestendorpPoint {
  return { id, label: pointLabels[id], price };
}

/**
 * Builds the convention-pinned cumulative curves and crossing markers from
 * fielded PSM responses. Empty/degenerate data intentionally gives undefined
 * markers instead of invented prices.
 */
export function analyzeVanWestendorp(
  responses: readonly VanWestendorpResponse[],
): VanWestendorpResult {
  const { validResponses, violations } = validateVanWestendorpResponses(responses);
  const curves = validResponses.length > 0 ? curvesFor(validResponses) : [];
  const pmc = interpolatedCrossing(
    curves,
    (entry) => entry.tooCheap,
    (entry) => entry.notCheap,
  );
  const pme = interpolatedCrossing(
    curves,
    (entry) => entry.tooExpensive,
    (entry) => entry.notExpensive,
  );
  const ipp = interpolatedCrossing(
    curves,
    (entry) => entry.cheap,
    (entry) => entry.expensive,
  );
  const opp = interpolatedCrossing(
    curves,
    (entry) => entry.tooCheap,
    (entry) => entry.tooExpensive,
  );

  return {
    validResponses,
    violations,
    curves,
    points: {
      pmc: point("pmc", pmc),
      pme: point("pme", pme),
      ipp: point("ipp", ipp),
      opp: point("opp", opp),
    },
    acceptableRange:
      pmc !== undefined && pme !== undefined && pmc <= pme ? { low: pmc, high: pme } : undefined,
  };
}
