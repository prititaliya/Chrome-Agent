import { useEffect, useRef, useState } from "react";
import { openAgentPort, type AgentPort } from "../../../src/messaging/port";
import { addManualModels, setModelWireOverride } from "../../../src/providers/models";
import { resolveProvider } from "../../../src/providers/registry";
import type { ModelDef, Wire } from "../../../src/providers/types";

interface ModelPickerProps {
  providerId: string;
  modelId: string;
  onChange: (modelId: string) => void;
}

// Model discovery over the background port (the key never enters the UI).
// Cache writes from manual paste and wire overrides are key-free storage
// writes, safe to perform directly.
export default function ModelPicker({ providerId, modelId, onChange }: ModelPickerProps) {
  const portRef = useRef<AgentPort | null>(null);
  const [models, setModels] = useState<ModelDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState("");

  useEffect(() => {
    const port = openAgentPort((event) => {
      if (event.type === "models" && event.providerId === providerId) {
        setModels(event.models);
        setLoading(false);
        setError("");
      } else if (event.type === "modelsError" && event.providerId === providerId) {
        setLoading(false);
        setError(event.reason);
      }
    });
    portRef.current = port;
    port.send({ v: 1, type: "listModels", providerId });
    return () => port.disconnect();
  }, [providerId]);

  const selected = models.find((m) => m.id === modelId);

  async function onRefresh() {
    setLoading(true);
    setError("");
    portRef.current?.send({ v: 1, type: "listModels", providerId, force: true });
  }

  async function onAddPasted() {
    const entry = resolveProvider(providerId);
    const updated = await addManualModels(entry.def, paste);
    setPaste("");
    setModels(updated);
  }

  async function onWireChange(wire: Wire) {
    if (!selected) return;
    await setModelWireOverride(providerId, selected.id, wire);
    setModels(models.map((m) => (m.id === selected.id ? { ...m, wire } : m)));
  }

  return (
    <section>
      <h2>Model</h2>
      {loading && <p>Loading models…</p>}
      {error !== "" && <p role="alert">Model list failed: {error}</p>}
      <label>
        Model{" "}
        <select value={modelId} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select a model</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => void onRefresh()}>Refresh list</button>
      {selected && (
        <label>
          Wire{" "}
          <select value={selected.wire} onChange={(e) => void onWireChange(e.target.value as Wire)}>
            <option value="chat.completions">chat.completions</option>
            <option value="responses">responses</option>
          </select>
        </label>
      )}
      <details>
        <summary>Add models manually (gateways without /models)</summary>
        <textarea
          aria-label="Model ids to add"
          rows={3}
          placeholder={"one id per line, or comma-separated"}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
        />
        <button onClick={() => void onAddPasted()} disabled={paste.trim() === ""}>
          Add
        </button>
      </details>
    </section>
  );
}
