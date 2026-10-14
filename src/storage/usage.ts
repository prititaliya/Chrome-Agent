// Append-only ledger of model requests, for the usage dashboard.

import { storage } from "wxt/utils/storage";
import { addUsage, emptyUsage, type RequestUsage, type Usage } from "../agent/usage";

export interface UsageRecord extends RequestUsage {
  ts: number;
  convId: string;
  providerId: string;
  providerName: string;
  modelId: string;
}

const MAX_RECORDS = 20_000;
const ledger = storage.defineItem<UsageRecord[]>("local:usage:v1", { fallback: [] });

export async function recordUsage(records: UsageRecord[]): Promise<void> {
  if (records.length === 0) return;
  const next = [...(await ledger.getValue()), ...records];
  await ledger.setValue(next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next);
}

export async function getUsageRecords(): Promise<UsageRecord[]> {
  return ledger.getValue();
}

export async function clearUsage(): Promise<void> {
  await ledger.setValue([]);
}

export function watchUsage(listener: (records: UsageRecord[]) => void): () => void {
  return ledger.watch((value) => listener(value ?? []));
}

export interface ModelUsage {
  key: string;
  providerName: string;
  modelId: string;
  usage: Usage;
}

export interface DayUsage {
  /** Local date, YYYY-MM-DD. */
  day: string;
  usage: Usage;
}

export interface UsageSummary {
  total: Usage;
  byModel: ModelUsage[];
  byDay: DayUsage[];
  conversations: number;
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Aggregate records at or after `since`; `days` controls how many daily buckets are returned. */
export function summarizeUsage(records: UsageRecord[], since: number, days: number, now = Date.now()): UsageSummary {
  let total = emptyUsage();
  const models = new Map<string, ModelUsage>();
  const byDay = new Map<string, Usage>();
  const convs = new Set<string>();
  for (const r of records) {
    if (r.ts < since) continue;
    total = addUsage(total, r);
    convs.add(r.convId);
    const key = `${r.providerId}\u0000${r.modelId}`;
    const m = models.get(key) ?? { key, providerName: r.providerName, modelId: r.modelId, usage: emptyUsage() };
    m.usage = addUsage(m.usage, r);
    models.set(key, m);
    const day = dayKey(r.ts);
    byDay.set(day, addUsage(byDay.get(day) ?? emptyUsage(), r));
  }
  const dayList: DayUsage[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(now - i * 86_400_000);
    dayList.push({ day, usage: byDay.get(day) ?? emptyUsage() });
  }
  const byModel = [...models.values()].sort((a, b) => b.usage.cost - a.usage.cost || b.usage.input + b.usage.output - (a.usage.input + a.usage.output));
  return { total, byModel, byDay: dayList, conversations: convs.size };
}

export function usageCsv(records: UsageRecord[]): string {
  const head = "time,provider,model,input_tokens,cached_tokens,output_tokens,reasoning_tokens,cost_usd,cost_source,approx_tokens,conversation";
  const rows = records.map((r) =>
    [
      new Date(r.ts).toISOString(),
      JSON.stringify(r.providerName),
      JSON.stringify(r.modelId),
      r.input,
      r.cached,
      r.output,
      r.reasoning,
      r.cost ?? "",
      r.costSource,
      r.approx,
      r.convId,
    ].join(","),
  );
  return [head, ...rows].join("\n");
}
