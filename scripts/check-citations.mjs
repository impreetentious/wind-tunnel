import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPEC = "docs/MODEL-SPEC.md";
const SELF = path.relative(process.cwd(), fileURLToPath(import.meta.url));
const ROOTS = ["app", "components", "content", "lib", "scripts", "e2e", "tests", "docs", ".github"];
const EXTRA_FILES = ["README.md", "package.json", ".gitignore", ".prettierignore"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js", ".css", ".md", ".json", ".yml", ".yaml"]);

async function filesUnder(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const filePath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(filePath) : Promise.resolve([filePath]);
    }),
  );
  return nested.flat();
}

const specHeadings = new Set();
for (const line of (await readFile(SPEC, "utf8")).split("\n")) {
  const heading = /^#{1,6}\s+§(\d+(?:\.\d+)*)\b/.exec(line);
  if (heading) specHeadings.add(heading[1]);
}
if (specHeadings.size === 0) {
  console.error(`citation check failed: no numbered headings found in ${SPEC}.`);
  process.exit(1);
}

const files = [...(await Promise.all(ROOTS.map(filesUnder))).flat(), ...EXTRA_FILES].filter(
  (file) => EXTENSIONS.has(path.extname(file)) && path.normalize(file) !== SELF,
);

const unresolved = [];
let citationCount = 0;

for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/§(\d+(?:\.\d+)*)/g)) {
    citationCount += 1;
    if (!specHeadings.has(match[1])) {
      const line = content.slice(0, match.index).split("\n").length;
      unresolved.push(`${file}:${line}: §${match[1]}`);
    }
  }
}

if (unresolved.length > 0) {
  console.error("citation check failed.");
  console.error(`\nCitations that do not resolve in ${SPEC}:`);
  for (const hit of unresolved) console.error(` - ${hit}`);
  process.exit(1);
}

console.log(
  `citations OK — ${citationCount} source citation(s) resolve in ${SPEC} (${specHeadings.size} numbered headings).`,
);
