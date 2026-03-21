import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const outputRoot = path.join("out", "_next");
// Keep the complete first-load client bundle inside the release ceiling. New
// product work must fit this budget or reduce existing shipped JavaScript.
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
