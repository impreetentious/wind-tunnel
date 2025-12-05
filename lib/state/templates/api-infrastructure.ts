import type { Scenario } from "../schemas";
import { guess, scenarioBase } from "./shared";

export const apiInfrastructureTemplate: Scenario = scenarioBase({
  id: "template-api-infrastructure",
  name: "API and infrastructure product",
  status: "ready",
  model: {
    features: [
      { id: "requests", name: "API request capacity" },
      { id: "observability", name: "Observability" },
      { id: "support", name: "Priority support" },
      { id: "compliance", name: "Compliance controls" },
    ],
    segments: [
      {
        id: "builder",
        name: "Product builders",
        prospectBand: { p10: 400, p50: 600, p90: 900 },
        seatCount: 4,
        wtpBand: { p10: 40, p50: 50, p90: 62.5 },
        withinSegmentSigma: 0.5,
        featureAllocation: { requests: 0.55, observability: 0.25, support: 0.15, compliance: 0.05 },
        provenance: {
          prospectCount: guess,
          willingnessToPay: guess,
          featureValues: {
            requests: guess,
            observability: guess,
            support: guess,
            compliance: guess,
          },
        },
      },
      {
        id: "platform",
        name: "Platform teams",
        prospectBand: { p10: 80, p50: 120, p90: 180 },
        seatCount: 12,
        wtpBand: { p10: 160, p50: 200, p90: 250 },
        withinSegmentSigma: 0.38,
        featureAllocation: { requests: 0.28, observability: 0.26, support: 0.19, compliance: 0.27 },
        provenance: {
          prospectCount: guess,
          willingnessToPay: guess,
          featureValues: {
            requests: guess,
            observability: guess,
            support: guess,
            compliance: guess,
          },
        },
      },
    ],
    interactions: [],
    usageMetrics: [],
  },
  designs: [
    {
      id: "api-baseline",
      name: "Baseline packaging",
      tiers: [
        {
          id: "build-tier",
          name: "Build",
          price: 49,
          priceMetric: "flat",
          featureIds: ["requests", "observability"],
        },
        {
          id: "scale-tier",
          name: "Scale",
          price: 199,
          priceMetric: "flat",
          featureIds: ["requests", "observability", "support", "compliance"],
        },
      ],
      addOns: [
        {
          id: "extra-observability",
          name: "Extended observability",
          price: 79,
          priceMetric: "flat",
          featureIds: ["observability"],
        },
      ],
    },
  ],
  activeDesignId: "api-baseline",
  competitors: [],
});
