// Token/cost accounting shared by the agent loop, the chat UI and the usage dashboard.

import type { ModelPricing, StreamEvent } from "../providers/types";

export type UsageEvent = Extract<StreamEvent, { type: "usage" }>;

/** Usage of one model request. */
export interface RequestUsage {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  /** USD; null when neither the provider nor the user's price list gives a cost. */
  cost: number | null;
  costSource: "provider" | "estimate" | "none";
  /** Token counts were estimated from text length because the provider reported none. */
  approx: boolean;
}

/** Sum over any number of requests. */
export interface Usage {
  requests: number;
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  /** Sum of known costs. */
  cost: number;
  /** Requests whose cost is unknown (no reported cost and no pricing). */
  unpriced: number;
  /** Requests whose cost came from the user's price list rather than the provider's bill. */
  estimated: number;
  /** Requests whose token counts are approximate. */
  approx: number;
  /** Prompt size of the most recent request: how full the context window is. */
  lastInput: number;
}

export function emptyUsage(): Usage {
  return { requests: 0, input: 0, output: 0, cached: 0, reasoning: 0, cost: 0, unpriced: 0, estimated: 0, approx: 0, lastInput: 0 };
}

export function priceOf(tokens: { input: number; output: number; cached: number }, pricing: ModelPricing): number {
  const cachedRate = pricing.cachedInput ?? pricing.input;
  const fresh = Math.max(0, tokens.input - tokens.cached);
  return (fresh * pricing.input + tokens.cached * cachedRate + tokens.output * pricing.output) / 1e6;
}

export function requestUsage(event: UsageEvent | null, pricing: ModelPricing | undefined, fallback?: { input: number; output: number }): RequestUsage {
  const approx = event === null;
  const tokens = {
    input: event?.inputTokens ?? fallback?.input ?? 0,
    output: event?.outputTokens ?? fallback?.output ?? 0,
    cached: event?.cachedTokens ?? 0,
  };
  const reasoning = event?.reasoningTokens ?? 0;
  if (event?.cost !== undefined) return { ...tokens, reasoning, cost: event.cost, costSource: "provider", approx };
  if (pricing) return { ...tokens, reasoning, cost: priceOf(tokens, pricing), costSource: "estimate", approx };
  return { ...tokens, reasoning, cost: null, costSource: "none", approx };
}

export function addUsage(total: Usage, r: RequestUsage): Usage {
  return {
    requests: total.requests + 1,
    input: total.input + r.input,
    output: total.output + r.output,
    cached: total.cached + r.cached,
    reasoning: total.reasoning + r.reasoning,
    cost: total.cost + (r.cost ?? 0),
    unpriced: total.unpriced + (r.cost === null ? 1 : 0),
    estimated: total.estimated + (r.costSource === "estimate" ? 1 : 0),
    approx: total.approx + (r.approx ? 1 : 0),
    lastInput: r.input,
  };
}

export function mergeUsage(a: Usage, b: Usage): Usage {
  return {
    requests: a.requests + b.requests,
    input: a.input + b.input,
    output: a.output + b.output,
    cached: a.cached + b.cached,
    reasoning: a.reasoning + b.reasoning,
    cost: a.cost + b.cost,
    unpriced: a.unpriced + b.unpriced,
    estimated: a.estimated + b.estimated,
    approx: a.approx + b.approx,
    lastInput: b.requests > 0 ? b.lastInput : a.lastInput,
  };
}

/** Rough token count for providers that don't report usage (~4 chars per token). */
export function approxTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Cost label for a usage total: "—" when nothing is priced, "≥$x" when only part is. */
export function costLabel(u: Usage): string {
  if (u.requests === 0) return "$0";
  if (u.unpriced === u.requests) return "—";
  return `${u.unpriced > 0 ? "≥" : ""}${formatCost(u.cost)}`;
}

export function formatPrice(perMillion: number): string {
  if (perMillion === 0) return "free";
  return `$${perMillion < 1 ? perMillion.toFixed(perMillion < 0.1 ? 3 : 2) : perMillion.toFixed(2)}`;
}
