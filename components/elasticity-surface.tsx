"use client";

import { useMemo, useState } from "react";

import type { OfferElasticity, SegmentElasticityReadout } from "@/lib/engine/elasticity";
import { elasticityForScenario } from "@/lib/state/elasticity";
import { useScenarioStore } from "@/lib/state/scenario-store";

type SubstitutionView = "heatmap" | "table";

function formatElasticity(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Turns the sign of revenue elasticity into a plain-language reading. Revenue
 * elasticity is `1 + own-price demand elasticity` (§4.13): positive means a
 * small price rise still raises revenue at this point on the envelope.
 */
function revenueVerdict(revenueElasticity: number | undefined) {
  if (revenueElasticity === undefined) return { label: "—", tone: "muted" as const };
  if (revenueElasticity > 0.05) return { label: "Revenue rises if priced up", tone: "up" as const };
  if (revenueElasticity < -0.05)
    return { label: "Revenue falls if priced up", tone: "down" as const };
  return { label: "Near a local revenue peak", tone: "peak" as const };
}

const toneClass: Record<"up" | "down" | "peak" | "muted", string> = {
  up: "text-accent-strong",
  down: "text-[#c2410c]",
  peak: "text-ink",
  muted: "text-muted",
};

function OwnElasticityTable({
  elasticities,
  currency,
  offerName,
}: {
  elasticities: readonly OfferElasticity[];
  currency: string;
  offerName: (offerId: string) => string;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table
        aria-label="Own-price elasticity by active offer"
        className="w-full min-w-[40rem] border-collapse text-left text-sm"
      >
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Active offer</th>
            <th className="px-3 py-2 text-right font-semibold">Effective price</th>
            <th className="px-3 py-2 text-right font-semibold">Share</th>
            <th className="px-3 py-2 text-right font-semibold">Own-price elasticity</th>
            <th className="px-3 py-2 text-right font-semibold">Revenue elasticity</th>
            <th className="px-3 py-2 font-semibold">Local reading</th>
          </tr>
        </thead>
        <tbody>
          {elasticities.map((offer) => {
            const verdict = revenueVerdict(offer.ownPriceRevenueElasticity);
            return (
              <tr className="border-b border-line/70" key={offer.offerId}>
                <td className="px-3 py-3 font-medium text-ink">{offerName(offer.offerId)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatCurrency(offer.effectivePrice, currency)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatPercent(offer.share)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatElasticity(offer.ownPriceDemandElasticity)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {formatElasticity(offer.ownPriceRevenueElasticity)}
                </td>
                <td className={`px-3 py-3 font-medium ${toneClass[verdict.tone]}`}>
                  {verdict.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SubstitutionCell {
  fromId: string;
  toId: string;
  derivative: number;
}

function substitutionCells(readout: SegmentElasticityReadout): SubstitutionCell[] {
  return readout.substitution.map((entry) => ({
    fromId: entry.fromOfferId,
    toId: entry.toOfferId,
    derivative: entry.shareDerivative,
  }));
}

function SubstitutionHeatmap({
  readout,
  offerName,
}: {
  readout: SegmentElasticityReadout;
  offerName: (offerId: string) => string;
}) {
  const active = readout.selection.active;
  const order = active.map((interval) => interval.offer.id);
  const label = new Map(order.map((id, index) => [id, index]));
  const cellByKey = new Map(
    substitutionCells(readout).map((cell) => [`${cell.fromId}|${cell.toId}`, cell.derivative]),
  );
  const ownByOffer = new Map(
    readout.activeOfferElasticities.map((offer) => [offer.offerId, offer.ownShareDerivative]),
  );
  const magnitudes = [
    ...[...cellByKey.values()].map(Math.abs),
    ...[...ownByOffer.values()].map(Math.abs),
  ];
  const maxMagnitude = Math.max(...magnitudes, 1e-12);

  function intensity(value: number) {
    return Math.min(1, Math.abs(value) / maxMagnitude);
  }

  const size = 46;
  const headerRow = 26;
  const headerCol = 150;
  const width = headerCol + order.length * size;
  const height = headerRow + order.length * size;

  return (
    <figure className="mt-4 overflow-x-auto" data-testid="substitution-heatmap">
      <svg
        aria-label="Cross-tier substitution heatmap: how each offer's share responds to a small price rise in the row offer"
        className="min-w-[34rem]"
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        {order.map((toId, columnIndex) => (
          <text
            fill="var(--muted)"
            fontSize="10"
            key={`col-${toId}`}
            textAnchor="middle"
            x={headerCol + columnIndex * size + size / 2}
            y={headerRow - 10}
          >
            {label.get(toId)! + 1}
          </text>
        ))}
        {order.map((fromId, rowIndex) => (
          <g key={`row-${fromId}`}>
            <text
              fill="var(--ink)"
              fontSize="11"
              x={headerCol - 8}
              textAnchor="end"
              y={headerRow + rowIndex * size + size / 2 + 4}
            >
              {label.get(fromId)! + 1}. {offerName(fromId)}
            </text>
            {order.map((toId, columnIndex) => {
              const isDiagonal = fromId === toId;
              const value = isDiagonal
                ? (ownByOffer.get(fromId) ?? 0)
                : (cellByKey.get(`${fromId}|${toId}`) ?? 0);
              // Diagonal is the own-price loss (≤ 0, blue); off-diagonal gains
              // are where the row's buyers flow when its price rises (≥ 0, orange).
              const color = value < 0 ? "#0072b2" : "#d55e00";
              const opacity = value === 0 ? 0 : 0.18 + intensity(value) * 0.72;
              return (
                <g key={`${fromId}-${toId}`}>
                  <rect
                    fill={color}
                    fillOpacity={opacity}
                    height={size - 4}
                    stroke="var(--line)"
                    strokeWidth="1"
                    width={size - 4}
                    x={headerCol + columnIndex * size + 2}
                    y={headerRow + rowIndex * size + 2}
                  />
                  {value !== 0 ? (
                    <text
                      fill="var(--ink)"
                      fontSize="9"
                      textAnchor="middle"
                      x={headerCol + columnIndex * size + size / 2}
                      y={headerRow + rowIndex * size + size / 2 + 3}
                    >
                      {value > 0 ? "+" : "−"}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[#0072b2]" />
          own-share loss
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[#d55e00]" />
          share gained by a neighbor
        </span>
        <span>
          Row = the offer whose price rises; column = who responds. Numbering matches rows.
        </span>
      </figcaption>
    </figure>
  );
}

function SubstitutionTable({
  readout,
  offerName,
}: {
  readout: SegmentElasticityReadout;
  offerName: (offerId: string) => string;
}) {
  if (readout.substitution.length === 0) {
    return (
      <p className="mt-4 text-sm leading-6 text-muted">
        The active envelope has no adjacent paid offer for buyers to switch into, so no cross-tier
        substitution is defined here.
      </p>
    );
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table
        aria-label="Cross-tier substitution entries"
        className="w-full min-w-[38rem] border-collapse text-left text-sm"
      >
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Price rises on</th>
            <th className="px-3 py-2 font-semibold">Share flows to</th>
            <th className="px-3 py-2 text-right font-semibold">∂share / ∂price</th>
            <th className="px-3 py-2 text-right font-semibold">Cross-price elasticity</th>
          </tr>
        </thead>
        <tbody>
          {readout.substitution.map((entry) => (
            <tr className="border-b border-line/70" key={`${entry.fromOfferId}-${entry.toOfferId}`}>
              <td className="px-3 py-3 font-medium text-ink">{offerName(entry.fromOfferId)}</td>
              <td className="px-3 py-3 text-ink">{offerName(entry.toOfferId)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {entry.shareDerivative.toExponential(2)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-ink">
                {formatElasticity(entry.crossPriceDemandElasticity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SegmentElasticityCard({
  segmentName,
  readout,
  currency,
}: {
  segmentName: string;
  readout: SegmentElasticityReadout;
  currency: string;
}) {
  const [view, setView] = useState<SubstitutionView>("heatmap");
  const offerName = useMemo(() => {
    const names = new Map(readout.selection.offers.map((offer) => [offer.id, offer.name]));
    return (offerId: string) => names.get(offerId) ?? offerId;
  }, [readout]);

  return (
    <section
      aria-label={`${segmentName} elasticity`}
      className="rounded-2xl border border-line bg-canvas p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">Segment</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">{segmentName}</h2>
        </div>
        <span className="rounded-full bg-canvas-raised px-3 py-1 text-xs font-medium text-muted">
          σ {readout.sigma.toFixed(2)}
        </span>
      </div>

      {readout.degenerate ? (
        <p className="mt-4 text-sm leading-6 text-muted">
          This segment has no within-segment spread (σ = 0), so demand is a point mass and local
          derivatives are undefined. Use the price sweep in Simulate for the finite-step view this
          segment supports.
        </p>
      ) : readout.activeOfferElasticities.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-muted">
          No paid own offer is active on this segment&apos;s envelope, so there is nothing to
          differentiate. Check tier prices and fences in Design.
        </p>
      ) : (
        <>
          <OwnElasticityTable
            currency={currency}
            elasticities={readout.activeOfferElasticities}
            offerName={offerName}
          />
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">Cross-tier substitution</h3>
            <button
              aria-pressed={view === "table"}
              className="min-h-9 rounded-lg border border-line bg-canvas-raised px-3 text-xs font-semibold text-ink hover:border-accent"
              onClick={() => setView(view === "table" ? "heatmap" : "table")}
              type="button"
            >
              {view === "table" ? "Show heatmap" : "View as table"}
            </button>
          </div>
          {view === "heatmap" ? (
            <SubstitutionHeatmap offerName={offerName} readout={readout} />
          ) : (
            <SubstitutionTable offerName={offerName} readout={readout} />
          )}
        </>
      )}
    </section>
  );
}

function EmptyElasticity() {
  return (
    <section className="grid min-h-[28rem] place-items-center px-6 py-14 text-center sm:px-12">
      <div className="max-w-xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Analyze elasticity
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
          Add segments and a priced menu to read elasticity.
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-base leading-7 text-muted">
          Elasticity is the analytic slope of each active offer&apos;s share against its own price,
          plus where buyers move when a neighbor gets more expensive.
        </p>
      </div>
    </section>
  );
}

export function ElasticitySurface() {
  const scenario = useScenarioStore((state) => state.scenario);
  const segments = useMemo(() => elasticityForScenario(scenario), [scenario]);

  if (!segments || segments.length === 0) return <EmptyElasticity />;

  return (
    <section aria-labelledby="elasticity-title" className="w-full px-5 py-7 sm:px-8 lg:px-10">
      <div>
        <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
          Analyze elasticity
        </p>
        <h1
          className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
          id="elasticity-title"
        >
          How sensitive is each tier&apos;s demand to its price?
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted">
          These are analytic derivatives of the §4.2 envelope shares, valid for price changes small
          enough to keep the current active menu. A step large enough to move an offer on or off the
          envelope changes the regime — read them alongside Simulate&apos;s price sweep for finite
          moves.
        </p>
      </div>

      <div className="mt-7 space-y-6">
        {segments.map((segment) => (
          <SegmentElasticityCard
            currency={scenario.settings.currency}
            key={segment.segmentId}
            readout={segment.readout}
            segmentName={segment.segmentName}
          />
        ))}
      </div>
    </section>
  );
}
