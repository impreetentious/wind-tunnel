import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const spec = await readFile(join(root, "docs", "MODEL-SPEC.md"), "utf8");
const sections = [...spec.matchAll(/^### §(4\.\d+) /gm)].map((match) => match[1]);
// §4.10 shipped with P7d-1/P7d-2; §4.11 is required from P7e (positioning surface).
// §4.13 (elasticity) and §4.14 (joint optimizer) are required from §15 Batch 1 (S36).
// §4.15 (usage) is required from §15 Batch 3.
const requiredSections = new Set([
  "4.1",
  "4.2",
  "4.3",
  "4.4",
  "4.5",
  "4.6",
  "4.7",
  "4.8",
  "4.9",
  "4.10",
  "4.11",
  "4.12",
  "4.13",
  "4.14",
  "4.15",
]);
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "node_modules",
  "out",
  "playwright-report",
  "test-results",
]);

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : findTests(path);
      return entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx") ? [path] : [];
    }),
  );
  return nested.flat();
}

const tests = await findTests(root);
const citations = new Map(sections.map((section) => [section, 0]));
for (const test of tests) {
  const source = await readFile(test, "utf8");
  for (const match of source.matchAll(/@spec §(4\.\d+)/g)) {
    citations.set(match[1], (citations.get(match[1]) ?? 0) + 1);
  }
}

console.log("MODEL-SPEC coverage");
for (const section of sections) {
  const count = citations.get(section) ?? 0;
  const requirement = requiredSections.has(section)
    ? "required for shipped modules"
    : "future phase";
  console.log(`§${section}: ${count} test citation(s) — ${requirement}`);
}

const missingRequired = [...requiredSections].filter(
  (section) => (citations.get(section) ?? 0) === 0,
);
if (missingRequired.length > 0) {
  console.error(
    `Missing required spec coverage: ${missingRequired.map((section) => `§${section}`).join(", ")}`,
  );
  process.exitCode = 1;
}
