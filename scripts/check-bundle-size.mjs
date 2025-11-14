import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const outputRoot = path.join("out", "_next");
const budgetBytes = 300 * 1024;

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
  `Client JavaScript: ${(compressedBytes / 1024).toFixed(1)} KiB gzip across ${files.length} files (budget: 300 KiB).`,
);

if (compressedBytes > budgetBytes) {
  console.error("Bundle-size gate failed.");
  process.exit(1);
}
