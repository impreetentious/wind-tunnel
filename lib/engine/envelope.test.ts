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
