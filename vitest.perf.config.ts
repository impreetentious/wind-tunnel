import { defineConfig } from "vitest/config";
import path from "node:path";

// Performance budgets run in their own project so a slow machine cannot fail the unit suite.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["lib/engine/conjoint.perf.ts"],
  },
});
