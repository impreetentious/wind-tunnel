import { describe, expect, it } from "vitest";

import { computeSegmentElasticity } from "./elasticity";
import { selectOffers } from "./envelope";
import type { ExpandedOffer } from "./types";

function offer(
  id: string,
  value: number,
  price: number,
  owner: "own" | "competitor" = "own",
): ExpandedOffer {
  return {
    id,
    name: id,
    owner,
    kind: owner === "own" ? "tier" : "competitor",
    value,
    effectivePrice: price,
    featureIds: [],
  };
}

function shareFor(offers: readonly ExpandedOffer[], sigma: number, id: string): number {
  return selectOffers(offers, sigma).shares[id] ?? 0;
}

describe("elasticity engine", () => {
  // T-ELS-01 @spec §4.13 — analytic derivatives agree with a central-difference finite
  // difference over three-offer and four-offer envelopes with σ in the working range.
  it("passes the analytic-vs-finite-difference derivative gate", () => {
    const fixtures: Array<{ offers: ExpandedOffer[]; sigma: number }> = [
      { offers: [offer("basic", 40, 20), offer("pro", 100, 60)], sigma: 0.35 },
      {
        offers: [offer("basic", 40, 20), offer("pro", 100, 60), offer("premium", 160, 110)],
        sigma: 0.5,
      },
      {
        offers: [
          offer("basic", 30, 15),
          offer("pro", 90, 55),
          offer("elite", 150, 100),
          offer("competitor", 120, 70, "competitor"),
        ],
        sigma: 0.7,
      },
    ];

    for (const fixture of fixtures) {
      const readout = computeSegmentElasticity({
        segmentId: "seg",
        sigma: fixture.sigma,
        offers: fixture.offers,
      });
      const activeIds = readout.activeOfferElasticities.map((entry) => entry.offerId);

      for (const perturbed of readout.activeOfferElasticities) {
        // Central difference on the offer's own price.
        const step = Math.max(1, Math.abs(perturbed.effectivePrice)) * 1e-4;
        const perturbUp = fixture.offers.map((candidate) =>
          candidate.id === perturbed.offerId
            ? { ...candidate, effectivePrice: candidate.effectivePrice + step }
            : candidate,
        );
        const perturbDown = fixture.offers.map((candidate) =>
          candidate.id === perturbed.offerId
            ? { ...candidate, effectivePrice: candidate.effectivePrice - step }
            : candidate,
        );

        // Own-share derivative
        const finiteOwn =
          (shareFor(perturbUp, fixture.sigma, perturbed.offerId) -
            shareFor(perturbDown, fixture.sigma, perturbed.offerId)) /
          (2 * step);
        expect(perturbed.ownShareDerivative).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(perturbed.ownShareDerivative - finiteOwn)).toBeLessThanOrEqual(
          1e-4 + 1e-3 * Math.max(1, Math.abs(finiteOwn)),
        );

        // Cross-share derivatives for every other active offer
        const relevantCross = readout.substitution.filter(
          (entry) => entry.fromOfferId === perturbed.offerId,
        );
        for (const otherId of activeIds) {
          if (otherId === perturbed.offerId) continue;
          const finiteCross =
            (shareFor(perturbUp, fixture.sigma, otherId) -
              shareFor(perturbDown, fixture.sigma, otherId)) /
            (2 * step);
          const analyticEntry = relevantCross.find((entry) => entry.toOfferId === otherId);
          const analyticValue = analyticEntry?.shareDerivative ?? 0;
          expect(Math.abs(analyticValue - finiteCross)).toBeLessThanOrEqual(
            1e-4 + 1e-3 * Math.max(1, Math.abs(finiteCross)),
          );
        }
      }
    }
  });

  // T-ELS-02 @spec §4.13 — column-sum conservation: total share is invariant, so
  // Σ_k ∂share_k / ∂P_j = 0 across every active offer for each perturbed price j.
  it("preserves total share (column-sum conservation)", () => {
    const offers = [
      offer("basic", 30, 15),
      offer("pro", 90, 55),
      offer("elite", 150, 100),
      offer("competitor", 120, 70, "competitor"),
    ];
    const readout = computeSegmentElasticity({ segmentId: "seg", sigma: 0.55, offers });

    for (const perturbed of readout.activeOfferElasticities) {
      const ownDerivative = perturbed.ownShareDerivative;
      const crossSum = readout.substitution
        .filter((entry) => entry.fromOfferId === perturbed.offerId)
        .reduce((total, entry) => total + entry.shareDerivative, 0);
      expect(Math.abs(ownDerivative + crossSum)).toBeLessThan(1e-9);
    }
  });

  // T-ELS-03 @spec §4.13 — the σ = 0 branch is degenerate: the readout is returned
  // with degenerate=true, empty elasticities, and no substitution entries.
  it("returns a degenerate readout at σ = 0", () => {
    const readout = computeSegmentElasticity({
      segmentId: "seg",
      sigma: 0,
      offers: [offer("basic", 40, 20), offer("pro", 100, 60)],
    });
    expect(readout.degenerate).toBe(true);
    expect(readout.activeOfferElasticities).toHaveLength(0);
    expect(readout.substitution).toHaveLength(0);
  });

  // T-ELS-04 @spec §4.13 — own-price demand elasticity is negative for a price-positive
  // active offer with positive share, and revenue elasticity crosses zero at the
  // grid-argmax of a price sweep (revenue is locally flat at its peak).
  it("gives negative own-price demand elasticity and revenue elasticity that crosses zero at the peak", () => {
    const offers = [offer("basic", 40, 20), offer("pro", 100, 60)];
    const readout = computeSegmentElasticity({ segmentId: "seg", sigma: 0.5, offers });
    for (const entry of readout.activeOfferElasticities) {
      if (entry.effectivePrice > 0 && entry.share > 0) {
        expect(entry.ownPriceDemandElasticity).toBeLessThan(0);
      }
    }

    // Sweep pro's price and confirm revenue elasticity changes sign around the peak.
    const proValue = 100;
    let bestRevenue = 0;
    let bestPrice = 0;
    let bestElasticity = 0;
    for (let price = 20; price <= 130; price += 2) {
      const perturbed = offers.map((candidate) =>
        candidate.id === "pro" ? { ...candidate, effectivePrice: price } : candidate,
      );
      const rd = computeSegmentElasticity({ segmentId: "seg", sigma: 0.5, offers: perturbed });
      const pro = rd.activeOfferElasticities.find((entry) => entry.offerId === "pro");
      if (!pro) continue;
      const revenue = pro.share * price;
      if (revenue > bestRevenue) {
        bestRevenue = revenue;
        bestPrice = price;
        bestElasticity = pro.ownPriceRevenueElasticity ?? 0;
      }
    }
    expect(bestPrice).toBeGreaterThan(20);
    expect(bestPrice).toBeLessThan(proValue);
    // At the discrete grid argmax, |1 + own-price demand elasticity| should be near 0.
    expect(Math.abs(bestElasticity)).toBeLessThan(0.15);
  });
});
