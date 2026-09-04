import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit scope: engine and state only. Browser behaviour belongs to the Playwright suite.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**", "out/**"],
    setupFiles: ["./tests/setup.ts"],
    // §7 — the engine is the part with no UI to catch a mistake, so its branch
    // coverage is a gate rather than a report. If this fails, the fix is more
    // tests; the threshold does not move.
    coverage: {
      provider: "v8",
      include: ["lib/engine/**"],
      // Perf harnesses and fixtures are inputs to tests, not engine branches.
      exclude: ["lib/engine/**/*.test.ts", "lib/engine/*.perf.ts", "lib/engine/*-fixtures.ts"],
      reporter: ["text", "html"],
      thresholds: { branches: 90 },
    },
  },
});
