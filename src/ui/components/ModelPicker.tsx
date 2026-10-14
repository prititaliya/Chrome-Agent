import { useEffect, useMemo, useRef, useState } from "react";
import { formatPrice, formatTokens } from "../../agent/usage";
import type { ModelConfig, ModelRef, ProviderConfig } from "../../providers/types";
import { CheckIcon, ChevronIcon, SearchIcon } from "./Icons";

interface Props {
  providers: ProviderConfig[];
  value: ModelRef | null;
  onChange: (ref: ModelRef) => void;
  onManage: () => void;
  disabled?: boolean;
}

/** Short display name: drop the vendor prefix of ids like "openai/gpt-5.6-luna". */
export function modelName(model: ModelConfig): string {
  return model.label ?? model.id.split("/").pop() ?? model.id;
}

function ModelMeta({ model }: { model: ModelConfig }) {
  return (
    <span className="mp-meta">
      {model.pricing && (
        <span title="USD per 1M input / output tokens">
          {formatPrice(model.pricing.input)} / {formatPrice(model.pricing.output)}
        </span>
      )}
      {model.contextWindow && <span title="Context window">{formatTokens(model.contextWindow)} ctx</span>}
      {model.vision && <span className="tag">vision</span>}
      {model.tools ? <span className="tag">agent</span> : <span className="tag tag-dim">chat only</span>}
    </span>
  );
}

export default function ModelPicker({ providers, value, onChange, onManage, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const provider = providers.find((p) => p.id === value?.providerId);
  const current = provider?.models.find((m) => m.id === value?.modelId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers
      .filter((p) => p.models.length > 0)
      .map((p) => ({
        provider: p,
        models: p.models.filter((m) => q === "" || m.id.toLowerCase().includes(q) || (m.label ?? "").toLowerCase().includes(q) || p.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.models.length > 0)
      .sort((a, b) => Number(Boolean(b.provider.apiKey)) - Number(Boolean(a.provider.apiKey)));
  }, [providers, query]);

  return (
    <div className="mp" ref={rootRef}>
      <button
        className="mp-trigger"
        onClick={() => {
          setOpen(!open);
          setQuery("");
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Model"
        title={current ? `${provider?.name} · ${current.id}` : "Choose a model"}
      >
        <span className="mp-current">
          <span className="mp-name">{current ? modelName(current) : "Choose a model"}</span>
          {provider && current && <span className="mp-provider">{provider.name}</span>}
        </span>
        <ChevronIcon size={13} />
      </button>
      {open && (
        <div className="mp-pop">
          <label className="mp-search">
            <SearchIcon size={13} />
            <input autoFocus placeholder="Search models" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search models" />
          </label>
          <div className="mp-list" role="listbox" aria-label="Models">
            {groups.length === 0 && <p className="mp-empty">No models match.</p>}
            {groups.map(({ provider: p, models }) => (
              <div key={p.id} className="mp-group">
                <div className="mp-group-head">
                  <span>{p.name}</span>
                  {!p.apiKey && <span className="tag tag-warn">no key</span>}
                </div>
                {models.map((m) => {
                  const selected = p.id === value?.providerId && m.id === value?.modelId;
                  return (
                    <button
                      key={m.id}
                      role="option"
                      aria-selected={selected}
                      className={selected ? "mp-item selected" : "mp-item"}
                      onClick={() => {
                        onChange({ providerId: p.id, modelId: m.id });
                        setOpen(false);
                      }}
                    >
                      <span className="mp-item-main">
                        <span className="mp-item-name" title={m.id}>
                          {modelName(m)}
                        </span>
                        <ModelMeta model={m} />
                      </span>
                      {selected && <CheckIcon size={14} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <button
            className="mp-manage"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            Manage providers & prices…
          </button>
        </div>
      )}
    </div>
  );
}
