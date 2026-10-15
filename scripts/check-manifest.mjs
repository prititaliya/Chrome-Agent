// Asserts per-browser manifest invariants on built output.
// Usage: node scripts/check-manifest.mjs [.output/chrome-mv3/manifest.json] [...]
import { readFileSync, existsSync } from "node:fs";

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [".output/chrome-mv3/manifest.json", ".output/firefox-mv3/manifest.json"];

let failed = false;
for (const file of targets) {
  if (!existsSync(file)) {
    console.warn(`skip (missing): ${file} — run pnpm build first`);
    continue;
  }
  const m = JSON.parse(readFileSync(file, "utf8"));
  const isFirefox = file.includes("firefox");
  const errs = [];
  if (m.manifest_version !== 3) errs.push("manifest_version must be 3");
  if (!m.permissions?.includes("storage")) errs.push("missing storage permission");
  if (!m.permissions?.includes("downloads") && !isFirefox)
    errs.push("chrome must include downloads (history export)");
  if (isFirefox) {
    if (m.permissions?.includes("debugger")) errs.push("firefox must NOT declare debugger");
    if (m.permissions?.includes("sidePanel")) errs.push("firefox must NOT declare sidePanel");
    if (!m.sidebar_action) errs.push("firefox must declare sidebar_action");
    const gecko = m.browser_specific_settings?.gecko;
    if (!gecko?.id || !/^[a-zA-Z0-9-._]+@[a-zA-Z0-9-._]+$/.test(gecko.id)) {
      errs.push("firefox gecko.id must be a bare email-style id (no curly braces)");
    }
    // AMO requires data_collection_permissions for new submissions (Nov 2025+).
    if (!gecko?.data_collection_permissions?.required?.length) {
      errs.push("firefox must declare gecko.data_collection_permissions.required");
    }
  } else {
    if (!m.side_panel?.default_path) errs.push("chrome must declare side_panel.default_path");
    if (m.sidebar_action) errs.push("chrome must NOT declare sidebar_action");
  }
  // host_permissions must cover providers; warn if narrowed unexpectedly
  if (!m.host_permissions?.includes("<all_urls>") && !m.host_permissions?.length) {
    errs.push("host_permissions empty — provider calls will fail");
  }
  if (errs.length) {
    failed = true;
    console.error(`${file}:\n  - ${errs.join("\n  - ")}`);
  } else {
    console.log(`ok: ${file}`);
  }
}
process.exit(failed ? 1 : 0);
