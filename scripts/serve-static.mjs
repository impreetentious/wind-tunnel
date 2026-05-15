import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const host = "127.0.0.1";
const port = 4173;
const outputRoot = path.resolve("out");

/**
 * Serve the same response headers the production host applies, read from
 * `vercel.json` so there is one source of truth. The browser suite runs against
 * this server, so a change that only works without the Content-Security-Policy
 * fails here rather than in production.
 */
const vercelConfig = JSON.parse(await readFile(path.resolve("vercel.json"), "utf8"));
const productionHeaders = Object.fromEntries(
  vercelConfig.headers
    .filter((rule) => rule.source === "/(.*)")
    .flatMap((rule) => rule.headers)
    .map((header) => [header.key, header.value]),
);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  let requestPath;
  try {
    requestPath = decodeURIComponent(new URL(request.url ?? "/", `http://${host}`).pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
    return;
  }
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(outputRoot, relativePath);

  if (!filePath.startsWith(`${outputRoot}${path.sep}`) && filePath !== outputRoot) {
    response.writeHead(403).end();
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      ...productionHeaders,
      "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Serving static export at http://${host}:${port}`);
});
