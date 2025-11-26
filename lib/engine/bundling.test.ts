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
