// Dev-only reload loop for the unpacked-build workflow:
//   terminal 1: pnpm build (rebuild after edits)
//   terminal 2: node scripts/dev-reload.mjs (this server)
//   browser: load .output/chrome-mv3 unpacked
// On any change under .output/, connected extensions reload themselves.
// (`pnpm dev` already hot-reloads; this covers production-build testing.)
// Nothing listens in normal installs, so the background client is a silent no-op.
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 35929);
const clients = new Set();

const server = createServer((req, res) => {
  if (req.url !== "/events") {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

function broadcast() {
  for (const res of clients) res.write("event: reload\ndata: 1\n\n");
}

const { watch } = await import("node:fs");
try {
  const watcher = watch(new URL("../.output/", import.meta.url), { recursive: true });
  watcher.on("change", broadcast);
  watcher.on("error", () => {});
} catch {
  // .output does not exist yet (pre-build): server still starts.
}

server.listen(PORT, () => {
  console.log(`dev-reload on http://127.0.0.1:${PORT}/events`);
});
