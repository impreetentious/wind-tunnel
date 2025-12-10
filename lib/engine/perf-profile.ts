/**
 * @spec §15 M-16 perf profiling helpers.
 *
 * A tiny worst-case profiler that measures how long the core engine takes on
 * a synthetic worst-case scenario. Used by the perf test to keep the §3.5
 * "edit → re-simulate → repaint < 16 ms typical" claim honest — if a future
 * engine change blows this budget, the CI test fails immediately.
 *
 * The profiler intentionally uses `performance.now()` only. It never touches
 * the DOM, so it runs in Node/JSDom without special setup.
 */

export interface ProfileSample {
  label: string;
  samples: readonly number[];
  medianMs: number;
  p95Ms: number;
  worstMs: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p * sorted.length) / 100)));
  return sorted[index];
}

export function measure(label: string, runs: number, run: () => void): ProfileSample {
  const samples: number[] = [];
  // Warmup pass — the first invocation typically pays for the JIT.
  run();
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    label,
    samples,
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    worstMs: sorted[sorted.length - 1],
  };
}
