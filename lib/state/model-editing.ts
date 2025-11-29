import type { Scenario } from "./schemas";

export type BandField = "p10" | "p50" | "p90";
export type QuantileBand = Scenario["model"]["segments"][number]["wtpBand"];

export interface EditResult<T> {
  ok: true;
  value: T;
}

export interface EditFailure {
  ok: false;
  error: string;
}

export type ModelEditResult<T> = EditResult<T> | EditFailure;

export function resizeBandAtP50(band: QuantileBand, p50: number): QuantileBand {
  const logHalfWidth = Math.log(band.p90 / band.p10) / 2;
  return {
    p10: p50 * Math.exp(-logHalfWidth),
    p50,
    p90: p50 * Math.exp(logHalfWidth),
  };
}

/**
 * Applies the P50-centred band contract used by the persisted scenario schema.
 * Editing either endpoint mirrors the opposite endpoint around the geometric P50.
 */
export function editP50CenteredBand(
  band: QuantileBand,
  field: BandField,
  rawValue: number,
): ModelEditResult<QuantileBand> {
  if (!(Number.isFinite(rawValue) && rawValue > 0)) {
    return { ok: false, error: "Enter a positive number." };
  }

  if (field === "p50") return { ok: true, value: resizeBandAtP50(band, rawValue) };

  if (field === "p10") {
    if (rawValue > band.p50) {
      return { ok: false, error: "P10 cannot be greater than P50 (or P90)." };
    }
    return {
      ok: true,
      value: { p10: rawValue, p50: band.p50, p90: (band.p50 * band.p50) / rawValue },
    };
  }

  if (rawValue < band.p50) {
    return { ok: false, error: "P90 cannot be less than P50 (or P10)." };
  }
  return {
    ok: true,
    value: { p10: (band.p50 * band.p50) / rawValue, p50: band.p50, p90: rawValue },
  };
}

function normalizedAllocations(
  allocations: Readonly<Record<string, number>>,
  changedFeatureId: string,
  requestedShare: number,
): ModelEditResult<Record<string, number>> {
  if (!(Number.isFinite(requestedShare) && requestedShare >= 0 && requestedShare <= 1)) {
    return { ok: false, error: "Allocation must be between 0% and 100%." };
  }

  const ids = Object.keys(allocations);
  const remainingIds = ids.filter((id) => id !== changedFeatureId);
  if (!ids.includes(changedFeatureId)) {
    return { ok: false, error: "That feature is no longer in the catalog." };
  }
  if (remainingIds.length === 0 && requestedShare !== 1) {
    return {
      ok: false,
      error: "A one-feature catalog must allocate 100% of value to that feature.",
    };
  }

  const remainingTotal = remainingIds.reduce((sum, id) => sum + allocations[id], 0);
  const next: Record<string, number> = { [changedFeatureId]: requestedShare };
  const available = 1 - requestedShare;
  remainingIds.forEach((id, index) => {
    const proportion =
      remainingTotal === 0 ? 1 / remainingIds.length : allocations[id] / remainingTotal;
    next[id] = index === remainingIds.length - 1 ? 0 : available * proportion;
  });
  if (remainingIds.length > 0) {
    const lastId = remainingIds[remainingIds.length - 1];
    next[lastId] = Math.max(0, 1 - Object.values(next).reduce((sum, value) => sum + value, 0));
  }
  return { ok: true, value: next };
}

export function editAllocationShare(
  scenario: Scenario,
  segmentId: string,
  featureId: string,
  percentage: number,
): ModelEditResult<Scenario> {
  const segment = scenario.model.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return { ok: false, error: "That segment is no longer available." };
  const allocationResult = normalizedAllocations(
    segment.featureAllocation,
    featureId,
    percentage / 100,
  );
  if (!allocationResult.ok) return allocationResult;

  return {
    ok: true,
    value: {
      ...scenario,
      model: {
        ...scenario.model,
        segments: scenario.model.segments.map((candidate) =>
          candidate.id === segmentId
            ? { ...candidate, featureAllocation: allocationResult.value }
            : candidate,
        ),
      },
    },
  };
}

export function editDirectFeatureValue(
  scenario: Scenario,
  segmentId: string,
  featureId: string,
  value: number,
): ModelEditResult<Scenario> {
  if (!(Number.isFinite(value) && value >= 0)) {
    return { ok: false, error: "Enter a non-negative dollar value." };
  }
  const segment = scenario.model.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return { ok: false, error: "That segment is no longer available." };

  const values = Object.fromEntries(
    Object.entries(segment.featureAllocation).map(([id, allocation]) => [
      id,
      id === featureId ? value : allocation * segment.wtpBand.p50,
    ]),
  );
  const total = Object.values(values).reduce((sum, current) => sum + current, 0);
  if (!(total > 0)) {
    return { ok: false, error: "At least one feature must retain positive value." };
  }

  return {
    ok: true,
    value: {
      ...scenario,
      model: {
        ...scenario.model,
        segments: scenario.model.segments.map((candidate) =>
          candidate.id === segmentId
            ? {
                ...candidate,
                wtpBand: resizeBandAtP50(candidate.wtpBand, total),
                featureAllocation: Object.fromEntries(
                  Object.entries(values).map(([id, directValue]) => [id, directValue / total]),
                ),
              }
            : candidate,
        ),
      },
    },
  };
}
