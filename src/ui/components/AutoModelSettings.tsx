import { useMemo, useState } from "react";
import { findOpenRouter, guessTier, hasKey, isFree } from "../../agent/router";
import { formatPrice } from "../../agent/usage";
import type { ModelConfig, ModelRef, ModelTier, ProviderConfig } from "../../providers/types";
import { saveSettings, upsertProvider, type Settings } from "../../storage/settings";
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

export default function AutoModelSettings({ providers, settings }: Props) {
  const auto = settings.auto;
  const [filter, setFilter] = useState("");
  const rows = useMemo(
    () => providers.filter(hasKey).flatMap((provider) => provider.models.map((model) => ({ provider, model }))),
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
      <label className="field inline">
        <span>Task classifier</span>
        <select value={auto.classifier} onChange={(e) => saveAuto({ classifier: e.target.value as Settings["auto"]["classifier"] })}>
          <option value="jev">Jev (fast, via OpenRouter, about $0.00002 per message)</option>
          <option value="rules">Built-in rules (offline)</option>
        </select>
      </label>
      {auto.classifier === "jev" && (
        <p className="muted small">
          {findOpenRouter(providers)
            ? "Your question, the page title and URL, and your last two messages are sent to TypeSafe's Jev classifier through OpenRouter (never the page content). If it is slow or fails, the built-in rules decide."
            : "Jev needs an OpenRouter API key. Until you add one, the built-in rules decide."}
        </p>
      )}
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
