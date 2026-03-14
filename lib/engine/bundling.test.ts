import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { analyzeBundling, evaluateBundlingRegime, type BundlingInput } from "./bundling";

const canonical: BundlingInput = {
  tieMode: "seller-favorable",
  segments: [
    { id: "a-lover", prospectCount: 1, sigma: 0, valueA: 9, valueB: 1 },
    { id: "b-lover", prospectCount: 1, sigma: 0, valueA: 1, valueB: 9 },
  ],
};

describe("bundling analyzer", () => {
  // @spec §4.6 T-BND-01
  it("reproduces the canonical negative-correlation bundle advantage", () => {
    const result = analyzeBundling(canonical);
    expect(result.components.prices).toMatchObject({ a: 9, b: 9 });
    expect(result.components.revenue).toBe(18);
    expect(result.pureBundle.prices.bundle).toBe(10);
    expect(result.pureBundle.revenue).toBe(20);
    expect(result.pureBundle.revenue - result.components.revenue).toBe(2);
  });

  // @spec §4.6 T-BND-02
  it("keeps mixed bundling at least as good as either nested regime", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            valueA: fc.integer({ min: 1, max: 20 }),
            valueB: fc.integer({ min: 1, max: 20 }),
            prospectCount: fc.integer({ min: 1, max: 10 }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        (segments) => {
          const result = analyzeBundling({
            tieMode: "seller-favorable",
            segments: segments.map((segment, index) => ({ ...segment, id: `s${index}`, sigma: 0 })),
          });
          expect(result.mixed.revenue + 1e-9).toBeGreaterThanOrEqual(
            Math.max(result.components.revenue, result.pureBundle.revenue),
          );
        },
      ),
      { numRuns: 20 },
    );
  });

  // @spec §4.6 T-BND-03
  it("matches an independent exhaustive grid on random point-mass fixtures", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 })), {
          minLength: 1,
          maxLength: 3,
        }),
        (values) => {
          const input: BundlingInput = {
            tieMode: "seller-favorable",
            segments: values.map(([valueA, valueB], index) => ({
              id: `s${index}`,
              prospectCount: index + 1,
              sigma: 0,
              valueA,
              valueB,
            })),
          };
          const result = analyzeBundling(input);
          let independentBest = 0;
          const optionalA = [undefined, ...result.candidates.a];
          const optionalB = [undefined, ...result.candidates.b];
          const optionalBundle = [undefined, ...result.candidates.bundle];
          for (const a of optionalA) {
            for (const b of optionalB) {
              for (const bundle of optionalBundle) {
                if (a === undefined && b === undefined && bundle === undefined) continue;
                if (
                  a !== undefined &&
                  b !== undefined &&
                  bundle !== undefined &&
                  bundle > a + b + 1e-9
                )
                  continue;
                independentBest = Math.max(
                  independentBest,
                  evaluateBundlingRegime(input, "mixed", { a, b, bundle }).mrr,
                );
              }
            }
          }
          for (const a of result.candidates.a) {
            for (const b of result.candidates.b) {
              independentBest = Math.max(
                independentBest,
                evaluateBundlingRegime(input, "mixed", { a, b, bundle: a + b }).mrr,
              );
            }
          }
          expect(result.mixed.revenue).toBeCloseTo(independentBest, 9);
        },
      ),
      { numRuns: 10 },
    );
  });

  // @spec §4.6 T-BND-04
  it("keeps conservative offer ties on the cheaper alternative", () => {
    const input: BundlingInput = {
      segments: [{ id: "tie", prospectCount: 1, sigma: 0, valueA: 10, valueB: 10 }],
    };
    const conservative = evaluateBundlingRegime(input, "mixed", { a: 5, bundle: 15 });
    const seller = evaluateBundlingRegime({ ...input, tieMode: "seller-favorable" }, "mixed", {
      a: 5,
      bundle: 15,
    });
    expect(conservative.mrr).toBe(5);
    expect(seller.mrr).toBe(15);
  });
});

// §4.6's regimes are only comparable if each one is evaluated on a menu that is
// actually valid for it. These pin the refusals — a components menu missing a
// price, or a mixed menu whose bundle costs more than buying both parts, which
// would make the "bundle" a strictly dominated decoy rather than a bundle.
describe("bundling menu validity", () => {
  // @spec §4.6 T-BND-G1
  it("rejects an empty or malformed segment list", () => {
    expect(() => analyzeBundling({ ...canonical, segments: [] })).toThrow(RangeError);
    expect(() =>
      analyzeBundling({
        ...canonical,
        segments: [canonical.segments[0], { ...canonical.segments[0] }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      analyzeBundling({
        ...canonical,
        segments: [{ ...canonical.segments[0], id: "" }],
      }),
    ).toThrow(RangeError);

    for (const field of ["prospectCount", "sigma", "valueA", "valueB"] as const) {
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          analyzeBundling({
            ...canonical,
            segments: [{ ...canonical.segments[0], [field]: bad }],
          }),
        ).toThrow(RangeError);
      }
    }
  });

  // @spec §4.6 T-BND-G2
  it("requires both component prices for a pure-components menu", () => {
    expect(() => evaluateBundlingRegime(canonical, "components", { a: 5 })).toThrow(RangeError);
    expect(() => evaluateBundlingRegime(canonical, "components", { b: 5 })).toThrow(RangeError);
    expect(() => evaluateBundlingRegime(canonical, "components", {})).toThrow(RangeError);
    expect(() => evaluateBundlingRegime(canonical, "components", { a: 5, b: 5 })).not.toThrow();
  });

  // @spec §4.6 T-BND-G3
  it("requires a bundle price for a pure-bundle menu", () => {
    expect(() => evaluateBundlingRegime(canonical, "pure-bundle", {})).toThrow(RangeError);
    expect(() => evaluateBundlingRegime(canonical, "pure-bundle", { bundle: 9 })).not.toThrow();
  });

  // @spec §4.6 T-BND-G4
  it("rejects a mixed menu that is empty or prices the bundle above its parts", () => {
    expect(() => evaluateBundlingRegime(canonical, "mixed", {})).toThrow(RangeError);
    expect(() => evaluateBundlingRegime(canonical, "mixed", { a: 5, b: 5, bundle: 11 })).toThrow(
      RangeError,
    );
    expect(() =>
      evaluateBundlingRegime(canonical, "mixed", { a: 5, b: 5, bundle: 9 }),
    ).not.toThrow();
    // A partial mixed menu is legal — it degenerates to one component plus a bundle.
    expect(() => evaluateBundlingRegime(canonical, "mixed", { a: 5, bundle: 9 })).not.toThrow();
  });
});
