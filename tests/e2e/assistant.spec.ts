import type { Page } from "@playwright/test";
import { ask, expect, FIXTURES, test } from "./harness";
import type { ProviderConfig } from "../../src/providers/types";

// Talks to the scripted model in scripts/mock-provider.mjs.
const MOCK: ProviderConfig = {
  id: "mock",
  name: "Mock",
  baseUrl: `${FIXTURES}/v1`,
  apiKey: "test-key",
  wire: "chat",
  models: [{ id: "mock-1", vision: false, tools: true, pricing: { input: 3, output: 15 }, contextWindow: 32_000 }],
};

const MODEL = { providerId: "mock", modelId: "mock-1" };

async function approvalFor(panel: Page) {
  const approval = panel.getByRole("alertdialog", { name: "Approve action" });
  await expect(approval).toBeVisible();
  return approval;
}

test("answers about the current page and keeps context for follow-ups", async ({ openPanel }, testInfo) => {
  const panel = await openPanel([MOCK], { model: MODEL });
  await expect(panel.getByRole("button", { name: "Model" })).toContainText("mock-1");
  await expect(panel.locator(".chip-on").first()).toContainText("Fixture Form");
  await panel.screenshot({ path: testInfo.outputPath("empty.png") });

  await ask(panel, "What is this page?");
  await expect(panel.getByText('This page is titled "Fixture Form".')).toBeVisible();

  await ask(panel, "What did I ask before?");
  await expect(panel.getByText('Earlier you asked: "What is this page?".')).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath("chat.png") });
});

test("shows model, tokens and cost per answer, per chat, and in the usage dashboard", async ({ openPanel }, testInfo) => {
  const panel = await openPanel([MOCK], { model: MODEL });
  await ask(panel, "What is this page?");

  const foot = panel.locator(".msg-assistant .msg-foot").last();
  await expect(foot.locator(".model-tag")).toHaveText("mock-1");
  await expect(foot).toContainText(/[\d.]+k? tokens/);
  await expect(foot).toContainText("$");
  await foot.getByRole("button", { name: /tokens/ }).click();
  const breakdown = panel.locator(".msg-assistant .breakdown");
  await expect(breakdown).toContainText("cached");
  await expect(breakdown).toContainText("Estimated from the model prices");

  const stats = panel.locator(".chat-stats");
  await expect(stats).toContainText("This chat");
  await expect(stats).toContainText(/% of 32k/);
  await panel.screenshot({ path: testInfo.outputPath("usage-footer.png") });

  await panel.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(panel.locator(".stat").first()).toContainText("$");
  await expect(panel.locator(".model-usage")).toContainText("mock-1");
  await expect(panel.locator(".model-usage")).toContainText("1 req");
  await panel.screenshot({ path: testInfo.outputPath("usage-dashboard.png") });

  await panel.getByRole("button", { name: "Back to chat" }).click();
  await panel.getByRole("button", { name: "Model" }).click();
  await expect(panel.getByRole("option", { name: /mock-1/ })).toContainText("$3.00 / $15.00");
  await panel.screenshot({ path: testInfo.outputPath("model-picker.png") });
  await panel.keyboard.press("Escape");
  await panel.emulateMedia({ colorScheme: "dark" });
  await panel.screenshot({ path: testInfo.outputPath("chat-dark.png") });
});

test("acts on the page and asks before a risky submit", async ({ openPanel, site }) => {
  const panel = await openPanel([MOCK], { model: MODEL });
  await ask(panel, "Fill the form with my name", { waitForEnd: false });

  const approval = await approvalFor(panel);
  await expect(approval).toContainText("Send message");
  await expect(site.locator('input[name="name"]')).toHaveValue("Ada");

  // The fixture's button ignores synthetic clicks, so this only passes with trusted (CDP) input.
  await approval.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(site).toHaveURL(/shop\.html\?name=Ada/);
  await expect(panel.getByText(/^Finished\./)).toBeVisible();
});

test("acts on the current tab using the element refs attached to the question", async ({ openPanel, site }) => {
  const panel = await openPanel([MOCK], { model: MODEL });
  await ask(panel, "Type my name here");

  await expect(panel.getByText(/^Done in place\./)).toBeVisible();
  await expect(site.locator('input[name="name"]')).toHaveValue("Grace");
  await expect(site).toHaveURL(/form\.html$/);
});

test("denying a risky action leaves the page untouched", async ({ openPanel, site }) => {
  const panel = await openPanel([MOCK], { model: MODEL });
  await ask(panel, "Fill the form with my name", { waitForEnd: false });

  const approval = await approvalFor(panel);
  await approval.getByRole("button", { name: "Deny" }).click();

  await expect(panel.getByText(/^Finished\./)).toBeVisible();
  await expect(site).toHaveURL(/form\.html$/);
});

test("remembers facts across chats and forgets them from the Memory page", async ({ openPanel }, testInfo) => {
  const panel = await openPanel([MOCK], { model: MODEL });
  await ask(panel, "Please remember that my favorite color is teal");
  await expect(panel.locator(".step-label").filter({ hasText: "Remembering" })).toBeVisible();
  await expect(panel.getByText(/Got it\. Saved memory \[m\w+\]: User's favorite color is teal\./)).toBeVisible();

  await panel.getByRole("button", { name: "New chat" }).click();
  await ask(panel, "What is my favorite color?");
  await expect(panel.getByText("Your favorite color is teal.")).toBeVisible();
  await expect(panel.locator(".msg-foot").last()).toContainText("1 memory");

  await panel.getByRole("button", { name: "Memory", exact: true }).click();
  const item = panel.locator(".memory").filter({ hasText: "User's favorite color is teal." });
  await expect(item).toContainText("Saved by assistant");
  await panel.screenshot({ path: testInfo.outputPath("memory.png") });
  await item.getByRole("button", { name: /Delete memory/ }).click();
  await expect(item).toHaveCount(0);

  await panel.getByRole("button", { name: "Back to chat" }).click();
  await panel.getByRole("button", { name: "New chat" }).click();
  await ask(panel, "What is my favorite color?");
  await expect(panel.getByText("I don't know your favorite color.")).toBeVisible();
});

test("Auto mode routes a simple question to a free model", async ({ openPanel }, testInfo) => {
  const free = { id: "mock-free", vision: false, tools: true, pricing: { input: 0, output: 0 } };
  const panel = await openPanel([{ ...MOCK, models: [...MOCK.models, free] }], {
    model: MODEL,
    auto: { enabled: true, allowed: null, preferFree: true, classifier: "rules", decisionModel: null },
  });
  await expect(panel.getByRole("button", { name: "Model", exact: true })).toContainText("Auto");
  await ask(panel, "What is this page?");
  await expect(panel.getByText('This page is titled "Fixture Form".')).toBeVisible();
  const foot = panel.locator(".msg-assistant .msg-foot").last();
  await expect(foot.locator(".auto-tag")).toHaveText("Auto");
  await expect(foot.locator(".model-tag")).toHaveText("mock-free");
  await expect(panel.locator(".step-label").filter({ hasText: "Auto: mock-free, simple question, free model" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Model", exact: true })).toContainText("mock-free");
  await panel.screenshot({ path: testInfo.outputPath("auto.png") });

  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(panel.getByText("2 of 2 models allowed")).toBeVisible();
  await panel.getByRole("checkbox", { name: "Allow mock-1 in Auto" }).click();
  await expect(panel.getByText("1 of 2 models allowed")).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Tier for mock-free" })).toHaveValue("strong");
  await panel.getByRole("heading", { name: "Auto model" }).scrollIntoViewIfNeeded();
  await panel.screenshot({ path: testInfo.outputPath("auto-settings.png") });
  await panel.getByRole("button", { name: "Back to chat" }).click();

  await panel.getByRole("button", { name: "Model", exact: true }).click();
  await panel.getByRole("option", { name: /mock-1/ }).click();
  await expect(panel.getByRole("button", { name: "Model", exact: true })).not.toContainText("Auto");
});

test("the agent asks a question and continues with the answer", async ({ openPanel }, testInfo) => {
  const panel = await openPanel([MOCK], { model: MODEL });
  await ask(panel, "Book a table for tonight", { waitForEnd: false });
  const card = panel.getByRole("dialog", { name: "Agent question" });
  await expect(card).toContainText("For how many people?");
  await panel.screenshot({ path: testInfo.outputPath("question.png") });
  await card.getByRole("button", { name: "4 people" }).click();
  await expect(card).toBeHidden();
  await expect(panel.getByText('Booked. User answered: "4 people"')).toBeVisible();
  await expect(panel.locator(".step-label").filter({ hasText: "Asked: For how many people?" })).toBeVisible();
});

test("steers a running task and runs a queued message afterwards", async ({ openPanel }, testInfo) => {
  const panel = await openPanel([MOCK], { model: MODEL });
  await ask(panel, "Count slowly", { waitForEnd: false });
  await expect(panel.locator(".step-label").filter({ hasText: "Waiting 2s" }).first()).toBeVisible();

  const box = panel.getByRole("textbox", { name: "Message" });
  await box.fill("What is this page?");
  await box.press("Alt+Enter");
  await expect(panel.getByLabel("Queued messages")).toContainText("What is this page?");

  await box.fill("stop counting and say hi");
  await panel.screenshot({ path: testInfo.outputPath("steer.png") });
  await box.press("Enter");
  await expect(panel.locator(".step-label").filter({ hasText: "You: stop counting and say hi" })).toBeVisible();
  await expect(panel.getByText("Updated: stop counting and say hi")).toBeVisible({ timeout: 20_000 });

  await expect(panel.getByText('This page is titled "Fixture Form".')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByLabel("Queued messages")).toHaveCount(0);
});

test("recalls earlier chats without revealing secrets", async ({ openPanel }, testInfo) => {
  const panel = await openPanel([MOCK], { model: MODEL });
  await ask(panel, "Create an API key for the demo");
  await expect(panel.getByText(/Created API key sk-test-/)).toBeVisible();

  await panel.getByRole("button", { name: "New chat" }).click();
  await panel.getByRole("button", { name: "History", exact: true }).click();
  await expect(panel.locator(".history-digest").first()).toContainText("Created an API key named demo", { timeout: 20_000 });
  await panel.screenshot({ path: testInfo.outputPath("history-digest.png") });
  await panel.getByRole("button", { name: "Back to chat" }).click();

  await ask(panel, "Which API keys did we create?");
  await expect(panel.locator(".step-label").filter({ hasText: "Searching earlier chats: api key" })).toBeVisible();
  const answer = panel.locator(".msg-assistant .md").last();
  await expect(answer).toContainText("Created an API key named demo");
  await expect(answer).not.toContainText("sk-test-");
  await panel.screenshot({ path: testInfo.outputPath("recall.png") });

  await answer.getByRole("link", { name: "your earlier chat" }).click();
  await expect(panel.getByText(/Created API key sk-test-/)).toBeVisible();
});

test("shows a readable error for a bad API key", async ({ openPanel }) => {
  const panel = await openPanel([{ ...MOCK, apiKey: "wrong" }], { model: MODEL });
  await ask(panel, "What is this page?");
  await expect(panel.getByRole("alert")).toContainText("rejected the API key (401)");
});

// Looks like OpenRouter to the extension (preset), but talks to the mock server.
const MOCK_ROUTER: ProviderConfig = {
  ...MOCK,
  id: "router",
  name: "Mock Router",
  preset: "openrouter",
  models: [...MOCK.models, { id: "inception/mercury-decide:free", vision: false, tools: true, pricing: { input: 0, output: 0 } }],
};

test("dictates a message with the chosen speech-to-text model", async ({ openPanel, context }, testInfo) => {
  const panel = await openPanel([MOCK_ROUTER], { model: { providerId: "router", modelId: "mock-1" } });

  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  const sttSelect = panel.getByRole("combobox", { name: "Speech-to-text model" });
  await expect(sttSelect.locator("option", { hasText: "OpenAI: Whisper Large V3 Turbo" })).toHaveCount(1);
  await expect(sttSelect.locator("option", { hasText: "Chrome built-in (free)" })).toHaveCount(1);
  await sttSelect.selectOption({ label: "OpenAI: Whisper Large V3 Turbo" });
  await panel.getByRole("heading", { name: "Voice input" }).scrollIntoViewIfNeeded();
  await panel.screenshot({ path: testInfo.outputPath("voice-settings.png") });
  await panel.getByRole("button", { name: "Back to chat" }).click();

  const mic = panel.getByRole("button", { name: "Dictate" });
  await expect(mic).toHaveAttribute("title", /Whisper Large V3 Turbo/);

  // The page the panel opens when it has no microphone permission yet (the panel itself can't prompt).
  const permissionPage = await context.newPage();
  await permissionPage.goto(new URL("/mic.html", panel.url()).href);
  await expect(permissionPage.getByRole("heading", { name: "Microphone allowed" })).toBeVisible();

  await mic.click();
  await expect(panel.locator(".voice-bar")).toBeVisible();
  await expect(panel.locator(".voice-time")).toHaveText(/0:0[1-9]/, { timeout: 5_000 });
  await panel.screenshot({ path: testInfo.outputPath("voice-recording.png") });
  await panel.getByRole("button", { name: "Finish voice input" }).click();

  const box = panel.getByRole("textbox", { name: "Message" });
  await expect(box).toHaveValue("What is this page?");
  await expect(panel.locator(".voice-bar")).toBeHidden();
  const calls = (await (await panel.request.get(`${FIXTURES}/mock/transcriptions`)).json()) as { model: string; bytes: number; type: string }[];
  expect(calls.at(-1)).toMatchObject({ model: "openai/whisper-large-v3-turbo", type: "application/json" });
  expect(calls.at(-1)!.bytes).toBeGreaterThan(800);

  await box.press("Enter");
  await expect(panel.getByText('This page is titled "Fixture Form".')).toBeVisible();

  // Escape throws a recording away and keeps what was typed.
  await box.fill("draft");
  await panel.getByRole("button", { name: "Dictate" }).click();
  await expect(panel.locator(".voice-bar")).toBeVisible();
  await box.press("Escape");
  await expect(panel.locator(".voice-bar")).toBeHidden();
  await expect(box).toHaveValue("draft");
});

test("decision models are offered as classifiers, never as chat models", async ({ openPanel }, testInfo) => {
  const panel = await openPanel([MOCK_ROUTER], {
    model: { providerId: "router", modelId: "mock-1" },
    auto: { enabled: true, allowed: null, preferFree: true, classifier: "decision", decisionModel: null },
  });

  await panel.getByRole("button", { name: "Model", exact: true }).click();
  await expect(panel.getByRole("option", { name: /mercury-decide/ })).toHaveCount(0);
  await panel.keyboard.press("Escape");

  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(panel.getByText("1 of 1 models allowed")).toBeVisible();
  const classifier = panel.getByRole("combobox", { name: "Task classifier" });
  await expect(classifier.locator("option", { hasText: "Automatic: newest Jev (Jev 1.14)" })).toHaveCount(1);
  await expect(classifier.locator('optgroup[label="Added by you"] option')).toHaveText(["Inception: Mercury Decide (free) · free"]);
  await expect(classifier.locator('optgroup[label="Decision models on OpenRouter"] option')).toHaveText(["TypeSafe: Jev 1.14"]);
  await classifier.selectOption({ label: "Inception: Mercury Decide (free) · free" });
  await panel.getByRole("button", { name: "Test Mercury decide" }).click();
  await expect(panel.locator(".decision-test")).toContainText("simple question · 91% sure");
  await panel.getByRole("heading", { name: "Auto model" }).scrollIntoViewIfNeeded();
  await panel.screenshot({ path: testInfo.outputPath("decision-settings.png") });
  await panel.getByRole("button", { name: "Back to chat" }).click();

  await ask(panel, "What is this page?");
  await expect(panel.getByText('This page is titled "Fixture Form".')).toBeVisible();
  const foot = panel.locator(".msg-assistant .msg-foot").last();
  await expect(foot.locator(".model-tag")).toHaveText("mock-1");
  await expect(panel.locator(".step-label").filter({ hasText: "(Mercury decide 91%)" })).toBeVisible();
  const asked = (await (await panel.request.get(`${FIXTURES}/mock/decisions`)).json()) as { model: string }[];
  expect(asked.at(-1)!.model).toBe("inception/mercury-decide:free");
});
