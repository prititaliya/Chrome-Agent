// Sign Firefox via AMO. Needs AMO_JWT_ISSUER + AMO_JWT_SECRET env.
// Usage: node scripts/sign-firefox.mjs [--channel listed|unlisted]
import { execSync } from "node:child_process";

const channel = process.argv.includes("--channel")
  ? process.argv[process.argv.indexOf("--channel") + 1]
  : process.argv.includes("listed")
    ? "listed"
    : "unlisted";

if (!process.env.AMO_JWT_ISSUER || !process.env.AMO_JWT_SECRET) {
  const cmd = channel === "listed" ? "pnpm sign:firefox:listed" : "pnpm sign:firefox";
  console.error(
    `Missing AMO_JWT_ISSUER / AMO_JWT_SECRET. Get them from addons.mozilla.org → Tools → API keys, then:\n` +
      `  AMO_JWT_ISSUER=... AMO_JWT_SECRET=... ${cmd}\n` +
      (channel === "listed"
        ? "Listed = AMO review for public distribution."
        : "Unlisted = signed self-distributed .xpi (no review)."),
  );
  process.exit(2);
}

execSync(
  `npx web-ext sign --source-dir .output/firefox-mv3 --artifacts-dir store/dist --channel ${channel}`,
  { stdio: "inherit" },
);
