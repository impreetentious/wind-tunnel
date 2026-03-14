import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { selectOfferAtScale, selectOffers } from "./envelope";
import { normalInv } from "./stats";
import type { ExpandedOffer } from "./types";

function offer(id: string, value: number, effectivePrice: number): ExpandedOffer {
  return {
    id,
    name: id,
    owner: "own",
    kind: "tier",
    value,
    effectivePrice,
    featureIds: [],
  };
}

const outside: ExpandedOffer = {
  id: "outside",
  name: "Outside option",
  owner: "outside",
  kind: "outside",
  value: 0,
  effectivePrice: 0,
  featureIds: [],
};

function bruteForceConservativeWinner(
  offers: readonly ExpandedOffer[],
  scale: number,
): ExpandedOffer {
  return [...offers].sort((left, right) => {
    const utilityDelta =
      scale * right.value - right.effectivePrice - (scale * left.value - left.effectivePrice);
    if (Math.abs(utilityDelta) > 1e-9) return utilityDelta;
    const priceDelta = left.effectivePrice - right.effectivePrice;
    if (Math.abs(priceDelta) > 1e-9) return priceDelta;
    const valueDelta = left.value - right.value;
    if (Math.abs(valueDelta) > 1e-9) return valueDelta;
    return left.id.localeCompare(right.id);
  })[0];
}

function activeOfferAtScale(
  result: ReturnType<typeof selectOffers>,
  scale: number,
): ExpandedOffer | undefined {
  return result.active.find((interval) => scale > interval.lower && scale <= interval.upper)?.offer;
}

describe("utility upper envelope", () => {
  // T-ENV-01 @spec §4.2
  it("assigns zero share to a dominated offer for every sigma", () => {
    for (const sigma of [0, 0.25, 0.9, 2]) {
      const result = selectOffers(
        [outside, offer("better", 100, 50), offer("dominated", 80, 70)],
        sigma,
      );
      expect(result.shares.dominated).toBe(0);
    }
  });

  // T-ENV-02 @spec §4.2
  it("returns strictly increasing breakpoints and shares that conserve all buyers", () => {
    const result = selectOffers(
      [outside, offer("basic", 80, 25), offer("pro", 180, 90), offer("enterprise", 400, 250)],
      0.6,
    );
    for (let index = 1; index < result.active.length; index += 1) {
      expect(result.active[index].lower).toBeGreaterThan(result.active[index - 1].lower);
    }
    expect(Object.values(result.shares).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
  });

  // T-ENV-03 @spec §4.2
  it("agrees with an independent direct argmax away from every breakpoint", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            value: fc.integer({ min: 1, max: 500 }),
            price: fc.integer({ min: 0, max: 500 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        fc.double({ min: 0.05, max: 2, noNaN: true }),
        (inputOffers, sigma) => {
          const offers = [
            outside,
            ...inputOffers.map((entry, index) => offer(`offer-${index}`, entry.value, entry.price)),
          ];
          const result = selectOffers(offers, sigma);
          for (let index = 0; index < 1_000; index += 1) {
            const scale = Math.exp(sigma * normalInv((index + 0.5) / 1_000));
            const isAwayFromBreakpoint = result.active.every(
              (interval) =>
                Math.abs(scale - interval.lower) > 1e-9 && Math.abs(scale - interval.upper) > 1e-9,
            );
            if (!isAwayFromBreakpoint) continue;
            expect(activeOfferAtScale(result, scale)?.id).toBe(
              bruteForceConservativeWinner(offers, scale).id,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // T-ENV-04 @spec §4.2
  it("uses the documented tie mode on the sigma=0 point mass", () => {
    const menu = [outside, offer("paid", 100, 100)];
    expect(selectOffers(menu, 0).selectedAtMedianId).toBe("outside");
    expect(selectOffers(menu, 0, { tieMode: "seller-favorable" }).selectedAtMedianId).toBe("paid");
  });

  // T-ENV-05 @spec §4.2
  it("gives a positive-value free tier all positive-scale low-end mass", () => {
    const result = selectOffers([outside, offer("free", 60, 0), offer("paid", 200, 120)], 0.7);
    expect(result.shares.outside).toBe(0);
    expect(result.shares.free).toBeGreaterThan(0);
  });

  // P1 tie-mode acceptance guard @spec §4.2
  // @spec §4.12 — 1e-9 tie tolerance and deterministic tie policy
  it("makes the two tie modes diverge for participation and offer-to-offer ties", () => {
    const participation = [outside, offer("paid", 100, 100)];
    expect(selectOfferAtScale(participation, 1, { tieMode: "conservative" }).id).toBe("outside");
    expect(selectOfferAtScale(participation, 1, { tieMode: "seller-favorable" }).id).toBe("paid");

    const offerTie = [outside, offer("basic", 100, 20), offer("pro", 200, 120)];
    expect(selectOfferAtScale(offerTie, 1, { tieMode: "conservative" }).id).toBe("basic");
    expect(selectOfferAtScale(offerTie, 1, { tieMode: "seller-favorable" }).id).toBe("pro");
  });

  // T-CMP-08 @spec §4.2
  it("attributes exact own/competitor ties to the competitor independently of input order", () => {
    const competitor: ExpandedOffer = {
      ...offer("competitor", 100, 40),
      owner: "competitor",
      kind: "competitor",
    };
    const own = offer("own", 100, 40);
    const forward = selectOffers([outside, own, competitor], 0);
    const reversed = selectOffers([competitor, outside, own], 0);

    expect(forward.shares.competitor).toBe(1);
    expect(forward.shares.own).toBe(0);
    expect(reversed.shares).toEqual(forward.shares);
  });
});

// Every offer entering the envelope comes from user-editable state, so the
// guards below are the boundary between "the model refuses" and "the model
// silently computes on garbage". They are the branches a valid fixture cannot
// reach by construction.
describe("upper envelope input guards", () => {
  const valid = [offer("a", 10, 5), offer("b", 20, 12)];

  // @spec §4.3 T-ENV-G1
  it("rejects malformed offers", () => {
    const cases: ExpandedOffer[] = [
      { ...offer("x", 10, 5), id: "" },
      { ...offer("x", Number.NaN, 5) },
      { ...offer("x", -1, 5) },
      { ...offer("x", 10, Number.POSITIVE_INFINITY) },
      { ...offer("x", 10, -5) },
    ];
    for (const bad of cases) {
      expect(() => selectOfferAtScale([bad, ...valid], 1)).toThrow(RangeError);
      expect(() => selectOffers([bad, ...valid], 0.3)).toThrow(RangeError);
    }
  });

  // @spec §4.3 T-ENV-G2
  it("rejects duplicate offer IDs", () => {
    const duplicated = [offer("a", 10, 5), offer("a", 20, 12)];
    expect(() => selectOfferAtScale(duplicated, 1)).toThrow(RangeError);
    expect(() => selectOffers(duplicated, 0.3)).toThrow(RangeError);
  });

  // @spec §4.3 T-ENV-G3
  it("rejects a non-finite or negative scale, sigma, or tie tolerance", () => {
    expect(() => selectOfferAtScale(valid, -1)).toThrow(RangeError);
    expect(() => selectOfferAtScale(valid, Number.NaN)).toThrow(RangeError);
    expect(() => selectOfferAtScale(valid, 1, { tieTolerance: -1 })).toThrow(RangeError);
    expect(() => selectOfferAtScale(valid, 1, { tieTolerance: Number.NaN })).toThrow(RangeError);

    expect(() => selectOffers(valid, -0.1)).toThrow(RangeError);
    expect(() => selectOffers(valid, Number.NaN)).toThrow(RangeError);
    expect(() => selectOffers(valid, 0.3, { tieTolerance: -1 })).toThrow(RangeError);
  });

  // @spec §4.3 T-ENV-G4 — sigma = 0 collapses to a single deterministic pick.
  it("gives a degenerate segment all of its mass to one offer", () => {
    const selection = selectOffers([...valid, outside], 0);
    const chosen = selection.selectedAtMedianId;
    expect(chosen).toBeDefined();
    expect(selection.shares[chosen ?? ""]).toBe(1);
    const others = Object.entries(selection.shares).filter(([id]) => id !== chosen);
    expect(others.every(([, share]) => share === 0)).toBe(true);
  });
});

// §4.3's tie ladder is price, then value, then the outside-option preference,
// then id. Only an exact tie at every earlier rung reaches the next one, so
// each rung needs its own fixture. `seller-favorable` is the mirror of
// `conservative` at every step and must not share a code path by accident.
describe("upper envelope tie ladder", () => {
  const canonicalOutside: ExpandedOffer = {
    id: "outside",
    name: "Outside option",
    owner: "outside",
    kind: "outside",
    value: 0,
    effectivePrice: 0,
    featureIds: [],
  };

  // @spec §4.3 T-ENV-T1 — equal surplus at scale 1, different price and value.
  it("breaks a utility tie on price in both directions", () => {
    // Surplus 1·10 − 5 = 5 and 1·20 − 15 = 5: tied utility, different price.
    const offers = [offer("cheap", 10, 5), offer("dear", 20, 15), canonicalOutside];
    expect(selectOfferAtScale(offers, 1, { tieMode: "conservative" }).id).toBe("cheap");
    expect(selectOfferAtScale(offers, 1, { tieMode: "seller-favorable" }).id).toBe("dear");
  });

  // @spec §4.3 T-ENV-T2 — identical rows fall through to the id comparison.
  it("settles a total tie deterministically by id", () => {
    const identical = [offer("b", 20, 10), offer("a", 20, 10), canonicalOutside];
    expect(selectOfferAtScale(identical, 1, { tieMode: "conservative" }).id).toBe("a");
    expect(selectOfferAtScale(identical, 1, { tieMode: "seller-favorable" }).id).toBe("a");
  });

  // @spec §4.3 T-ENV-T3 — a paid offer exactly matching the outside option.
  it("prefers the outside option only when conservative", () => {
    const offers = [offer("free", 0, 0), canonicalOutside];
    expect(selectOfferAtScale(offers, 1, { tieMode: "conservative" }).id).toBe("outside");
    expect(selectOfferAtScale(offers, 1, { tieMode: "seller-favorable" }).id).toBe("free");
  });

  // @spec §4.3 T-ENV-T4 — the reserved id must carry the canonical row.
  it("rejects an offer that claims the outside id without the outside shape", () => {
    expect(() =>
      selectOfferAtScale([{ ...canonicalOutside, owner: "own" }, offer("a", 10, 5)], 1),
    ).toThrow(RangeError);
    expect(() =>
      selectOfferAtScale([{ ...canonicalOutside, value: 5 }, offer("a", 10, 5)], 1),
    ).toThrow(RangeError);
    expect(() =>
      selectOfferAtScale([{ ...canonicalOutside, effectivePrice: 5 }, offer("a", 10, 5)], 1),
    ).toThrow(RangeError);
    expect(() =>
      selectOfferAtScale([{ ...canonicalOutside, kind: "tier" }, offer("a", 10, 5)], 1),
    ).toThrow(RangeError);
  });
});
