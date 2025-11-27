"use client";

import { useState } from "react";

import { BundlingSurface } from "./bundling-surface";
import { ConjointSurface } from "./conjoint-surface";
import { MaxDiffSurface } from "./maxdiff-surface";
import { handleHorizontalTabKey } from "./tab-keyboard";
import { VanWestendorpSurface } from "./van-westendorp-surface";

type ResearchView = "psm" | "bundling" | "conjoint" | "maxdiff";
const researchViews = ["psm", "bundling", "conjoint", "maxdiff"] as const;

export function ResearchSurface() {
  const [view, setView] = useState<ResearchView>("psm");
  return (
    <section className="flex min-h-0 w-full flex-1 flex-col">
      <nav aria-label="Research methods" className="border-b border-line px-6 pt-4 sm:px-10">
        <div className="flex gap-2 overflow-x-auto" role="tablist">
          {(
            [
              ["psm", "Van Westendorp"],
              ["bundling", "Bundling"],
              ["conjoint", "Conjoint"],
              ["maxdiff", "MaxDiff"],
            ] as const
          ).map(([id, label]) => {
            const selected = view === id;
            return (
              <button
                aria-controls="research-view"
                aria-selected={selected}
                className={`min-w-max rounded-t-lg px-4 py-2 text-sm font-semibold ${
                  selected ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink"
                }`}
                id={`research-${id}-tab`}
                key={id}
                onClick={() => setView(id)}
                onKeyDown={(event) =>
                  handleHorizontalTabKey(
                    event,
                    researchViews,
                    view,
                    setView,
                    (candidate) => `research-${candidate}-tab`,
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
        aria-labelledby={`research-${view}-tab`}
        className="flex min-h-0 flex-1"
        id="research-view"
        role="tabpanel"
      >
        {view === "psm" ? (
          <VanWestendorpSurface />
        ) : view === "bundling" ? (
          <BundlingSurface />
        ) : view === "conjoint" ? (
          <ConjointSurface />
        ) : (
          <MaxDiffSurface />
        )}
      </div>
    </section>
  );
}
