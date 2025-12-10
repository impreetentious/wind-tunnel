#!/usr/bin/env node
/**
 * §15 M-16 Web Vitals gate.
 *
 * Static heuristic gate that runs off the `out/` bundle: it inspects the
 * HTML shell + first-load JS reported by the Next static export and asserts:
 *
 * 1. `<link rel="preload">` / `<script>` counts are inside their budget (LCP
 *    and TBT scale roughly with these on cold caches — a spike above budget
 *    is a smoke signal, not a proof).
 * 2. No `<link rel="stylesheet">` fetches an external origin (privacy scan
 *    already asserts this; we duplicate it here for a friendlier failure
 *    message from the Web Vitals gate itself).
 * 3. The static shell's total inline payload is below a ceiling so the
 *    document itself does not become the LCP element for slow devices.
 *
 * True runtime Web Vitals (LCP, INP, CLS) still need Playwright + Chromium in
 * CI — this static gate is the fast local heuristic that flags obvious
 * regressions. Ledger D-43 records the intent: this is a first pass, tightened
 * only when a real measurement disagrees with a green result here.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const outRoot = "out";
const SHELL_HTML_MAX_BYTES = 220 * 1024; // Inline HTML shell + inlined critical CSS.
const SCRIPT_TAG_MAX_COUNT = 40; // First-load script chunks (Next static export splits aggressively).
const PRELOAD_TAG_MAX_COUNT = 40;

async function findHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findHtml(filePath);
      return entry.name.endsWith(".html") ? [filePath] : [];
    }),
  );
  return nested.flat();
}

function count(html, pattern) {
  return (html.match(pattern) ?? []).length;
}

let failed = false;
try {
  await stat(outRoot);
} catch {
  console.error(`No ${outRoot}/ directory found — run \`npm run build\` first.`);
  process.exit(1);
}

const htmlFiles = await findHtml(outRoot);
if (htmlFiles.length === 0) {
  console.error("No .html files under out/ — the static export did not run.");
  process.exit(1);
}

for (const filePath of htmlFiles) {
  const html = await readFile(filePath, "utf8");
  const scriptCount = count(html, /<script\b/gi);
  const preloadCount = count(html, /<link[^>]+rel="preload"/gi);
  const externalStylesheet = /<link[^>]+rel="stylesheet"[^>]+href="https?:\/\//i.test(html);
  const byteLength = Buffer.byteLength(html, "utf8");

  const problems = [];
  if (byteLength > SHELL_HTML_MAX_BYTES) {
    problems.push(
      `HTML shell is ${(byteLength / 1024).toFixed(1)} KiB (> ${SHELL_HTML_MAX_BYTES / 1024} KiB budget).`,
    );
  }
  if (scriptCount > SCRIPT_TAG_MAX_COUNT) {
    problems.push(`Too many <script> tags: ${scriptCount} > ${SCRIPT_TAG_MAX_COUNT}.`);
  }
  if (preloadCount > PRELOAD_TAG_MAX_COUNT) {
    problems.push(`Too many <link rel="preload">: ${preloadCount} > ${PRELOAD_TAG_MAX_COUNT}.`);
  }
  if (externalStylesheet) {
    problems.push('An external <link rel="stylesheet"> was found — privacy contract broken.');
  }

  console.log(
    `${filePath}: ${(byteLength / 1024).toFixed(1)} KiB, ${scriptCount} scripts, ${preloadCount} preloads.`,
  );
  if (problems.length > 0) {
    console.error(`  Web Vitals gate failed for ${filePath}:`);
    for (const problem of problems) console.error(`    - ${problem}`);
    failed = true;
  }
}

if (failed) process.exit(1);
