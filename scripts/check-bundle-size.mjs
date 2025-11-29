import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const outputRoot = path.join("out", "_next");
// D-01 sized the v1.0 core to 300 KiB gzip. D-34 raised it to 320 KiB to carry the
// v1.1 research extensions (P7c bundling, P7d-2 conjoint/MaxDiff). D-39 (S36) raises
// it to 360 KiB to carry the parked-scope mission (§15): new pure engine modules
// (optimizer, elasticity, MaxDiff MNL, D-efficient generator) and their eventual
// UI hookups. The "as small as possible under Next's static-export path" spirit
// stays; every future addition is still audited against this ceiling.
const budgetBytes = 360 * 1024;

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(filePath) : [filePath];
    }),
  );
  return nested.flat();
}

const files = (await filesUnder(outputRoot)).filter((filePath) => filePath.endsWith(".js"));
const compressedBytes = (
  await Promise.all(files.map(async (filePath) => gzipSync(await readFile(filePath)).byteLength))
).reduce((total, bytes) => total + bytes, 0);

console.log(
  `Client JavaScript: ${(compressedBytes / 1024).toFixed(1)} KiB gzip across ${files.length} files (budget: ${budgetBytes / 1024} KiB).`,
);

if (compressedBytes > budgetBytes) {
  console.error("Bundle-size gate failed.");
  process.exit(1);
}
