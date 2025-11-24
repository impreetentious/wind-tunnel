import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const outputRoot = path.join("out", "_next");
// P7d-2 lands the Conjoint + MaxDiff research surfaces; v1.1 extension code pushes
// the total gzip footprint past the D-01 v1.0 ceiling of 300 KiB. The 320 KiB ceiling
// is the extension budget; keep "as small as possible" as the practical target and
// audit every future addition.
const budgetBytes = 320 * 1024;

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
