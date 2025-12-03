import type { Scenario } from "../schemas";
import { guess, scenarioBase } from "./shared";

export const plgCollaborationTemplate: Scenario = scenarioBase({
  id: "template-plg-collaboration",
  name: "PLG collaboration tool",
  status: "ready",
  model: {
    features: [
      { id: "workspace", name: "Shared workspaces" },
      { id: "collaboration", name: "Real-time collaboration" },
      { id: "admin", name: "Admin controls" },
      { id: "security", name: "Advanced security" },
    ],
    segments: [
      {
        id: "team",
        name: "Growing teams",
        prospectBand: { p10: 800, p50: 1200, p90: 1800 },
        seatCount: 8,
        wtpBand: { p10: 200, p50: 250, p90: 312.5 },
        withinSegmentSigma: 0.42,
        featureAllocation: { workspace: 0.22, collaboration: 0.48, admin: 0.2, security: 0.1 },
        provenance: {
          prospectCount: guess,
          willingnessToPay: guess,
          featureValues: { workspace: guess, collaboration: guess, admin: guess, security: guess },
        },
      },
      {
        id: "scale",
        name: "Scaling organisations",
        prospectBand: { p10: 100, p50: 150, p90: 225 },
        seatCount: 40,
        wtpBand: { p10: 1280, p50: 1600, p90: 2000 },
        withinSegmentSigma: 0.32,
        featureAllocation: { workspace: 0.12, collaboration: 0.23, admin: 0.27, security: 0.38 },
        provenance: {
          prospectCount: guess,
          willingnessToPay: guess,
          featureValues: { workspace: guess, collaboration: guess, admin: guess, security: guess },
        },
      },
    ],
    interactions: [],
  },
  designs: [
    {
      id: "plg-baseline",
      name: "Baseline packaging",
      tiers: [
        { id: "free", name: "Free", price: 0, priceMetric: "per-seat", featureIds: ["workspace"] },
        {
          id: "team-tier",
          name: "Team",
          price: 12,
          priceMetric: "per-seat",
          featureIds: ["workspace", "collaboration"],
        },
        {
          id: "business-tier",
          name: "Business",
          price: 24,
          priceMetric: "per-seat",
          featureIds: ["workspace", "collaboration", "admin", "security"],
        },
      ],
      addOns: [],
    },
  ],
  activeDesignId: "plg-baseline",
  competitors: [],
});
