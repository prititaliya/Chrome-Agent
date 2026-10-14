import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Single-writer invariant: all HistoryStore mutations are background RPCs.
// No UI module may import the history store (reads go through the port).
async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("history single-writer", () => {
  it("no src/ui module imports storage/history", async () => {
    const files = await sourceFiles(join(process.cwd(), "src/ui"));
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/from\s+["'][^"']*storage\/history/.test(source) || /import\([^)]*storage\/history/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
