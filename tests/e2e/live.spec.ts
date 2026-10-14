// Opt-in smoke test against real providers. Keys are read at runtime from a
// local file and never stored in the repo:
//   LIVE_PROVIDERS_FILE=~/.commandcode/providers.json pnpm e2e live
// The file follows { provider: { "<id>": { apiKey } } }.
// LIVE_MODELS overrides the models, e.g. "openrouter:deepseek/deepseek-v4.1-flash,opencode-go:glm-5.3-flash".
import { readFileSync } from "node:fs";
import { ask, expect, test } from "./harness";
import { openCodeGoPreset, openRouterPreset } from "../../src/providers/presets";
import type { ProviderConfig } from "../../src/providers/types";

const FILE = process.env.LIVE_PROVIDERS_FILE;

const MODELS = (process.env.LIVE_MODELS ?? "openrouter:deepseek/deepseek-v4.1-flash,opencode-go:glm-5.3-flash")
  .split(",")
  .map((pair) => {
    const at = pair.indexOf(":");
    return { providerId: pair.slice(0, at), modelId: pair.slice(at + 1) };
  });

function liveProviders(): ProviderConfig[] {
  if (!FILE) return [];
  const raw = JSON.parse(readFileSync(FILE.replace(/^~/, process.env.HOME ?? ""), "utf8")) as {
    provider?: Record<string, { apiKey?: string }>;
  };
  return [openRouterPreset(), openCodeGoPreset()].map((p) => ({ ...p, apiKey: raw.provider?.[p.id]?.apiKey ?? "" }));
}

test.skip(!FILE, "set LIVE_PROVIDERS_FILE to run live provider checks");
test.setTimeout(180_000);

for (const model of MODELS) {
  test(`${model.providerId}/${model.modelId}: answers from the page and fills a field`, async ({ openPanel, site }) => {
    const panel = await openPanel(liveProviders(), { model });
    const errors = () => panel.locator(".msg-error").allInnerTexts();

    await ask(panel, "Which input fields does this form have? Answer in one short sentence.");
    expect(await errors()).toEqual([]);
    await expect(panel.locator(".msg-assistant").last()).toContainText(/email/i);

    await ask(panel, 'Type "Ada" into the Name field on this page. Do not submit the form.');
    expect(await errors()).toEqual([]);
    await expect(site.locator('input[name="name"]')).toHaveValue("Ada");
    await expect(site).toHaveURL(/form\.html$/);
  });
}
