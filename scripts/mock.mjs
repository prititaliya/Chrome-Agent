// Streams a scripted transcript as SSE to stdout (proves the fixture format;
// the agent loop consumes the same format in later tasks).
// Usage: pnpm mock -- --script=fixtures/agent-scripts/read-page.json
import { readFile } from "node:fs/promises";
import { turnToSSE } from "../src/providers/entries/mock.ts";

const scriptArg = process.argv.find((a) => a.startsWith("--script="));
if (!scriptArg) {
  console.error("usage: pnpm mock -- --script=fixtures/agent-scripts/<name>.json");
  process.exit(1);
}
const script = JSON.parse(await readFile(scriptArg.slice("--script=".length), "utf8"));
for (const turn of script.turns) process.stdout.write(turnToSSE(turn));
