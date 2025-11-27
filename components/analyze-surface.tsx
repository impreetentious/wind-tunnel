"use client";

import { useState } from "react";

import { handleHorizontalTabKey } from "./tab-keyboard";
import { PositioningSurface } from "./positioning-surface";
import { ResearchSurface } from "./research-surface";
import { UncertaintySurface } from "./uncertainty-surface";

type AnalyzeView = "uncertainty" | "research" | "positioning";
const analyzeViews = ["uncertainty", "research", "positioning"] as const;

export function AnalyzeSurface() {
  const [view, setView] = useState<AnalyzeView>("uncertainty");

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col">
      <nav aria-label="Analyze workbenches" className="border-b border-line px-6 pt-5 sm:px-10">
        <div className="flex gap-2" role="tablist">
          {(
            [
              ["uncertainty", "Uncertainty"],
              ["research", "Research"],
              ["positioning", "Positioning"],
            ] as const
          ).map(([id, label]) => {
            const selected = view === id;
            return (
              <button
                aria-controls="analyze-view"
                aria-selected={selected}
                className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
                  selected ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink"
                }`}
                id={`analyze-${id}-tab`}
                key={id}
                onClick={() => setView(id)}
                onKeyDown={(event) =>
                  handleHorizontalTabKey(
                    event,
                    analyzeViews,
                    view,
                    setView,
                    (candidate) => `analyze-${candidate}-tab`,
                  )
                }
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {label}
              </button>
            );
          })}
        </div>
      </nav>
      <div
        aria-labelledby={`analyze-${view}-tab`}
        className="flex min-h-0 flex-1"
        id="analyze-view"
        role="tabpanel"
      >
        {view === "uncertainty" ? (
          <UncertaintySurface />
        ) : view === "research" ? (
          <ResearchSurface />
        ) : (
          <PositioningSurface />
        )}
      </div>
    </section>
  );
}
