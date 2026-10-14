import { useMemo, useState } from "react";
import { fetchModels, testConnection } from "../../providers";
import { guessModel, openCodeGoPreset, openRouterPreset } from "../../providers/presets";
import { formatPrice, formatTokens } from "../../agent/usage";
import type { ModelConfig, ModelPricing, ProviderConfig, Wire } from "../../providers/types";
import { newId } from "../../storage/conversations";
import { ChevronIcon, CloseIcon } from "./Icons";

type PresetId = "openrouter" | "opencode-go" | "custom";

export function blankProvider(preset: PresetId): ProviderConfig {
  if (preset === "openrouter") return { ...openRouterPreset(), id: `openrouter-${newId()}` };
  if (preset === "opencode-go") return { ...openCodeGoPreset(), id: `opencode-go-${newId()}` };
  return { id: `custom-${newId()}`, name: "", baseUrl: "https://", apiKey: "", wire: "chat", models: [], preset: "custom" };
}

function parseNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function priceSummary(m: ModelConfig): string {
  const parts: string[] = [];
  parts.push(m.pricing ? `${formatPrice(m.pricing.input)} / ${formatPrice(m.pricing.output)}` : "no price");
  if (m.contextWindow) parts.push(`${formatTokens(m.contextWindow)} ctx`);
  return parts.join(" · ");
}

function ModelRow({ model, onPatch, onRemove }: { model: ModelConfig; onPatch: (patch: Partial<ModelConfig>) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const setPrice = (key: keyof ModelPricing, text: string) => {
    const value = parseNumber(text);
    const next: Partial<ModelPricing> = { ...model.pricing, [key]: value };
    if (next.input === undefined && next.output === undefined) {
      onPatch({ pricing: undefined });
      return;
    }
    onPatch({
      pricing: { input: next.input ?? 0, output: next.output ?? 0, ...(next.cachedInput !== undefined ? { cachedInput: next.cachedInput } : {}) },
    });
  };
  return (
    <li className={open ? "model-row open" : "model-row"}>
      <div className="model-row-main">
        <button className="model-row-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title="Capabilities and prices">
          <span className={open ? "chev open" : "chev"}>
            <ChevronIcon size={12} />
          </span>
          <span className="model-id" title={model.id}>
            {model.id}
          </span>
          <span className="model-row-meta">{priceSummary(model)}</span>
        </button>
        <button className="icon-btn tiny" aria-label={`Remove ${model.id}`} onClick={onRemove}>
          <CloseIcon size={12} />
        </button>
      </div>
      {open && (
        <div className="model-row-edit">
          <div className="checks">
            <label title="Accepts images (screenshots)">
              <input type="checkbox" checked={model.vision} onChange={(e) => onPatch({ vision: e.target.checked })} /> Vision
            </label>
            <label title="Supports tool calling (needed for browser control)">
              <input type="checkbox" checked={model.tools} onChange={(e) => onPatch({ tools: e.target.checked })} /> Tools / agent
            </label>
          </div>
          <div className="price-grid">
            <label>
              <span>Input $ / 1M</span>
              <input inputMode="decimal" value={model.pricing?.input ?? ""} placeholder="—" onChange={(e) => setPrice("input", e.target.value)} />
            </label>
            <label>
              <span>Output $ / 1M</span>
              <input inputMode="decimal" value={model.pricing?.output ?? ""} placeholder="—" onChange={(e) => setPrice("output", e.target.value)} />
            </label>
            <label>
              <span>Cached input $ / 1M</span>
              <input
                inputMode="decimal"
                value={model.pricing?.cachedInput ?? ""}
                placeholder="same as input"
                onChange={(e) => setPrice("cachedInput", e.target.value)}
                disabled={!model.pricing}
              />
            </label>
            <label>
              <span>Context window</span>
              <input
                inputMode="numeric"
                value={model.contextWindow ?? ""}
                placeholder="tokens"
                onChange={(e) => onPatch({ contextWindow: parseNumber(e.target.value) })}
              />
            </label>
          </div>
        </div>
      )}
    </li>
  );
}

interface Props {
  initial: ProviderConfig;
  isNew: boolean;
  onSave: (provider: ProviderConfig) => void;
  onCancel: () => void;
}

export default function ProviderEditor({ initial, isNew, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<ProviderConfig>(initial);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [manual, setManual] = useState("");
  const [remote, setRemote] = useState<ModelConfig[] | null>(null);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "busy"; text: string } | null>(null);
  const [testModel, setTestModel] = useState(initial.models[0]?.id ?? "");

  const effective = (): ProviderConfig => ({
    ...draft,
    name: draft.name.trim() || "Custom provider",
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
    apiKey: keyDraft.trim() !== "" ? keyDraft.trim() : draft.apiKey,
  });

  const update = (patch: Partial<ProviderConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const setModels = (models: ModelConfig[]) => update({ models });
  const patchModel = (id: string, patch: Partial<ModelConfig>) =>
    setModels(draft.models.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  function addIds(text: string) {
    const ids = text.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s !== "");
    const known = new Set(draft.models.map((m) => m.id));
    setModels([...draft.models, ...ids.filter((id) => !known.has(id)).map(guessModel)]);
    if (!testModel && ids[0]) setTestModel(ids[0]);
  }

  async function onFetch() {
    setStatus({ kind: "busy", text: "Fetching models…" });
    try {
      const models = await fetchModels(effective());
      setRemote(models);
      const byId = new Map(models.map((m) => [m.id, m]));
      const refreshed = draft.models.filter((m) => byId.get(m.id)?.pricing || byId.get(m.id)?.contextWindow).length;
      setDraft((d) => ({
        ...d,
        models: d.models.map((m) => {
          const r = byId.get(m.id);
          return r ? { ...m, pricing: r.pricing ?? m.pricing, contextWindow: r.contextWindow ?? m.contextWindow } : m;
        }),
      }));
      setStatus({
        kind: "ok",
        text: `Found ${models.length} models.${refreshed > 0 ? ` Updated prices/limits for ${refreshed} of yours.` : ""} Add more below.`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function onTest() {
    const provider = effective();
    const model = provider.models.find((m) => m.id === testModel) ?? provider.models[0];
    if (!model) {
      setStatus({ kind: "error", text: "Add at least one model first." });
      return;
    }
    setStatus({ kind: "busy", text: `Testing ${model.id}…` });
    try {
      setStatus({ kind: "ok", text: await testConnection(provider, model) });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  const shownRemote = useMemo(() => {
    if (!remote) return [];
    const q = filter.toLowerCase();
    const known = new Set(draft.models.map((m) => m.id));
    return remote.filter((m) => !known.has(m.id) && (q === "" || m.id.toLowerCase().includes(q))).slice(0, 60);
  }, [remote, filter, draft.models]);

  const urlValid = /^https?:\/\/[^/\s]+/.test(draft.baseUrl.trim());
  return (
    <div className="editor">
      <h2>{isNew ? "Add provider" : `Edit ${initial.name}`}</h2>
      <label className="field">
        <span>Name</span>
        <input value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="My provider" />
      </label>
      <label className="field">
        <span>Base URL</span>
        <input
          value={draft.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
          spellCheck={false}
        />
        <small className="muted">OpenAI-compatible endpoint; requests go to {"{base}"}/chat/completions.</small>
      </label>
      <label className="field">
        <span>API key</span>
        <div className="row">
          <input
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder={draft.apiKey ? `Saved (…${draft.apiKey.slice(-4)}). Paste to replace` : "Paste your API key"}
          />
          <button type="button" className="btn small" onClick={() => setShowKey(!showKey)}>
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        <small className="muted">Stored only in this browser (chrome.storage.local).</small>
      </label>
      <label className="field">
        <span>API format</span>
        <select value={draft.wire} onChange={(e) => update({ wire: e.target.value as Wire })}>
          <option value="chat">Chat Completions (most providers)</option>
          <option value="responses">Responses API</option>
        </select>
      </label>

      <div className="field">
        <span>Models ({draft.models.length})</span>
        {draft.models.length === 0 && <p className="muted">No models yet. Fetch them or add ids manually.</p>}
        <small className="muted">Open a model to set its prices (USD per 1M tokens) for cost tracking. Fetching models fills them in when the provider publishes them.</small>
        <ul className="model-list">
          {draft.models.map((m) => (
            <ModelRow
              key={m.id}
              model={m}
              onPatch={(patch) => patchModel(m.id, patch)}
              onRemove={() => setModels(draft.models.filter((x) => x.id !== m.id))}
            />
          ))}
        </ul>
        <div className="row">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Add model id(s), e.g. openai/gpt-5.6-luna"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addIds(manual);
                setManual("");
              }
            }}
          />
          <button
            className="btn small"
            disabled={manual.trim() === ""}
            onClick={() => {
              addIds(manual);
              setManual("");
            }}
          >
            Add
          </button>
        </div>
        <button className="btn small" onClick={() => void onFetch()} disabled={!urlValid}>
          Fetch models & prices
        </button>
        {remote && (
          <div className="remote">
            <input placeholder="Filter fetched models" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <ul className="remote-list">
              {shownRemote.map((m) => (
                <li key={m.id}>
                  <span className="model-id" title={m.id}>
                    {m.id}
                  </span>
                  <span className="model-row-meta">
                    {priceSummary(m)}
                    {m.vision ? " · vision" : ""}
                    {m.tools ? "" : " · no tools"}
                  </span>
                  <button className="btn small" onClick={() => setModels([...draft.models, m])}>
                    + Add
                  </button>
                </li>
              ))}
              {shownRemote.length === 0 && <li className="muted">Nothing to add.</li>}
            </ul>
          </div>
        )}
      </div>

      <div className="field">
        <span>Test connection</span>
        <div className="row">
          <select value={testModel} onChange={(e) => setTestModel(e.target.value)} disabled={draft.models.length === 0}>
            {draft.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => void onTest()} disabled={!urlValid || draft.models.length === 0}>
            Test
          </button>
        </div>
      </div>
      {status && (
        <p className={`status status-${status.kind}`} role="status">
          {status.kind === "busy" && <span className="spinner" />} {status.text}
        </p>
      )}

      <div className="editor-actions">
        <button className="btn primary" onClick={() => onSave(effective())} disabled={!urlValid}>
          Save
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
