import { costLabel, formatCost, type Usage } from "../../agent/usage";

const n = (value: number) => value.toLocaleString();

interface Props {
  usage: Usage;
  providerName?: string;
  durationMs?: number;
}

/** Itemized tokens and cost for one answer or a whole chat. */
export default function UsageBreakdown({ usage, providerName, durationMs }: Props) {
  const priced = usage.requests - usage.unpriced;
  const source =
    usage.unpriced === usage.requests
      ? `No price set for this model. Add input/output prices in Settings${providerName ? ` → ${providerName}` : ""} to track cost.`
      : usage.estimated > 0
        ? "Estimated from the model prices in Settings."
        : `Billed amount reported by ${providerName ?? "the provider"}.`;
  return (
    <div className="breakdown">
      <dl>
        <dt>Input</dt>
        <dd>
          {n(usage.input)}
          {usage.cached > 0 && <span className="muted"> ({n(usage.cached)} cached)</span>}
        </dd>
        <dt>Output</dt>
        <dd>
          {n(usage.output)}
          {usage.reasoning > 0 && <span className="muted"> ({n(usage.reasoning)} reasoning)</span>}
        </dd>
        <dt>Total tokens</dt>
        <dd>{n(usage.input + usage.output)}</dd>
        <dt>Model requests</dt>
        <dd>{usage.requests}</dd>
        {durationMs !== undefined && (
          <>
            <dt>Time</dt>
            <dd>{(durationMs / 1000).toFixed(1)} s</dd>
          </>
        )}
        <dt>Cost</dt>
        <dd className="strong">
          {costLabel(usage)}
          {priced > 0 && usage.requests > 1 && <span className="muted"> · {formatCost(usage.cost / priced)}/request</span>}
        </dd>
      </dl>
      <p className="breakdown-note">{source}</p>
      {usage.approx > 0 && <p className="breakdown-note">Token counts are approximate: the provider didn't report usage.</p>}
    </div>
  );
}
