import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

const forbiddenEngineImports = [
  /^@\/components(?:\/|$)/,
  /^@\/lib\/state(?:\/|$)/,
  /^(?:\.\.\/)+components(?:\/|$)/,
  /^(?:\.\.\/)+state(?:\/|$)/,
];

const enginePurityRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Keep pricing-engine modules independent from UI and state modules.",
    },
    schema: [],
    messages: {
      forbidden: "Engine modules may not import from components/ or lib/state/.",
    },
  },
  create(context) {
    const checkSource = (source) => {
      if (
        typeof source.value === "string" &&
        forbiddenEngineImports.some((pattern) => pattern.test(source.value))
      ) {
        context.report({ node: source, messageId: "forbidden" });
      }
    };

    return {
      ExportAllDeclaration: (node) => checkSource(node.source),
      ExportNamedDeclaration: (node) => {
        if (node.source) checkSource(node.source);
      },
      ImportDeclaration: (node) => checkSource(node.source),
    };
  },
};

export default defineConfig(
  nextVitals,
  nextTypescript,
  globalIgnores([".next/**", "coverage/**", "out/**", "playwright-report/**", "test-results/**"]),
  {
    files: ["lib/engine/**/*.{ts,tsx}"],
    plugins: {
      "wind-tunnel": {
        rules: {
          "engine-purity": enginePurityRule,
        },
      },
    },
    rules: {
      "wind-tunnel/engine-purity": "error",
    },
  },
);
