// CI gate: history and keys are local-only by construction. Any write to
// storage.sync (browser-vendor account sync) fails the build.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = ["src", "entrypoints", "scripts"];
const SELF = "scripts/check-no-sync.mjs";
const PATTERNS = [/storage\.sync\b/, /browser\.storage\.sync\b/, /["']sync:/];

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name) && path !== SELF) files.push(path);
  }
  return files;
}

let failures = 0;
for (const root of ROOTS) {
  for (const file of await sourceFiles(root)) {
    const raw = await readFile(file, "utf8");
    // Strip block comments and full-line comments so documentation phrases
    // like "never the sync area" cannot trip the gate. Real references in
    // code are still detected.
    const source = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    for (const pattern of PATTERNS) {
      if (pattern.test(source)) {
        console.error(`FAIL: forbidden sync-storage reference ${pattern} in ${file}`);
        failures += 1;
      }
    }
  }
}

if (failures > 0) {
  console.error(`check-no-sync: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-no-sync: no sync-storage references");
