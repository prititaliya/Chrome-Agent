import { describe, expect, it } from "vitest";
import { digestSession } from "../../src/agent/summary";
import type { ApiMessage, StreamEvent, StreamRequest } from "../../src/providers/types";
import { createConversation, deleteConversation, saveConversation, type Conversation } from "../../src/storage/conversations";
import { getDigest, saveDigest } from "../../src/storage/digests";
import { REDACTED, redactSecrets } from "../../src/storage/redact";
import { formatSessionHits, needsDigest, readSession, searchSessions } from "../../src/storage/sessions";

describe("secret redaction", () => {
  it.each([
    "sk-proj-Abcdefghijklmnop1234567890",
    "sk-or-v1-0123456789abcdef0123456789abcdef",
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    "AIzaSyA1234567890abcdefghijklmnopqrstu",
    "xoxb-1234567890-abcdefghij",
    "AKIAABCDEFGHIJKLMNOP",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "4111 1111 1111 1111",
    "Q2xhdWRlSXNHcmVhdDEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9w",
  ])("hides %s", (secret) => {
    const out = redactSecrets(`here it is: ${secret} ok`);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it("hides labelled passwords and codes but keeps ordinary text", () => {
    expect(redactSecrets("password: hunter22")).toBe(`password: ${REDACTED}`);
    expect(redactSecrets("Code 482913 from GitHub")).toBe(`Code ${REDACTED} from GitHub`);
    expect(redactSecrets("your verification code is 55821")).toBe(`your verification code is ${REDACTED}`);
    const plain = "Created an API key named prod on platform.example.com (value not stored). Chrome filled the saved password field.";
    expect(redactSecrets(plain)).toBe(plain);
    expect(redactSecrets("how-to-bake-a-chocolate-cake-in-30-minutes-guide")).toBe("how-to-bake-a-chocolate-cake-in-30-minutes-guide");
  });
});

describe("digest scheduling", () => {
  const turns = (n: number): ApiMessage[] =>
    Array.from({ length: n }, (_, i) => [
      { role: "user" as const, content: `q${i}` },
      { role: "assistant" as const, content: `a${i}` },
    ]).flat();

  it("waits for two new turns after a task, but takes any new turn when leaving the chat", () => {
    expect(needsDigest(turns(1), undefined, false)).toBe(false);
    expect(needsDigest(turns(2), undefined, false)).toBe(true);
    expect(needsDigest(turns(1), undefined, true)).toBe(true);
    expect(needsDigest(turns(3), { apiLength: 4 }, false)).toBe(false);
    expect(needsDigest(turns(4), { apiLength: 4 }, false)).toBe(true);
    expect(needsDigest(turns(2), { apiLength: 4 }, true)).toBe(false);
  });
});

async function chat(title: string, texts: [string, string][], updatedAt: number): Promise<Conversation> {
  const conv = createConversation(null);
  conv.title = title;
  conv.updatedAt = updatedAt;
  conv.messages = texts.flatMap(([q, a], i) => [
    { id: `u${i}`, role: "user" as const, text: q, createdAt: updatedAt },
    { id: `a${i}`, role: "assistant" as const, text: a, createdAt: updatedAt, steps: [{ id: "s", tool: "click", label: "Clicking Create", status: "ok" as const, detail: "Clicked" }] },
  ]);
  conv.api = texts.flatMap(([q, a]) => [
    { role: "user" as const, content: q },
    { role: "assistant" as const, content: a },
  ]);
  await saveConversation(conv);
  return conv;
}

describe("searching earlier chats", () => {
  it("ranks digests, falls back to chat text, filters by date, and excludes the current chat", async () => {
    const keys = await chat("OpenRouter setup", [["make me a key", "Done: sk-or-v1-0123456789abcdef0123456789abcdef"]], Date.parse("2026-10-10T12:00:00"));
    const flights = await chat("Flights", [["cheapest flight to tokyo", "ANA at $820"]], Date.parse("2026-10-12T12:00:00"));
    const old = await chat("Old notes", [["remember the api docs", "noted"]], Date.parse("2026-09-01T12:00:00"));
    await saveDigest({
      convId: keys.id,
      title: keys.title,
      updatedAt: keys.updatedAt,
      digest: "- Created an API key named demo on openrouter.ai (value not stored).",
      keywords: ["api key", "openrouter"],
      apiLength: 2,
    });

    const hits = await searchSessions({ query: "api keys" });
    expect(hits.map((h) => h.id)).toEqual([keys.id, old.id]);
    expect(hits[0]!.digest).toContain("API key named demo");
    expect(hits[1]!.snippet).toContain("api docs");

    const text = formatSessionHits(hits, { query: "api keys" });
    expect(text).toContain(`[${keys.id}] "OpenRouter setup"`);
    expect(text).not.toContain("sk-or-v1");
    expect(text).toContain("#chat/<id>");

    expect((await searchSessions({ since: "2026-10-11" })).map((h) => h.id)).toEqual([flights.id]);
    expect((await searchSessions({ until: "2026-10-01" })).map((h) => h.id)).toEqual([old.id]);
    expect((await searchSessions({ query: "tokyo", excludeId: flights.id })).length).toBe(0);
    expect((await searchSessions({})).map((h) => h.id)).toEqual([flights.id, keys.id, old.id]);
  });

  it("deleting a chat deletes its digest", async () => {
    const conv = await chat("Temp", [["a", "b"]], Date.now());
    await saveDigest({ convId: conv.id, title: "Temp", updatedAt: 1, digest: "x", keywords: [], apiLength: 2 });
    await deleteConversation(conv.id);
    expect(await getDigest(conv.id)).toBeUndefined();
  });
});

describe("reading an earlier chat", () => {
  it("returns numbered messages with steps, redacted, with query and paging", async () => {
    const conv = await chat(
      "Keys",
      [
        ["hello", "hi there"],
        ["create a key", "Your key is sk-proj-Abcdefghijklmnop1234567890"],
        ["thanks", `you're welcome. ${"lorem ipsum ".repeat(120)}`],
      ],
      Date.now(),
    );
    const full = await readSession(conv.id);
    expect(full).toContain("#0 USER");
    expect(full).toContain("Clicking Create [ok]");
    expect(full).not.toContain("sk-proj-Abcdefghijklmnop1234567890");
    expect(full).toContain(REDACTED);

    const matched = await readSession(conv.id, { query: "key" });
    expect(matched).toContain("#2 USER");
    expect(matched).toContain("#3 ASSISTANT");
    expect(matched).not.toContain("#5 ASSISTANT");

    const paged = await readSession(conv.id, { maxChars: 1000 });
    expect(paged).toMatch(/more available: call read_session with offset \d+/);
    const rest = await readSession(conv.id, { offset: 4 });
    expect(rest).not.toContain("#0 USER");
    expect(rest).toContain("#4 USER");

    expect(await readSession("missing")).toContain("No chat with id missing");
  });
});

describe("digest writer", () => {
  it("asks for a secret-free digest, redacts the input and output, and parses keywords", async () => {
    const requests: StreamRequest[] = [];
    const stream = async function* (req: StreamRequest): AsyncGenerator<StreamEvent> {
      requests.push(req);
      yield { type: "text", text: "- Created API key sk-proj-Abcdefghijklmnop1234567890 on openrouter.ai\nKeywords: API key, OpenRouter, demo" };
    };
    const result = await digestSession({
      provider: { id: "p", name: "P", baseUrl: "https://x", apiKey: "k", wire: "chat", models: [] },
      model: { id: "m", vision: false, tools: true },
      title: "Keys",
      createdAt: Date.now(),
      api: [
        { role: "user", content: "make a key" },
        { role: "assistant", content: "Here: sk-proj-Abcdefghijklmnop1234567890" },
      ],
      stream,
      redact: redactSecrets,
    });
    const sent = JSON.stringify(requests[0]!.messages);
    expect(sent).toContain("Never write secret values");
    expect(sent).not.toContain("sk-proj-Abcdefghijklmnop1234567890");
    expect(result.digest).not.toContain("sk-proj");
    expect(result.digest).not.toMatch(/keywords/i);
    expect(result.keywords).toEqual(["api key", "openrouter", "demo"]);
  });
});
