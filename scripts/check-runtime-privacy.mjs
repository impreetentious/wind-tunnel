import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceRoots = ["app", "components", "content", "lib"];
const forbiddenPatterns = [
  { pattern: /\bfetch\s*\(/, name: "fetch" },
  { pattern: /\bXMLHttpRequest\b/, name: "XMLHttpRequest" },
  { pattern: /\bnavigator\.sendBeacon\b/, name: "navigator.sendBeacon" },
  { pattern: /\bWebSocket\b/, name: "WebSocket" },
  { pattern: /\bEventSource\b/, name: "EventSource" },
  { pattern: /from\s+["']next\/image["']/, name: "next/image" },
  { pattern: /loader\s*:/, name: "remote image loader" },
];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

async function filesUnder(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(filePath) : [filePath];
      }),
    );
    return nested.flat();
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

const sourceFiles = (await Promise.all(sourceRoots.map(filesUnder)))
  .flat()
  .filter((filePath) => sourceExtensions.has(path.extname(filePath)));
const violations = [];

for (const filePath of sourceFiles) {
  const content = await readFile(filePath, "utf8");
  for (const { pattern, name } of forbiddenPatterns) {
    if (pattern.test(content)) violations.push(`${filePath}: ${name}`);
  }
}

if (violations.length > 0) {
  console.error("Runtime privacy check failed:\n" + violations.join("\n"));
  process.exit(1);
}

console.log(`Runtime privacy check passed (${sourceFiles.length} source files scanned).`);
