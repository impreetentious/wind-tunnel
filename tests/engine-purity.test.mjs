import { describe, expect, it } from "vitest";
import { Linter } from "eslint";
import { enginePurityRule } from "../eslint.config.mjs";

function lint(source) {
  return new Linter().verify(
    source,
    [
      {
        files: ["**/*.ts"],
        plugins: { "wind-tunnel": { rules: { "engine-purity": enginePurityRule } } },
        rules: { "wind-tunnel/engine-purity": "error" },
      },
    ],
    { filename: "lib/engine/probe.ts" },
  );
}

describe("engine purity lint rule", () => {
  it("rejects every forbidden specifier form while allowing engine-local imports", () => {
    for (const source of [
      'import value from "@/lib/state/x";',
      'import value from "../../lib/state/x";',
      'import value from "../state/x";',
      'await import("@/components/x");',
      'export * from "../../components/x";',
    ])
      expect(lint(source)).toHaveLength(1);

    expect(lint('import { measure } from "./stats";')).toHaveLength(0);
  });
});
