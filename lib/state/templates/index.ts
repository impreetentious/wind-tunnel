import { scenarioSchema, type Scenario } from "../schemas";
import { apiInfrastructureTemplate } from "./api-infrastructure";
import { plgCollaborationTemplate } from "./plg-collaboration";
import { salesLedB2bTemplate } from "./sales-led-b2b";

export interface ScenarioTemplate {
  id: string;
  title: string;
  description: string;
  scenario: Scenario;
}

const rawTemplates: readonly ScenarioTemplate[] = [
  {
    id: "plg-collaboration",
    title: "PLG collaboration tool",
    description: "Per-seat tiers with a free plan for a bottom-up motion.",
    scenario: plgCollaborationTemplate,
  },
  {
    id: "api-infrastructure",
    title: "API and infrastructure product",
    description: "Flat account tiers with an observability add-on.",
    scenario: apiInfrastructureTemplate,
  },
  {
    id: "sales-led-b2b",
    title: "Sales-led B2B platform",
    description: "Two paid tiers with a distinct enterprise fence.",
    scenario: salesLedB2bTemplate,
  },
];

/** Validate template fixtures once at module load so bad seed data cannot reach the UI. */
export const scenarioTemplates: readonly ScenarioTemplate[] = rawTemplates.map((template) => ({
  ...template,
  scenario: scenarioSchema.parse(template.scenario),
}));

export { apiInfrastructureTemplate, plgCollaborationTemplate, salesLedB2bTemplate };
