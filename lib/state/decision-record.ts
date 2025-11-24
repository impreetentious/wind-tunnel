import { analyzeVanWestendorp } from "@/lib/engine/vanwest";

import { activeDesign } from "./design-editing";
import {
  runScenarioMonteCarlo,
  simulateScenarioDesign,
  uncertaintyParametersForScenario,
} from "./scenario-economics";
import { lintScenarioDesign } from "./scenario-linter";
import type { Scenario } from "./schemas";

export const DECISION_RECORD_DRAW_COUNT = 1_000;

type Provenance = Scenario["model"]["segments"][number]["provenance"]["prospectCount"];

export interface DecisionRecordDriver {
  label: string;
  lowDelta: number;
  highDelta: number;
  maximumAbsoluteDelta: number;
  provenance: Provenance;
  validationAction: string;
}

export interface PricingDecisionRecord {
  generatedOn: string;
  scenario: Scenario;
  activeDesign: Scenario["designs"][number];
  economics: ReturnType<typeof simulateScenarioDesign>;
  alternatives: readonly {
    id: string;
    name: string;
    economics: ReturnType<typeof simulateScenarioDesign>;
  }[];
  findings: ReturnType<typeof lintScenarioDesign>;
  uncertainty:
    | {
        drawCount: number;
        p10: number;
        p50: number;
        p90: number;
        drivers: readonly DecisionRecordDriver[];
      }
    | undefined;
  research:
    | {
        source: "survey" | "illustrative";
        responseCount: number;
        validCount: number;
        excludedCount: number;
        acceptableRange: { low: number; high: number } | undefined;
        points: ReturnType<typeof analyzeVanWestendorp>["points"];
      }
    | undefined;
  markdown: string;
}

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

export function formatRecordMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(value) < 100 ? 1 : 0,
  }).format(value);
}

export function formatRecordPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function provenanceLabel(provenance: Provenance) {
  const note = provenance.note ? ` — ${provenance.note}` : "";
  return `${provenance.kind}, ${provenance.confidence} confidence${note}`;
}

function validationAction(provenance: Provenance) {
  switch (provenance.kind) {
    case "guess":
      return "Replace the guess with interview or survey evidence.";
    case "interview":
      return "Test the interview signal with a broader, segment-matched sample.";
    case "survey":
      return "Review sample fit and tighten the stated range where the data supports it.";
    case "conjoint":
      return "Re-check study fit, uncertainty, and the mapping into this segment.";
    case "benchmark":
      return "Re-check the benchmark source and its fit to this product and segment.";
  }
}

function tableCell(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function metric(value: number | undefined, formatter: (value: number) => string) {
  return value === undefined ? "Not available" : formatter(value);
}

function pointPrice(
  point: ReturnType<typeof analyzeVanWestendorp>["points"][keyof ReturnType<
    typeof analyzeVanWestendorp
  >["points"]],
  currency: string,
) {
  return point.price === undefined
    ? "Undefined for this data"
    : formatRecordMoney(point.price, currency);
}

function recordMarkdown(record: Omit<PricingDecisionRecord, "markdown">) {
  const { scenario, activeDesign, economics, uncertainty, research } = record;
  const currency = scenario.settings.currency;
  const lines: string[] = [
    `# Pricing Decision Record — ${scenario.name}`,
    "",
    `Generated ${record.generatedOn} · Seed ${scenario.settings.seed} · ${currency} · Scenario status: ${scenario.status}`,
    "",
    "> This record reports what the stated assumptions imply. It is not a claim that the model found a universally correct price.",
    "",
    "## Decision snapshot",
    "",
    `The active design **${activeDesign.name}** produces ${metric(economics?.mrr, (value) => formatRecordMoney(value, currency))} modeled monthly recurring revenue at the P50 assumptions, with ${metric(economics?.paidConversion, formatRecordPercent)} paid conversion and ${metric(economics?.captureRate, formatRecordPercent)} value capture.`,
    uncertainty
      ? `Across ${formatNumber(uncertainty.drawCount, 0)} seeded assumption draws, modeled MRR spans ${formatRecordMoney(uncertainty.p10, currency)} at P10 to ${formatRecordMoney(uncertainty.p90, currency)} at P90.`
      : "An uncertainty summary is unavailable until the scenario has buyer assumptions.",
    record.findings.length > 0
      ? `The deterministic critic reports ${record.findings.length} finding${record.findings.length === 1 ? "" : "s"}; each is listed below without an invented uplift estimate.`
      : "No deterministic linter rule is currently firing.",
    "",
    "## Assumptions and provenance",
    "",
  ];

  if (scenario.model.segments.length === 0) {
    lines.push("No buyer segments have been entered.", "");
  } else {
    for (const segment of scenario.model.segments) {
      lines.push(
        `### ${segment.name}`,
        "",
        "| Assumption | P10 | P50 | P90 | Provenance |",
        "| --- | ---: | ---: | ---: | --- |",
        `| Prospects | ${formatNumber(segment.prospectBand.p10, 0)} | ${formatNumber(segment.prospectBand.p50, 0)} | ${formatNumber(segment.prospectBand.p90, 0)} | ${tableCell(provenanceLabel(segment.provenance.prospectCount))} |`,
        `| Account WTP | ${formatRecordMoney(segment.wtpBand.p10, currency)} | ${formatRecordMoney(segment.wtpBand.p50, currency)} | ${formatRecordMoney(segment.wtpBand.p90, currency)} | ${tableCell(provenanceLabel(segment.provenance.willingnessToPay))} |`,
        `| Seats per account | — | ${formatNumber(segment.seatCount, 0)} | — | Model input |`,
        `| Within-segment spread (σ) | — | ${formatNumber(segment.withinSegmentSigma, 2)} | — | Buyer heterogeneity, not assumption uncertainty |`,
        "",
        "| Feature | P50 account value | Allocation | Provenance |",
        "| --- | ---: | ---: | --- |",
      );
      for (const feature of scenario.model.features) {
        const allocation = segment.featureAllocation[feature.id] ?? 0;
        lines.push(
          `| ${tableCell(feature.name)} | ${formatRecordMoney(segment.wtpBand.p50 * allocation, currency)} | ${formatRecordPercent(allocation)} | ${tableCell(provenanceLabel(segment.provenance.featureValues[feature.id]))} |`,
        );
      }
      lines.push("");
    }
  }

  lines.push(
    "## Active packaging design",
    "",
    "| Tier | Monthly list price | Metric | Included features |",
    "| --- | ---: | --- | --- |",
  );
  if (activeDesign.tiers.length === 0) {
    lines.push("| No tiers | — | — | — |");
  } else {
    for (const tier of activeDesign.tiers) {
      const names = tier.featureIds.map(
        (id) => scenario.model.features.find((feature) => feature.id === id)?.name ?? id,
      );
      lines.push(
        `| ${tableCell(tier.name)} | ${formatRecordMoney(tier.price, currency)} | ${tier.priceMetric === "per-seat" ? "Per seat" : "Flat per account"} | ${tableCell(names.join(", ") || "No included features")} |`,
      );
    }
  }
  lines.push("");
  if (activeDesign.addOns.length > 0) {
    lines.push(
      "### Add-ons",
      "",
      "| Add-on | Monthly list price | Metric | Included features |",
      "| --- | ---: | --- | --- |",
    );
    for (const addOn of activeDesign.addOns) {
      const names = addOn.featureIds.map(
        (id) => scenario.model.features.find((feature) => feature.id === id)?.name ?? id,
      );
      lines.push(
        `| ${tableCell(addOn.name)} | ${formatRecordMoney(addOn.price, currency)} | ${addOn.priceMetric === "per-seat" ? "Per seat" : "Flat per account"} | ${tableCell(names.join(", "))} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Simulated economics", "");
  if (!economics) {
    lines.push(
      "Economics are unavailable until the scenario contains at least one buyer segment.",
      "",
    );
  } else {
    lines.push(
      "| KPI | Modeled result |",
      "| --- | ---: |",
      `| MRR | ${formatRecordMoney(economics.mrr, currency)} |`,
      `| Paid conversion | ${formatRecordPercent(economics.paidConversion)} |`,
      `| ARPA | ${formatRecordMoney(economics.arpa, currency)} |`,
      `| Capture rate | ${formatRecordPercent(economics.captureRate)} |`,
      ...(economics.competitorLossShare === undefined
        ? []
        : [`| Competitor-loss share | ${formatRecordPercent(economics.competitorLossShare)} |`]),
      "",
      "| Value waterfall | Amount |",
      "| --- | ---: |",
      `| Potential value | ${formatRecordMoney(economics.potential, currency)} |`,
      `| Revenue | ${formatRecordMoney(economics.revenue, currency)} |`,
      `| Own-buyer surplus | ${formatRecordMoney(economics.ownBuyerSurplus, currency)} |`,
      `| Fencing gap | ${formatRecordMoney(economics.fencingGap, currency)} |`,
      `| Unserved value | ${formatRecordMoney(economics.unserved, currency)} |`,
      ...(economics.competitorLoss > 0
        ? [`| Competitor loss | ${formatRecordMoney(economics.competitorLoss, currency)} |`]
        : []),
      `| Conservation residual | ${formatRecordMoney(economics.conservationResidual, currency)} |`,
      "",
    );
  }

  lines.push("## Sensitivity and validation priorities", "");
  if (!uncertainty) {
    lines.push("No uncertainty calculation is available.", "");
  } else {
    lines.push(
      `MRR percentiles from ${formatNumber(uncertainty.drawCount, 0)} deterministic draws: **P10 ${formatRecordMoney(uncertainty.p10, currency)} · P50 ${formatRecordMoney(uncertainty.p50, currency)} · P90 ${formatRecordMoney(uncertainty.p90, currency)}**. These are simulated percentiles, not confidence intervals.`,
      "",
      "| Priority | Assumption | Largest MRR swing | Provenance | Validation action |",
      "| ---: | --- | ---: | --- | --- |",
    );
    for (const [index, driver] of uncertainty.drivers.entries()) {
      lines.push(
        `| ${index + 1} | ${tableCell(driver.label)} | ${formatRecordMoney(driver.maximumAbsoluteDelta, currency)} | ${tableCell(provenanceLabel(driver.provenance))} | ${tableCell(driver.validationAction)} |`,
      );
    }
    lines.push("");
  }

  if (research) {
    lines.push(
      "## Van Westendorp research",
      "",
      research.source === "illustrative"
        ? "**SIMULATED — not evidence.** These responses are a teaching dataset derived from model WTP assumptions."
        : "Fielded survey responses are reported as research evidence; ordering violations are excluded rather than repaired.",
      "",
      `Responses: ${research.responseCount} total · ${research.validCount} valid · ${research.excludedCount} excluded.`,
      "",
      "| PSM marker | Price |",
      "| --- | ---: |",
      `| PMC | ${pointPrice(research.points.pmc, currency)} |`,
      `| PME | ${pointPrice(research.points.pme, currency)} |`,
      `| IPP | ${pointPrice(research.points.ipp, currency)} |`,
      `| OPP | ${pointPrice(research.points.opp, currency)} |`,
      `| Acceptable range | ${research.acceptableRange ? `${formatRecordMoney(research.acceptableRange.low, currency)}–${formatRecordMoney(research.acceptableRange.high, currency)}` : "Undefined for this data"} |`,
      "",
    );
  }

  lines.push("## Deterministic critic", "");
  if (record.findings.length === 0) {
    lines.push("No documented linter rule is currently firing.", "");
  } else {
    for (const finding of record.findings) {
      lines.push(
        `### ${finding.id} · ${finding.title}`,
        "",
        `${finding.severity.toUpperCase()}: ${finding.message}`,
        ...(finding.citation ? ["", `Evidence note: ${finding.citation}`] : []),
        "",
      );
    }
  }

  lines.push(
    "## Alternatives considered",
    "",
    "| Design | Status | MRR | Paid conversion | Capture rate |",
    "| --- | --- | ---: | ---: | ---: |",
  );
  for (const alternative of record.alternatives) {
    lines.push(
      `| ${tableCell(alternative.name)} | ${alternative.id === activeDesign.id ? "Active" : "Saved alternative"} | ${metric(alternative.economics?.mrr, (value) => formatRecordMoney(value, currency))} | ${metric(alternative.economics?.paidConversion, formatRecordPercent)} | ${metric(alternative.economics?.captureRate, formatRecordPercent)} |`,
    );
  }
  lines.push(
    "",
    "## Scope and limitations",
    "",
    "- Results are conditional on the assumptions and provenance above; sensitivity ranks consequences, not truth.",
    "- The model is a single-period screening model. It does not model retention, expansion, annual terms, or usage distributions.",
    "- Behavioral linter findings are directional and cited; no numeric behavioral uplift is applied.",
    "- Research sections appear only when durable study records are present, and illustrative PSM data is explicitly non-evidentiary.",
    "",
  );
  return lines.join("\n");
}

/** Builds one traceable, deterministic record from the current scenario state. */
export function buildPricingDecisionRecord(
  scenario: Scenario,
  generatedOn: string,
  drawCount = DECISION_RECORD_DRAW_COUNT,
): PricingDecisionRecord {
  if (!generatedOn.trim()) throw new RangeError("A decision record needs a generation date.");
  const design = activeDesign(scenario);
  const economics = simulateScenarioDesign(scenario, design);
  const monteCarlo = runScenarioMonteCarlo(scenario, drawCount);
  const distribution = monteCarlo?.distributions.find(
    (candidate) => candidate.designId === scenario.activeDesignId,
  );
  const parameterById = new Map(
    uncertaintyParametersForScenario(scenario).map((parameter) => [parameter.id, parameter]),
  );
  const study = scenario.research.vanWestendorp;
  const psm = study ? analyzeVanWestendorp(study.responses) : undefined;

  const withoutMarkdown: Omit<PricingDecisionRecord, "markdown"> = {
    generatedOn,
    scenario,
    activeDesign: design,
    economics,
    alternatives: scenario.designs.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      economics: simulateScenarioDesign(scenario, candidate),
    })),
    findings: lintScenarioDesign(scenario),
    uncertainty:
      monteCarlo && distribution
        ? {
            drawCount: monteCarlo.drawCount,
            p10: distribution.percentiles.p10,
            p50: distribution.percentiles.p50,
            p90: distribution.percentiles.p90,
            drivers: monteCarlo.tornado.map((driver) => {
              const parameter = parameterById.get(driver.parameterId);
              if (!parameter) {
                throw new RangeError(`Unknown uncertainty parameter “${driver.parameterId}”.`);
              }
              return {
                label: driver.label,
                lowDelta: driver.lowDelta,
                highDelta: driver.highDelta,
                maximumAbsoluteDelta: driver.maximumAbsoluteDelta,
                provenance: parameter.provenance,
                validationAction: validationAction(parameter.provenance),
              };
            }),
          }
        : undefined,
    research:
      study && psm
        ? {
            source: study.source,
            responseCount: study.responses.length,
            validCount: psm.validResponses.length,
            excludedCount: psm.violations.length,
            acceptableRange: psm.acceptableRange,
            points: psm.points,
          }
        : undefined,
  };
  return { ...withoutMarkdown, markdown: recordMarkdown(withoutMarkdown) };
}
