import { useEffect, useMemo, useState } from "react";
import { costLabel, formatTokens, type Usage } from "../../agent/usage";
import { clearUsage, getUsageRecords, summarizeUsage, usageCsv, watchUsage, type UsageRecord } from "../../storage/usage";
import { DownloadIcon } from "./Icons";

type Range = "today" | "7d" | "30d" | "all";

const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "all", label: "All time", days: 30 },
];

function startOfDay(daysAgo: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

const tokensOf = (u: Usage) => u.input + u.output;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

interface Props {
  onOpenSettings: () => void;
}

export default function UsageView({ onOpenSettings }: Props) {
  const [records, setRecords] = useState<UsageRecord[] | null>(null);
  const [range, setRange] = useState<Range>("7d");

  useEffect(() => {
    void getUsageRecords().then(setRecords);
    return watchUsage(setRecords);
  }, []);

  const spec = RANGES.find((r) => r.id === range)!;
  const summary = useMemo(
    () => summarizeUsage(records ?? [], range === "all" ? 0 : startOfDay(spec.days - 1), spec.days),
    [records, range, spec.days],
  );

  if (records === null) return <div className="page" />;
  const { total, byModel, byDay } = summary;
  const byCost = total.cost > 0;
  const metric = (u: Usage) => (byCost ? u.cost : tokensOf(u));
  const peak = Math.max(...byDay.map((d) => metric(d.usage)), 0);
  const topModel = Math.max(...byModel.map((m) => metric(m.usage)), 0);

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([usageCsv(records ?? [])], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `comet-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="page usage">
      <div className="segmented" role="tablist" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r.id} role="tab" aria-selected={range === r.id} className={range === r.id ? "seg active" : "seg"} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="stats-grid">
        <Stat label="Spend" value={costLabel(total)} sub={total.estimated > 0 ? "includes estimates" : total.requests > 0 && total.unpriced === 0 ? "as billed" : undefined} />
        <Stat label="Tokens" value={formatTokens(tokensOf(total))} sub={`${formatTokens(total.input)} in · ${formatTokens(total.output)} out`} />
        <Stat label="Requests" value={total.requests.toLocaleString()} sub={`${summary.conversations} chat${summary.conversations === 1 ? "" : "s"}`} />
        <Stat
          label="Cache hits"
          value={total.input > 0 ? `${Math.round((total.cached / total.input) * 100)}%` : "—"}
          sub={total.reasoning > 0 ? `${formatTokens(total.reasoning)} reasoning` : "of input tokens"}
        />
      </div>

      {total.unpriced > 0 && (
        <p className="notice">
          {total.unpriced} request{total.unpriced === 1 ? " has" : "s have"} no price, so spend is a lower bound.{" "}
          <button className="link-btn" onClick={onOpenSettings}>
            Set model prices
          </button>
        </p>
      )}

      {total.requests === 0 ? (
        <p className="muted center pad">No model requests in this period.</p>
      ) : (
        <>
          {spec.days > 1 && (
            <section>
              <h2>{byCost ? "Spend" : "Tokens"} per day</h2>
              <div className="bars" role="img" aria-label={`${byCost ? "Spend" : "Tokens"} per day`}>
                {byDay.map((d) => {
                  const v = metric(d.usage);
                  return (
                    <div key={d.day} className="bar-col" title={`${d.day}: ${costLabel(d.usage)} · ${formatTokens(tokensOf(d.usage))} tokens · ${d.usage.requests} requests`}>
                      <div className="bar" style={{ height: `${peak > 0 ? Math.max(v > 0 ? 3 : 0, (v / peak) * 100) : 0}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="bars-axis">
                <span>{byDay[0]?.day.slice(5)}</span>
                <span>today</span>
              </div>
            </section>
          )}

          <section>
            <h2>By model</h2>
            <ul className="model-usage">
              {byModel.map((m) => (
                <li key={m.key}>
                  <div className="mu-head">
                    <span className="mu-name" title={m.modelId}>
                      {m.modelId.split("/").pop()}
                    </span>
                    <span className="mu-cost">{costLabel(m.usage)}</span>
                  </div>
                  <div className="mu-share">
                    <span style={{ width: `${topModel > 0 ? (metric(m.usage) / topModel) * 100 : 0}%` }} />
                  </div>
                  <div className="mu-meta">
                    <span>{m.providerName}</span>
                    <span>
                      {formatTokens(m.usage.input)} in · {formatTokens(m.usage.output)} out
                      {m.usage.cached > 0 ? ` · ${formatTokens(m.usage.cached)} cached` : ""}
                    </span>
                    <span>{m.usage.requests} req</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <div className="page-actions">
        <button className="btn small" onClick={exportCsv} disabled={records.length === 0}>
          <DownloadIcon size={13} /> Export CSV
        </button>
        <button
          className="btn small ghost"
          disabled={records.length === 0}
          onClick={() => {
            if (confirm("Reset all usage data? Conversations are kept.")) void clearUsage();
          }}
        >
          Reset usage
        </button>
      </div>
    </div>
  );
}
