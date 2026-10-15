// Auto mode: work out how demanding a message is, then pick the cheapest
// allowed model that is good enough (free first), with fallbacks.

import { providerHeaders } from "../providers/http";
import type { ModelConfig, ModelRef, ModelTier, ProviderConfig, StreamEvent, StreamRequest } from "../providers/types";
import type { AutoSettings } from "../storage/settings";
import { approxTokens, requestUsage, type RequestUsage, type UsageEvent } from "./usage";

export type Level = "simple" | "standard" | "complex";

export interface Need {
  level: Level;
  /** Has to click, type or navigate in the browser. */
  tools: boolean;
  /** Has to look at images, charts or layout. */
  vision: boolean;
}

export interface Classification extends Need {
  confident: boolean;
}

export interface Candidate {
  provider: ProviderConfig;
  model: ModelConfig;
  tier: ModelTier;
  free: boolean;
}

export const JEV_MODEL = "typesafe/jev-1.13";

const TIER_RANK: Record<ModelTier, number> = { basic: 0, strong: 1, best: 2 };
const LEVEL_TIER: Record<Level, ModelTier> = { simple: "basic", standard: "strong", complex: "best" };
const LEVELS: Level[] = ["simple", "standard", "complex"];

const BASIC_NAME = /(?:^|[-/._: ])(?:flash|mini|nano|lite|air|small|haiku|tiny)(?=$|[-/._: \d])|(?:^|[-/._: ])\d+(?:\.\d+)?b(?=$|[-/._: ])/i;
const BEST_NAME = /(?:^|[-/._: ])(?:pro|max|opus|ultra|prime)(?=$|[-/._: \d])|gpt-6|grok-4/i;

export function isFree(model: ModelConfig): boolean {
  return (model.pricing !== undefined && model.pricing.input === 0 && model.pricing.output === 0) || /:free$/i.test(model.id);
}

export function guessTier(model: ModelConfig): ModelTier {
  if (model.tier) return model.tier;
  if (model.pricing && !isFree(model)) {
    if (model.pricing.output >= 10) return "best";
    if (model.pricing.output <= 1) return "basic";
    return "strong";
  }
  const name = model.id.replace(/:free$/i, "");
  if (BASIC_NAME.test(name)) return "basic";
  if (BEST_NAME.test(name)) return "best";
  return "strong";
}

/** Blended USD per 1M tokens (about 3 input tokens per output token); unknown prices sort last. */
function blendedPrice(model: ModelConfig): number {
  if (isFree(model)) return 0;
  if (!model.pricing) return Number.POSITIVE_INFINITY;
  return model.pricing.input * 0.75 + model.pricing.output * 0.25;
}

export function hasKey(provider: ProviderConfig): boolean {
  return provider.apiKey.trim() !== "" || /localhost|127\.0\.0\.1/.test(provider.baseUrl);
}

const sameRef = (a: ModelRef, provider: ProviderConfig, model: ModelConfig) => a.providerId === provider.id && a.modelId === model.id;

/** Every model Auto may use: allowed in Settings and its provider has a key. */
export function autoCandidates(providers: ProviderConfig[], auto: AutoSettings): Candidate[] {
  const out: Candidate[] = [];
  for (const provider of providers) {
    if (!hasKey(provider)) continue;
    for (const model of provider.models) {
      if (auto.allowed && !auto.allowed.some((ref) => sameRef(ref, provider, model))) continue;
      out.push({ provider, model, tier: guessTier(model), free: isFree(model) });
    }
  }
  return out;
}

/** Candidates in order of preference for `need`: the first is the pick, the rest are fallbacks. */
export function rankCandidates(candidates: Candidate[], need: Need, preferFree: boolean): Candidate[] {
  let pool = candidates.filter((c) => (!need.tools || c.model.tools) && (!need.vision || c.model.vision));
  if (pool.length === 0) pool = candidates.filter((c) => !need.tools || c.model.tools);
  if (pool.length === 0) pool = candidates;
  const floor = TIER_RANK[LEVEL_TIER[need.level]];
  const good = pool.filter((c) => TIER_RANK[c.tier] >= floor);
  const weaker = pool.filter((c) => TIER_RANK[c.tier] < floor);
  good.sort(
    (a, b) =>
      (preferFree ? Number(b.free) - Number(a.free) : 0) ||
      blendedPrice(a.model) - blendedPrice(b.model) ||
      TIER_RANK[a.tier] - TIER_RANK[b.tier],
  );
  weaker.sort(
    (a, b) =>
      TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
      (preferFree ? Number(b.free) - Number(a.free) : 0) ||
      blendedPrice(a.model) - blendedPrice(b.model),
  );
  return [...good, ...weaker];
}

/** Cheapest allowed model for background chores (summaries, digests, classification). */
export function cheapestCandidate(candidates: Candidate[]): Candidate | undefined {
  return rankCandidates(candidates, { level: "simple", tools: false, vision: false }, true)[0];
}

// ---------------------------------------------------------------- rules

const ACTION =
  /\b(click|tap|open|go to|navigate|visit|sign ?in|log ?in|sign ?up|register|fill|book|buy|order|purchase|add\b.{0,40}?\bto (?:the |my )?(?:cart|bag|basket|wishlist|list)|apply|search for|look up|find (?:on|in) (?:this|the)|type|enter|submit|select|choose|download|subscribe|unsubscribe|reply|send|post|delete|remove|scroll|check ?out|play|watch|follow|like|share|upload|create (?:a |an |my )?(?:account|key|token|repo|post|event))\b/i;
const COMPLEX =
  /\b(compare|comparison|research|itinerary|analy[sz]e|analysis|write (?:the |some |a |an )?(?:code|script|program|function|essay|report)|debug|refactor|step[- ]by[- ]step|in[- ]depth|detailed (?:report|plan|analysis)|pros and cons|trade-?offs|plan (?:a|my|the|out)|across (?:sites|websites|several|multiple))\b/i;
const VISION = /\b(screenshot|image|images|picture|photo|chart|graph|diagram|logo|layout|looks? like|colou?r of|visual(?:ly)?|design)\b/i;
const GREETING = /^(hi|hello|hey|yo|thanks|thank you|ok|okay|cool|great|good (?:morning|afternoon|evening|night))\b/i;
const QUESTION = /^(what|who|when|where|why|how|which|is|are|does|do|did|can|could|summari[sz]e|explain|translate|define|tl;?dr|list|give me|tell me)\b/i;
const SITE = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|in|co|dev|app|edu|gov|uk|de)\b/gi;

export function classifyByRules(question: string): Classification {
  const q = question.trim();
  const tools = ACTION.test(q);
  const vision = VISION.test(q);
  const sites = new Set((q.match(SITE) ?? []).map((s) => s.toLowerCase())).size;
  if (COMPLEX.test(q) || sites >= 2 || q.length > 600) return { level: "complex", tools, vision, confident: true };
  if (tools) return { level: "standard", tools, vision, confident: true };
  if (GREETING.test(q) && q.length < 60) return { level: "simple", tools, vision, confident: true };
  if (q.length < 80) return { level: "simple", tools, vision, confident: true };
  if (QUESTION.test(q) && q.length < 200) return { level: "simple", tools, vision, confident: true };
  return { level: "standard", tools, vision, confident: false };
}

// ---------------------------------------------------------------- Jev

export interface JevResult {
  need: Need;
  confidence: number;
  usage: RequestUsage;
}

export function findOpenRouter(providers: ProviderConfig[]): ProviderConfig | undefined {
  return providers.find((p) => (p.preset === "openrouter" || /openrouter\.ai/i.test(p.baseUrl)) && p.apiKey.trim() !== "");
}

export function decisionsUrl(provider: ProviderConfig): string {
  return `${provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/alpha/decisions`;
}

export interface JevOptions {
  provider: ProviderConfig;
  question: string;
  page?: { title: string; url: string };
  earlier?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

interface JevAnswer {
  choice?: unknown;
  confidence?: unknown;
  noul?: unknown;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export async function classifyWithJev(opts: JevOptions): Promise<JevResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 1500);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const body = {
    model: JEV_MODEL,
    state: {
      request: opts.question.slice(0, 2000),
      ...(opts.page ? { page: `${opts.page.title} - ${opts.page.url}` } : {}),
      ...(opts.earlier && opts.earlier.length > 0 ? { earlier: opts.earlier.map((t) => t.slice(0, 500)) } : {}),
    },
    questions: {
      level: {
        type: "choice",
        instructions: "How capable a model does this browser-assistant request need?",
        criteria: {
          simple: "Small talk, or a quick fact or summary answerable from the current page.",
          standard: "Normal browsing: navigating, reading, filling forms, signing in, one-site tasks.",
          complex: "Multi-site research, comparisons, planning, code, or long careful reasoning.",
        },
      },
      browser: { type: "noul", instructions: "Does it need clicking, typing or navigating in the browser?" },
      vision: { type: "noul", instructions: "Does it need to look at images, charts, or page layout?" },
    },
  };
  try {
    const response = await (opts.fetchImpl ?? fetch)(decisionsUrl(opts.provider), {
      method: "POST",
      headers: providerHeaders(opts.provider),
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`Jev returned ${response.status}`);
    const json = (await response.json()) as {
      answers?: Record<string, JevAnswer | undefined>;
      usage?: { cost?: unknown; input_tokens?: unknown; output_tokens?: unknown };
    };
    const level = json.answers?.level;
    const choice = level?.choice;
    if (typeof choice !== "string" || !LEVELS.includes(choice as Level)) throw new Error("Jev gave no usable answer");
    const confidence = num(level?.confidence, 0);
    let chosen = choice as Level;
    if (confidence < 0.55) chosen = LEVELS[Math.min(LEVELS.indexOf(chosen) + 1, LEVELS.length - 1)]!;
    const yes = (a: JevAnswer | undefined) => num(a?.noul, 0) >= 0.5;
    const event: UsageEvent = {
      type: "usage",
      inputTokens: num(json.usage?.input_tokens, 0),
      outputTokens: num(json.usage?.output_tokens, 0),
      ...(typeof json.usage?.cost === "number" ? { cost: json.usage.cost } : {}),
    };
    return {
      need: { level: chosen, tools: yes(json.answers?.browser), vision: yes(json.answers?.vision) },
      confidence,
      usage: requestUsage(event, undefined),
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------- tiny model call

const CLASSIFIER_PROMPT = [
  "Classify a request sent to an AI browser assistant. Reply with only JSON, no other text:",
  '{"level":"simple|standard|complex","tools":true|false,"vision":true|false}',
  "simple: small talk or a quick answer from the current page. standard: normal browsing, reading, forms, sign-in, one-site tasks. complex: multi-site research, comparisons, planning, code, long reasoning.",
  "tools: it needs clicking, typing or navigating in the browser. vision: it needs to look at images, charts or layout.",
].join("\n");

export interface ModelClassifyOptions {
  candidate: Candidate;
  question: string;
  stream: (req: StreamRequest) => AsyncGenerator<StreamEvent>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function classifyWithModel(opts: ModelClassifyOptions): Promise<{ need: Need; usage: RequestUsage }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  let text = "";
  let usage: UsageEvent | null = null;
  const question = opts.question.slice(0, 2000);
  try {
    for await (const event of opts.stream({
      provider: opts.candidate.provider,
      model: opts.candidate.model,
      messages: [
        { role: "system", content: CLASSIFIER_PROMPT },
        { role: "user", content: question },
      ],
      maxTokens: 60,
      signal: controller.signal,
    })) {
      if (event.type === "text") text += event.text;
      else if (event.type === "usage") usage = event;
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
  const usageOut = requestUsage(usage, opts.candidate.model.pricing, {
    input: approxTokens(CLASSIFIER_PROMPT.length + question.length),
    output: approxTokens(text.length),
  });
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("The classifier reply had no JSON.");
  const parsed = JSON.parse(match[0]) as { level?: unknown; tools?: unknown; vision?: unknown };
  if (typeof parsed.level !== "string" || !LEVELS.includes(parsed.level as Level)) throw new Error("The classifier gave an unknown level.");
  return { need: { level: parsed.level as Level, tools: parsed.tools === true, vision: parsed.vision === true }, usage: usageOut };
}

// ---------------------------------------------------------------- routing

export interface RouteOptions {
  providers: ProviderConfig[];
  auto: AutoSettings;
  question: string;
  page?: { title: string; url: string };
  earlier?: string[];
  stream: (req: StreamRequest) => AsyncGenerator<StreamEvent>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Usage of classifier calls, so they count toward the message. */
  onUsage?: (usage: RequestUsage, by: { provider: ProviderConfig; modelId: string }) => void;
}

export interface Route {
  provider: ProviderConfig;
  model: ModelConfig;
  need: Need;
  reason: string;
  classifiedBy: "jev" | "rules" | "model";
  confidence?: number;
  /** Next-best models to try if the pick fails before answering. */
  fallbacks: Candidate[];
}

function describe(need: Need, pick: Candidate): string {
  const task = need.tools ? "browser task" : "question";
  const what = `${need.level} ${task}${need.vision ? " with visuals" : ""}`;
  return `${what}, ${pick.free ? "free model" : `${pick.tier} tier`}`;
}

export async function routeModel(opts: RouteOptions): Promise<Route | null> {
  const candidates = autoCandidates(opts.providers, opts.auto);
  if (candidates.length === 0) return null;

  let need: Need | null = null;
  let classifiedBy: Route["classifiedBy"] = "rules";
  let confidence: number | undefined;

  const openRouter = opts.auto.classifier === "jev" ? findOpenRouter(opts.providers) : undefined;
  if (openRouter) {
    try {
      const jev = await classifyWithJev({
        provider: openRouter,
        question: opts.question,
        page: opts.page,
        earlier: opts.earlier,
        signal: opts.signal,
        fetchImpl: opts.fetchImpl,
      });
      opts.onUsage?.(jev.usage, { provider: openRouter, modelId: JEV_MODEL });
      need = jev.need;
      classifiedBy = "jev";
      confidence = jev.confidence;
    } catch {
      need = null;
    }
  }

  if (!need) {
    const rules = classifyByRules(opts.question);
    need = rules;
    if (!rules.confident) {
      const cheap = cheapestCandidate(candidates);
      if (cheap) {
        try {
          const result = await classifyWithModel({ candidate: cheap, question: opts.question, stream: opts.stream, signal: opts.signal });
          opts.onUsage?.(result.usage, { provider: cheap.provider, modelId: cheap.model.id });
          need = result.need;
          classifiedBy = "model";
        } catch {
          need = rules;
        }
      }
    }
  }

  const ranked = rankCandidates(candidates, need, opts.auto.preferFree);
  const pick = ranked[0]!;
  const by = classifiedBy === "jev" ? `Jev${confidence !== undefined ? ` ${Math.round(confidence * 100)}%` : ""}` : classifiedBy === "model" ? "quick model check" : "rules";
  return {
    provider: pick.provider,
    model: pick.model,
    need: { level: need.level, tools: need.tools, vision: need.vision },
    reason: `${describe(need, pick)} (${by})`,
    classifiedBy,
    confidence,
    fallbacks: ranked.slice(1),
  };
}
