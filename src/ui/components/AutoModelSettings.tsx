import { useMemo, useState } from "react";
import {
  classifyWithDecisionModel,
  decisionModelName,
  guessTier,
  hasKey,
  isFree,
  resolveDecisionModel,
  type DecisionModelPick,
} from "../../agent/router";
import { formatCost, formatPrice } from "../../agent/usage";
import { isChatModel, looksLikeDecision } from "../../providers/catalog";
import type { ModelConfig, ModelRef, ModelTier, ProviderConfig } from "../../providers/types";
import { catalogIds, type Catalog } from "../../storage/catalogs";
import { saveSettings, upsertProvider, type Settings } from "../../storage/settings";
import { useCatalog } from "../hooks/useCatalog";
import { RefreshIcon } from "./Icons";
import { modelName } from "./ModelPicker";

interface Props {
  providers: ProviderConfig[];
  settings: Settings;
}

const TIERS: { value: ModelTier; label: string }[] = [
  { value: "basic", label: "Basic" },
  { value: "strong", label: "Strong" },
  { value: "best", label: "Best" },
];

function priceLabel(model: ModelConfig): string {
  if (isFree(model)) return "free";
  if (!model.pricing) return "price unknown";
  return `${formatPrice(model.pricing.input)} / ${formatPrice(model.pricing.output)}`;
}

interface DecisionOption {
  ref: ModelRef;
  label: string;
  free: boolean;
  /** Saved on the provider by the user (rather than only detected). */
  saved: boolean;
}

/** Decision models the user saved on a provider, then every one detected on OpenRouter. */
function decisionOptions(providers: ProviderConfig[], catalog: Catalog): DecisionOption[] {
  const out: DecisionOption[] = [];
  const seen = new Set<string>();
  const add = (provider: ProviderConfig, id: string, label: string | undefined, free: boolean, saved: boolean) => {
    const key = `${provider.id}::${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ref: { providerId: provider.id, modelId: id }, label: label ?? id, free, saved });
  };
  const keyed = providers.filter(hasKey);
  for (const provider of keyed) {
    const detected = new Map((catalog[provider.id]?.models ?? []).map((m) => [m.id, m]));
    for (const m of provider.models) {
      if (!looksLikeDecision(m.id)) continue;
      const known = detected.get(m.id);
      add(provider, m.id, known?.label ?? m.label, known?.free ?? isFree(m), true);
    }
  }
  for (const provider of keyed) {
    for (const m of catalog[provider.id]?.models ?? []) add(provider, m.id, m.label, m.free === true, false);
  }
  return out;
}

const refKey = (ref: ModelRef) => `${ref.providerId}::${ref.modelId}`;
const TEST_QUESTION = "Find the cheapest flight from Delhi to Mumbai next Friday and book it.";

function DecisionTest({ pick }: { pick: DecisionModelPick }) {
  const [state, setState] = useState<{ busy: boolean; text: string; ok: boolean } | null>(null);
  const run = async () => {
    setState({ busy: true, text: "Asking…", ok: true });
    const started = performance.now();
    try {
      const r = await classifyWithDecisionModel({ provider: pick.provider, model: pick.modelId, question: TEST_QUESTION, timeoutMs: 15_000 });
      const secs = ((performance.now() - started) / 1000).toFixed(2);
      const what = `${r.need.level}${r.need.tools ? " browser task" : " question"}${r.need.vision ? " with visuals" : ""}`;
      const cost = r.usage.cost !== null ? ` · ${formatCost(r.usage.cost)}` : "";
      setState({ busy: false, text: `${what} · ${Math.round(r.confidence * 100)}% sure · ${secs} s${cost}`, ok: true });
    } catch (error) {
      setState({ busy: false, text: error instanceof Error ? error.message : String(error), ok: false });
    }
  };
  return (
    <div className="decision-test">
      <button className="btn small" onClick={() => void run()} disabled={state?.busy}>
        Test {decisionModelName(pick.modelId)}
      </button>
      {state && (
        <span className={state.ok ? "small" : "small warn"} role="status">
          {state.text}
        </span>
      )}
    </div>
  );
}

export default function AutoModelSettings({ providers, settings }: Props) {
  const auto = settings.auto;
  const [filter, setFilter] = useState("");
  const decisions = useCatalog("decisions", providers);
  const chosen = auto.decisionModel;
  const options = useMemo(() => {
    const list = decisionOptions(providers, decisions.catalog);
    return chosen && !list.some((o) => refKey(o.ref) === refKey(chosen)) ? [{ ref: chosen, label: chosen.modelId, free: false, saved: true }, ...list] : list;
  }, [providers, decisions.catalog, chosen]);
  const pick = resolveDecisionModel(providers, { ...auto, classifier: "decision" }, catalogIds(decisions.catalog));
  const classifierValue = auto.classifier === "rules" ? "rules" : chosen ? refKey(chosen) : "auto";
  const detectedCount = Object.values(decisions.catalog).reduce((n, e) => n + e.models.length, 0);
  const detectError = Object.values(decisions.catalog).find((e) => e.error)?.error;
  const rows = useMemo(
    () => providers.filter(hasKey).flatMap((provider) => provider.models.filter((m) => isChatModel(m.id)).map((model) => ({ provider, model }))),
    [providers],
  );
  const q = filter.trim().toLowerCase();
  const shown = q === "" ? rows : rows.filter((r) => r.model.id.toLowerCase().includes(q) || r.provider.name.toLowerCase().includes(q));
  const isAllowed = (provider: ProviderConfig, model: ModelConfig) =>
    auto.allowed === null || auto.allowed.some((r) => r.providerId === provider.id && r.modelId === model.id);
  const allowedCount = rows.filter((r) => isAllowed(r.provider, r.model)).length;

  const saveAuto = (patch: Partial<Settings["auto"]>) => void saveSettings({ auto: { ...auto, ...patch } });

  const toggle = (provider: ProviderConfig, model: ModelConfig, on: boolean) => {
    const current: ModelRef[] = auto.allowed ?? rows.map((r) => ({ providerId: r.provider.id, modelId: r.model.id }));
    const rest = current.filter((r) => !(r.providerId === provider.id && r.modelId === model.id));
    saveAuto({ allowed: on ? [...rest, { providerId: provider.id, modelId: model.id }] : rest });
  };

  const setTier = (provider: ProviderConfig, model: ModelConfig, tier: ModelTier) =>
    void upsertProvider({ ...provider, models: provider.models.map((m) => (m.id === model.id ? { ...m, tier } : m)) });

  return (
    <section>
      <h2>Auto model</h2>
      <p className="muted">
        Choose <strong>Auto</strong> in the model menu and each message goes to the cheapest allowed model that is good enough for it. If that model fails before answering, the next one is tried.
      </p>
      <label className="check">
        <input type="checkbox" checked={auto.preferFree} onChange={(e) => saveAuto({ preferFree: e.target.checked })} />
        <span>
          <strong>Prefer free models</strong>
          <small className="muted">Use a free model whenever one is good enough for the task.</small>
        </span>
      </label>
      <div className="field-row">
        <label className="field inline grow">
          <span>Task classifier</span>
          <select
            value={classifierValue}
            aria-label="Task classifier"
            onChange={(e) => {
              const value = e.target.value;
              if (value === "rules") return saveAuto({ classifier: "rules" });
              if (value === "auto") return saveAuto({ classifier: "decision", decisionModel: null });
              const option = options.find((o) => refKey(o.ref) === value);
              if (option) saveAuto({ classifier: "decision", decisionModel: option.ref });
            }}
          >
            <option value="auto">Automatic: newest Jev{pick && !chosen ? ` (${decisionModelName(pick.modelId)})` : ""}</option>
            {options.some((o) => o.saved) && (
              <optgroup label="Added by you">
                {options
                  .filter((o) => o.saved)
                  .map((o) => (
                    <option key={refKey(o.ref)} value={refKey(o.ref)}>
                      {o.label}
                      {o.free ? " · free" : ""}
                    </option>
                  ))}
              </optgroup>
            )}
            {options.some((o) => !o.saved) && (
              <optgroup label="Decision models on OpenRouter">
                {options
                  .filter((o) => !o.saved)
                  .map((o) => (
                    <option key={refKey(o.ref)} value={refKey(o.ref)}>
                      {o.label}
                      {o.free ? " · free" : ""}
                    </option>
                  ))}
              </optgroup>
            )}
            <option value="rules">Built-in rules (offline)</option>
          </select>
        </label>
        <button
          className="icon-btn"
          title="Refresh the list of decision models"
          aria-label="Refresh decision models"
          disabled={decisions.refreshing}
          onClick={() => void decisions.refresh()}
        >
          <RefreshIcon size={14} />
        </button>
      </div>
      {auto.classifier === "decision" &&
        (pick ? (
          <>
            <p className="muted small">
              Your question, the page title and URL, and your last two messages are sent to {decisionModelName(pick.modelId)} through{" "}
              {pick.provider.name} (never the page content). If it is slow or fails, the built-in rules decide.
              {detectedCount > 0 && ` ${detectedCount} decision models available.`}
              {detectError && ` Could not refresh the list: ${detectError}`}
            </p>
            <DecisionTest key={refKey({ providerId: pick.provider.id, modelId: pick.modelId })} pick={pick} />
          </>
        ) : (
          <p className="muted small">Decision models need an OpenRouter API key. Until you add one, the built-in rules decide.</p>
        ))}
      <div className="auto-models-head">
        <span className="small muted">
          {allowedCount} of {rows.length} models allowed
        </span>
        <span className="auto-models-actions">
          <button className="link-btn small" onClick={() => saveAuto({ allowed: null })}>
            Allow all
          </button>
          <button className="link-btn small" onClick={() => saveAuto({ allowed: [] })}>
            None
          </button>
        </span>
      </div>
      {rows.length > 8 && (
        <input className="search" type="search" placeholder="Filter models" aria-label="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {rows.length === 0 ? (
        <p className="muted small">Add an API key to a provider above to use Auto.</p>
      ) : (
        <ul className="auto-models">
          {shown.map(({ provider, model }) => (
            <li key={`${provider.id}/${model.id}`} className="auto-model">
              <label className="auto-model-main">
                <input
                  type="checkbox"
                  checked={isAllowed(provider, model)}
                  onChange={(e) => toggle(provider, model, e.target.checked)}
                  aria-label={`Allow ${modelName(model)} in Auto`}
                />
                <span className="auto-model-name" title={model.id}>
                  {modelName(model)}
                  <small className="muted">
                    {provider.name} · {priceLabel(model)}
                    {!model.tools && " · chat only"}
                  </small>
                </span>
              </label>
              <select
                value={guessTier(model)}
                onChange={(e) => setTier(provider, model, e.target.value as ModelTier)}
                aria-label={`Tier for ${modelName(model)}`}
                title={model.tier ? "Set by you" : "Guessed from price and name"}
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
