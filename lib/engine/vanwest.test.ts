import { describe, expect, it } from "vitest";

import { analyzeVanWestendorp, validateVanWestendorpResponses } from "./vanwest";

describe("Van Westendorp price sensitivity meter", () => {
  // T-VW-01 @spec §4.7
  it("drops exactly the respondents whose price quadruple violates monotonicity", () => {
    const responses = [
      { tooCheap: 10, cheap: 20, expensive: 40, tooExpensive: 60 },
      { tooCheap: 20, cheap: 15, expensive: 40, tooExpensive: 60 },
      { tooCheap: 15, cheap: 30, expensive: 50, tooExpensive: 45 },
      { tooCheap: 8, cheap: 12, expensive: 18, tooExpensive: 25 },
    ];

    const result = validateVanWestendorpResponses(responses);

    expect(result.validResponses).toEqual([responses[0], responses[3]]);
    expect(result.violations.map((violation) => violation.index)).toEqual([1, 2]);
    expect(result.violations.every((violation) => violation.reason.includes("too cheap"))).toBe(
      true,
    );
  });

  // T-VW-02 @spec §4.7
  it("keeps IPP and OPP at 50 for a synthetic distribution mirrored around 50", () => {
    const result = analyzeVanWestendorp([
      { tooCheap: 10, cheap: 10, expensive: 20, tooExpensive: 60 },
      { tooCheap: 40, cheap: 80, expensive: 90, tooExpensive: 90 },
      { tooCheap: 40, cheap: 40, expensive: 40, tooExpensive: 50 },
      { tooCheap: 50, cheap: 60, expensive: 60, tooExpensive: 60 },
      { tooCheap: 30, cheap: 50, expensive: 50, tooExpensive: 90 },
      { tooCheap: 10, cheap: 50, expensive: 50, tooExpensive: 70 },
    ]);

    expect(result.points.ipp.price).toBe(50);
    expect(result.points.opp.price).toBe(50);
    expect(result.points.pmc.price).toBeCloseTo(46.666666666666664, 12);
    expect(result.points.pme.price).toBeCloseTo(53.333333333333336, 12);
    expect((result.points.pmc.price ?? 0) + (result.points.pme.price ?? 0)).toBeCloseTo(100, 12);
  });

  // T-VW-03 @spec §4.7
  it("matches all four linearly interpolated crossings for a hand-computed five-respondent fixture", () => {
    const result = analyzeVanWestendorp([
      { tooCheap: 10, cheap: 20, expensive: 40, tooExpensive: 60 },
      { tooCheap: 15, cheap: 25, expensive: 45, tooExpensive: 65 },
      { tooCheap: 20, cheap: 30, expensive: 50, tooExpensive: 70 },
      { tooCheap: 25, cheap: 35, expensive: 55, tooExpensive: 75 },
      { tooCheap: 30, cheap: 40, expensive: 60, tooExpensive: 80 },
    ]);

    // From the ordered grid: PMC crosses halfway from 25→30; IPP at 40;
    // OPP reaches its shared zero at 35; PME crosses halfway from 55→60.
    expect(result.points.pmc.price).toBeCloseTo(27.5, 12);
    expect(result.points.pme.price).toBeCloseTo(57.5, 12);
    expect(result.points.ipp.price).toBeCloseTo(40, 12);
    expect(result.points.opp.price).toBeCloseTo(35, 12);
    expect(result.acceptableRange).toEqual({ low: 27.5, high: 57.5 });
  });

  // T-VW-04 @spec §4.7
  it("reports undefined markers when degenerate data cannot define a crossing", () => {
    const result = analyzeVanWestendorp([
      { tooCheap: 10, cheap: 10, expensive: 10, tooExpensive: 10 },
      { tooCheap: 10, cheap: 10, expensive: 10, tooExpensive: 10 },
    ]);

    expect(result.curves).toHaveLength(1);
    expect(Object.values(result.points).map((point) => point.price)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(result.acceptableRange).toBeUndefined();
  });
});

// §4.7 is explicit that degenerate PSM data yields *undefined* markers rather
// than invented prices. These pin the paths that produce them: no valid
// responses at all, a single respondent (no curve to cross), and an exact
// crossing that needs no interpolation.
describe("Van Westendorp degenerate data", () => {
  const response = (tooCheap: number, cheap: number, expensive: number, tooExpensive: number) => ({
    tooCheap,
    cheap,
    expensive,
    tooExpensive,
  });

  // T-VW-G1 @spec §4.7
  it("drops non-finite and negative prices as violations", () => {
    const { validResponses, violations } = validateVanWestendorpResponses([
      response(Number.NaN, 10, 20, 30),
      response(-1, 10, 20, 30),
      response(5, 10, 20, Number.POSITIVE_INFINITY),
      response(5, 10, 20, 30),
    ]);
    expect(validResponses).toHaveLength(1);
    expect(violations).toHaveLength(3);
    expect(violations[0].reason).toMatch(/finite, non-negative/);
  });

  // T-VW-G2 @spec §4.7
  it("returns undefined markers when nothing survives validation", () => {
    const result = analyzeVanWestendorp([response(Number.NaN, 10, 20, 30)]);
    expect(result.curves).toEqual([]);
    for (const marker of Object.values(result.points)) {
      expect(marker.price).toBeUndefined();
    }
    expect(result.acceptableRange).toBeUndefined();
  });

  // T-VW-G3 @spec §4.7
  it("returns undefined markers for an empty response set", () => {
    const result = analyzeVanWestendorp([]);
    expect(result.validResponses).toEqual([]);
    expect(result.curves).toEqual([]);
    expect(Object.values(result.points).every((marker) => marker.price === undefined)).toBe(true);
  });

  // T-VW-G4 @spec §4.7 — a lone respondent still yields four price points, so
  // the curves cross; every marker must land inside that respondent's own
  // range rather than being extrapolated beyond it.
  it("keeps a single respondent's crossings inside their own price range", () => {
    const result = analyzeVanWestendorp([response(5, 10, 20, 30)]);
    expect(result.validResponses).toHaveLength(1);
    expect(result.curves.length).toBeGreaterThan(0);
    for (const marker of Object.values(result.points)) {
      if (marker.price === undefined) continue;
      expect(marker.price).toBeGreaterThanOrEqual(5);
      expect(marker.price).toBeLessThanOrEqual(30);
    }
    if (result.acceptableRange) {
      expect(result.acceptableRange.low).toBeLessThanOrEqual(result.acceptableRange.high);
    }
  });
});
