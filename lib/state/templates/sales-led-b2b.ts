import type { Scenario } from "../schemas";
import { guess, scenarioBase } from "./shared";

export const salesLedB2bTemplate: Scenario = scenarioBase({
  id: "template-sales-led-b2b",
  name: "Sales-led B2B platform",
  status: "ready",
  model: {
    features: [
      { id: "core", name: "Core workflow" },
      { id: "automation", name: "Workflow automation" },
      { id: "governance", name: "Governance" },
      { id: "enterprise", name: "Enterprise controls" },
    ],
    segments: [
      {
        id: "midmarket",
        name: "Mid-market teams",
        prospectBand: { p10: 200, p50: 300, p90: 450 },
        seatCount: 25,
        wtpBand: { p10: 400, p50: 500, p90: 625 },
        withinSegmentSigma: 0.3,
        featureAllocation: { core: 0.34, automation: 0.38, governance: 0.2, enterprise: 0.08 },
        provenance: {
          prospectCount: guess,
          willingnessToPay: guess,
          featureValues: { core: guess, automation: guess, governance: guess, enterprise: guess },
        },
      },
      {
        id: "enterprise-buyers",
        name: "Enterprise buyers",
        prospectBand: { p10: 40, p50: 60, p90: 90 },
        seatCount: 120,
        wtpBand: { p10: 1600, p50: 2000, p90: 2500 },
        withinSegmentSigma: 0.25,
        featureAllocation: { core: 0.14, automation: 0.21, governance: 0.28, enterprise: 0.37 },
        provenance: {
          prospectCount: guess,
          willingnessToPay: guess,
          featureValues: { core: guess, automation: guess, governance: guess, enterprise: guess },
        },
      },
    ],
    interactions: [],
  },
  designs: [
    {
      id: "sales-baseline",
      name: "Baseline packaging",
      tiers: [
        {
          id: "growth-tier",
          name: "Growth",
          price: 499,
          priceMetric: "flat",
          featureIds: ["core", "automation"],
        },
        {
          id: "enterprise-tier",
          name: "Enterprise",
          price: 1999,
          priceMetric: "flat",
          featureIds: ["core", "automation", "governance", "enterprise"],
        },
      ],
      addOns: [],
    },
  ],
  activeDesignId: "sales-baseline",
  competitors: [],
});
