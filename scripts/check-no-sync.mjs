// Forbids storage.sync for keys/history (privacy invariant). CI-blocking.
// Usage: node scripts/check-no-sync.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "entrypoints", "scripts"];
const PAT = /(?:chrome|browser)?\.?storage\.sync/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

let hits = [];
for (const root of ROOTS) {
  for (const f of walk(root)) {
    const text = readFileSync(f, "utf8");
    // allow the string "sync:" only in comments about never-sync? No — flag all, triage manually.
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (PAT.test(line)) {
        // Ignore this gate file's own pattern + docs mentioning the ban
        if (f.includes("check-no-sync.mjs")) return;
        hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
}
if (hits.length) {
  console.error(`storage.sync usage forbidden:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log("ok: no storage.sync");
