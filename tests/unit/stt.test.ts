import { describe, expect, it, vi } from "vitest";
import { fetchCatalog, isChatModel, looksLikeDecision, looksLikeStt } from "../../src/providers/catalog";
import { audioFormat, autoSttOption, BROWSER_STT, resolveStt, shortSttLabel, sttOptions, transcribe } from "../../src/providers/stt";
import type { ModelConfig, ProviderConfig } from "../../src/providers/types";
import { catalogFingerprint, needsRefresh } from "../../src/storage/catalogs";

const model = (id: string): ModelConfig => ({ id, vision: false, tools: true });

const OPENROUTER: ProviderConfig = {
  id: "openrouter",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "or-key",
  wire: "chat",
  preset: "openrouter",
  models: [model("z-ai/glm-5.3:free")],
};
const GROQ: ProviderConfig = {
  id: "groq",
  name: "Groq",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "gsk-key",
  wire: "chat",
  preset: "custom",
  models: [model("llama-4-scout"), model("whisper-large-v3")],
};

function jsonFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("model kinds", () => {
  const DECISIONS = [
    "typesafe/jev-1.14",
    "~typesafe/jev-latest",
    "~perplexity/pplx-decider-latest",
    "scaledown/classify-1",
    "nace-ai/drex-v2.0",
    "microsoft/microsoft-decision-1",
    "cloudflare/clef-omni",
    "cloudflare/clef",
    "upstage/solar-decide-flash",
    "openai/gpt-6-luna-decisions",
    "liquid/d1",
    "togethercomputer/tev1-4b-experimental",
    "inception/mercury-decide:free",
    "respan/span-01-lite:free",
    "jaredpalmer/kev-4b",
  ];
  const STT = ["openai/whisper-large-v3-turbo", "whisper-large-v3", "openai/gpt-4o-mini-transcribe", "elevenlabs/scribe-v2", "google/chirp-3", "deepgram/nova-3", "x-ai/grok-stt-1.0", "qwen/qwen3-asr-1.7b", "nvidia/parakeet-tdt-0.6b-v3"];
  const CHAT = ["openai/gpt-6-luna", "z-ai/glm-5.3:free", "amazon/nova-2-lite-v1", "amazon/nova-pro-v1", "inception/mercury-coder", "anthropic/claude-opus-5.5", "mistralai/voxtral-mini-3b"];

  it.each(DECISIONS)("%s is a decision model", (id) => {
    expect(looksLikeDecision(id)).toBe(true);
    expect(isChatModel(id)).toBe(false);
  });
  it.each(STT)("%s is a speech-to-text model", (id) => {
    expect(looksLikeStt(id)).toBe(true);
    expect(isChatModel(id)).toBe(false);
  });
  it.each(CHAT)("%s is a chat model", (id) => {
    expect(isChatModel(id)).toBe(true);
  });
});

describe("catalog discovery", () => {
  it("asks OpenRouter by output modality and keeps only matching models", async () => {
    const { impl, calls } = jsonFetch({
      data: [
        { id: "openai/whisper-large-v3-turbo", name: "OpenAI: Whisper Large V3 Turbo", architecture: { output_modalities: ["transcription"] }, pricing: { prompt: "0.00000333", completion: "0" } },
        { id: "openai/gpt-6-luna", architecture: { output_modalities: ["text"] } },
      ],
    });
    const models = await fetchCatalog(OPENROUTER, "transcription", impl);
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/models?output_modalities=transcription");
    expect(models).toEqual([{ id: "openai/whisper-large-v3-turbo", label: "OpenAI: Whisper Large V3 Turbo" }]);
  });

  it("marks free decision models", async () => {
    const { impl, calls } = jsonFetch({
      data: [
        { id: "inception/mercury-decide:free", name: "Inception: Mercury Decide (free)", architecture: { output_modalities: ["decisions"] }, pricing: { prompt: "0", completion: "0" } },
        { id: "typesafe/jev-1.14", name: "TypeSafe: Jev 1.14", architecture: { output_modalities: ["decisions"] }, pricing: { prompt: "0.000000042", completion: "0" } },
      ],
    });
    const models = await fetchCatalog(OPENROUTER, "decisions", impl);
    expect(calls[0]!.url).toContain("output_modalities=decisions");
    expect(models.find((m) => m.id === "inception/mercury-decide:free")?.free).toBe(true);
    expect(models.find((m) => m.id === "typesafe/jev-1.14")?.free).toBeUndefined();
  });

  it("filters other providers by name and skips decisions entirely", async () => {
    const { impl, calls } = jsonFetch({ data: [{ id: "llama-4-scout" }, { id: "whisper-large-v3" }, { id: "distil-whisper-large-v3-en" }] });
    expect((await fetchCatalog(GROQ, "transcription", impl)).map((m) => m.id)).toEqual(["distil-whisper-large-v3-en", "whisper-large-v3"]);
    expect(await fetchCatalog(GROQ, "decisions", impl)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("refreshes when stale or when the key or URL changes", () => {
    const entry = { fingerprint: catalogFingerprint(OPENROUTER), models: [], fetchedAt: 1_000 };
    expect(needsRefresh(entry, OPENROUTER, 2_000)).toBe(false);
    expect(needsRefresh(entry, OPENROUTER, 1_000 + 25 * 3600_000)).toBe(true);
    expect(needsRefresh(entry, { ...OPENROUTER, apiKey: "other-key" }, 2_000)).toBe(true);
    expect(needsRefresh({ ...entry, error: "x" }, OPENROUTER, 1_000 + 2 * 3600_000)).toBe(true);
    expect(needsRefresh(undefined, OPENROUTER)).toBe(true);
  });
});

describe("choosing a speech-to-text model", () => {
  const detected = { openrouter: [{ id: "openai/whisper-1", label: "OpenAI: Whisper 1" }, { id: "openai/whisper-large-v3-turbo", label: "OpenAI: Whisper Large V3 Turbo" }] };
  const options = sttOptions([OPENROUTER, GROQ], detected);

  it("merges detected models with STT models saved on providers", () => {
    expect(options.map((o) => `${o.ref.providerId}/${o.ref.modelId}`)).toEqual([
      "openrouter/openai/whisper-1",
      "openrouter/openai/whisper-large-v3-turbo",
      "groq/whisper-large-v3",
    ]);
  });

  it("automatically prefers a fast, cheap model", () => {
    expect(autoSttOption(options)?.ref.modelId).toBe("openai/whisper-large-v3-turbo");
    const choice = resolveStt(null, options, [OPENROUTER, GROQ], true);
    expect(choice?.kind).toBe("api");
    expect(choice?.kind === "api" && choice.provider.id).toBe("openrouter");
  });

  it("honours the user's pick, including Chrome's built-in recognition", () => {
    expect(resolveStt({ providerId: "groq", modelId: "whisper-large-v3" }, options, [OPENROUTER, GROQ], true)?.ref.modelId).toBe("whisper-large-v3");
    expect(resolveStt(BROWSER_STT, options, [OPENROUTER, GROQ], true)?.kind).toBe("browser");
    expect(resolveStt(BROWSER_STT, options, [OPENROUTER, GROQ], false)).toBeNull();
  });

  it("falls back when the picked provider lost its key, and to the browser when nothing else exists", () => {
    const noKey = { ...GROQ, apiKey: "" };
    expect(resolveStt({ providerId: "groq", modelId: "whisper-large-v3" }, sttOptions([noKey], {}), [noKey], true)?.kind).toBe("browser");
    expect(resolveStt(null, [], [], false)).toBeNull();
  });

  it("formats labels and audio types", () => {
    expect(shortSttLabel("OpenAI: Whisper Large V3")).toBe("Whisper Large V3");
    expect(shortSttLabel("whisper-large-v3")).toBe("whisper-large-v3");
    expect(audioFormat("audio/webm;codecs=opus")).toBe("webm");
    expect(audioFormat("audio/mp4")).toBe("m4a");
    expect(audioFormat("audio/ogg;codecs=opus")).toBe("ogg");
  });
});

describe("transcription", () => {
  const audio = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm;codecs=opus" });

  it("sends base64 JSON to OpenRouter and reads text and cost", async () => {
    const { impl, calls } = jsonFetch({ text: " hello there ", usage: { cost: 0.0004, input_tokens: 0 } });
    const result = await transcribe({ provider: OPENROUTER, modelId: "openai/whisper-large-v3-turbo", audio, language: "en", fetchImpl: impl });
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body).toEqual({ model: "openai/whisper-large-v3-turbo", input_audio: { data: "AQIDBA==", format: "webm" }, language: "en" });
    expect(result).toEqual({ text: "hello there", inputTokens: 0, cost: 0.0004 });
  });

  it("uploads multipart to other OpenAI-compatible providers", async () => {
    const { impl, calls } = jsonFetch({ text: "hi" });
    await transcribe({ provider: GROQ, modelId: "whisper-large-v3", audio, fetchImpl: impl });
    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    const form = calls[0]!.init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3");
    expect((form.get("file") as File).name).toBe("speech.webm");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
    expect(headers["authorization"]).toBe("Bearer gsk-key");
  });

  it("reports provider errors readably", async () => {
    const { impl } = jsonFetch({ error: { message: "bad model" } }, 400);
    await expect(transcribe({ provider: OPENROUTER, modelId: "x", audio, fetchImpl: impl })).rejects.toThrow(/bad model/);
  });
});
