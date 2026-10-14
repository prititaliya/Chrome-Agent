// Zero-dependency static server for fixture pages, a POST /echo endpoint,
// and a scripted OpenAI-compatible mock model under /v1 (see mock-provider.mjs).
// Usage: node scripts/serve-fixtures.mjs [port]  (default 4173)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handleMockProvider } from "./mock-provider.mjs";

const ROOT = new URL("../fixtures/pages/", import.meta.url);
const PORT = Number(process.argv[2] ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (handleMockProvider(req, res, url)) return;

  if (req.method === "POST" && url.pathname === "/echo") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ received: body }));
    });
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }

  const file = normalize(join(url.pathname === "/" ? "search.html" : url.pathname.slice(1)));
  if (file.includes("..") || extname(file) !== ".html") {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  try {
    const body = await readFile(new URL(file, ROOT));
    res.writeHead(200, { "content-type": TYPES[".html"] });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`fixtures on http://localhost:${PORT}`);
});
