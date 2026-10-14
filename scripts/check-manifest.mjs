// CI gate: per-browser manifest invariants. Exit non-zero on any failure.
// (Task 8 centralizes the provider-origin list in the registry; until then
// the expected origins live here and must match ProviderDef.origins.)
import { readFile } from "node:fs/promises";

const CHROME_MANIFEST = ".output/chrome-mv3/manifest.json";
const FIREFOX_MANIFEST = ".output/firefox-mv3/manifest.json";
const EXPECTED_PROVIDER_ORIGINS = ["https://openrouter.ai/*"];

let failures = 0;

function check(cond, label) {
  if (cond) {
    console.log(`ok: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

async function load(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    console.error(`FAIL: missing manifest (run pnpm build first): ${path}`);
    failures += 1;
    return null;
  }
}

function checkCommon(manifest, label) {
  const permissions = manifest.permissions ?? [];
  for (const p of ["storage", "tabs", "scripting", "alarms", "activeTab", "downloads"]) {
    check(permissions.includes(p), `${label} has permission:${p}`);
  }
  check(!permissions.includes("unlimitedStorage"), `${label} omits unlimitedStorage (quota discipline)`);
  const hosts = manifest.host_permissions ?? [];
  check(
    !hosts.includes("<all_urls>"),
    `${label} host_permissions excludes <all_urls> (page access is optional)`,
  );
  for (const origin of EXPECTED_PROVIDER_ORIGINS) {
    check(hosts.includes(origin), `${label} host_permissions includes ${origin}`);
  }
}

const chrome = await load(CHROME_MANIFEST);
if (chrome) {
  check(chrome.manifest_version === 3, "chrome manifest_version is 3");
  checkCommon(chrome, "chrome");
  const permissions = chrome.permissions ?? [];
  check(permissions.includes("sidePanel"), "chrome has sidePanel permission");
  check(permissions.includes("debugger"), "chrome declares debugger (runtime-OFF by default)");
  check(chrome.side_panel?.default_path === "sidepanel.html", "chrome has side_panel.default_path");
  check(!("sidebar_action" in chrome), "chrome omits sidebar_action");
  check(chrome.minimum_chrome_version === "116", "chrome minimum_chrome_version is 116");
}

const firefox = await load(FIREFOX_MANIFEST);
if (firefox) {
  check(firefox.manifest_version === 3, "firefox manifest_version is 3 (forced, WXT defaults MV2)");
  checkCommon(firefox, "firefox");
  const permissions = firefox.permissions ?? [];
  for (const p of ["debugger", "sidePanel", "offscreen"]) {
    check(!permissions.includes(p), `firefox omits ${p}`);
  }
  check("sidebar_action" in firefox, "firefox has sidebar_action");
  check(!("side_panel" in firefox), "firefox omits side_panel");
  check(
    typeof firefox.browser_specific_settings?.gecko?.id === "string",
    "firefox has browser_specific_settings.gecko.id",
  );
}

if (failures > 0) {
  console.error(`check-manifest: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-manifest: all invariants hold");
