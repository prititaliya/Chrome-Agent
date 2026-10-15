import { BROWSER_STT, BROWSER_STT_LABEL, shortSttLabel } from "../../providers/stt";
import type { ProviderConfig } from "../../providers/types";
import { saveSettings, type Settings } from "../../storage/settings";
import { browserSttSupported, useStt } from "../hooks/useCatalog";
import { RefreshIcon } from "./Icons";

interface Props {
  providers: ProviderConfig[];
  settings: Settings;
}

const LANGUAGES: { code: string; label: string }[] = [
  { code: "", label: "Detect automatically" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
];

const refKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;

export default function VoiceInputSettings({ providers, settings }: Props) {
  const voice = settings.voice;
  const stt = useStt(providers, voice);
  const saveVoice = (patch: Partial<Settings["voice"]>) => void saveSettings({ voice: { ...voice, ...patch } });
  const browserOk = browserSttSupported();
  const byProvider = new Map<string, typeof stt.options>();
  for (const option of stt.options) byProvider.set(option.providerName, [...(byProvider.get(option.providerName) ?? []), option]);
  const value = voice.model ? refKey(voice.model.providerId, voice.model.modelId) : "auto";
  const pickedMissing = voice.model && voice.model.providerId !== BROWSER_STT.providerId && !stt.options.some((o) => refKey(o.ref.providerId, o.ref.modelId) === value);
  const errors = Object.entries(stt.catalog)
    .filter(([, entry]) => entry.error)
    .map(([id, entry]) => `${providers.find((p) => p.id === id)?.name ?? id}: ${entry.error}`);

  return (
    <section>
      <h2>Voice input</h2>
      <p className="muted">
        Tap the mic in the message box to dictate. Models are detected from your providers: every speech-to-text model on OpenRouter, and Whisper-style models on other OpenAI-compatible providers.
      </p>
      <div className="field-row">
        <label className="field inline grow">
          <span>Speech-to-text model</span>
          <select
            value={value}
            aria-label="Speech-to-text model"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "auto") return saveVoice({ model: null });
              const [providerId, ...rest] = v.split("::");
              saveVoice({ model: { providerId: providerId!, modelId: rest.join("::") } });
            }}
          >
            <option value="auto">Automatic{stt.choice && !voice.model ? ` (${shortSttLabel(stt.choice.label)})` : ""}</option>
            {pickedMissing && voice.model && <option value={value}>{voice.model.modelId}</option>}
            {[...byProvider].map(([providerName, options]) => (
              <optgroup key={providerName} label={providerName}>
                {options.map((o) => (
                  <option key={refKey(o.ref.providerId, o.ref.modelId)} value={refKey(o.ref.providerId, o.ref.modelId)}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {browserOk && <option value={refKey(BROWSER_STT.providerId, BROWSER_STT.modelId)}>{BROWSER_STT_LABEL}</option>}
          </select>
        </label>
        <button className="icon-btn" title="Refresh the list of speech-to-text models" aria-label="Refresh speech-to-text models" disabled={stt.refreshing} onClick={() => void stt.refresh()}>
          <RefreshIcon size={14} />
        </button>
      </div>
      <p className="muted small">
        {stt.options.length > 0
          ? `${stt.options.length} speech-to-text models found. `
          : "No speech-to-text models found yet. Add an OpenRouter key for Whisper, GPT-4o Transcribe, Scribe, Chirp and more. "}
        {stt.choice?.kind === "browser"
          ? "Chrome's built-in recognition is free; Chrome sends the audio to Google's speech service."
          : stt.choice
            ? `Audio is sent to ${stt.choice.kind === "api" ? stt.choice.provider.name : "the provider"} only while you dictate.`
            : ""}
        {errors.length > 0 && ` Could not check ${errors.join("; ")}`}
      </p>
      <label className="field inline">
        <span>Language</span>
        <select value={voice.language} onChange={(e) => saveVoice({ language: e.target.value })} aria-label="Dictation language">
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={voice.autoSend} onChange={(e) => saveVoice({ autoSend: e.target.checked })} />
        <span>
          <strong>Send as soon as it's transcribed</strong>
          <small className="muted">Otherwise the text lands in the message box so you can edit it first.</small>
        </span>
      </label>
    </section>
  );
}
