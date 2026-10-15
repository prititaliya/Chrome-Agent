import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { shortSttLabel, transcribe, type SttChoice } from "../../providers/stt";
import { recordUsage } from "../../storage/usage";

export type VoicePhase = "idle" | "starting" | "recording" | "transcribing";

/** Longest recording; most STT endpoints cap uploads around 25 MB. */
const MAX_RECORDING_MS = 5 * 60 * 1000;
const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

// Web Speech API (not in TypeScript's DOM lib).
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

interface Options {
  choice: SttChoice | null;
  language: string;
  convId: string;
  /** Live transcript so far (Chrome built-in only). */
  onPartial: (text: string) => void;
  /** Final transcript; "" when nothing was heard. Not called after cancel. */
  onFinal: (text: string) => void;
  onNotice: (message: string) => void;
}

export interface VoiceInput {
  phase: VoicePhase;
  /** Live microphone signal for the waveform, while recording. */
  analyser: AnalyserNode | null;
  startedAt: number;
  /** Short name of the model in use. */
  label: string;
  start: () => Promise<void>;
  /** Finish recording and transcribe. */
  stop: () => void;
  /** Discard the recording (or the transcription in flight). */
  cancel: () => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The side panel can't show Chrome's permission prompt, so ask from a regular extension tab. */
function askMicInTab(): void {
  void browser.tabs.create({ url: new URL("/mic.html", location.origin).href });
}

async function micPermission(): Promise<PermissionStatus | null> {
  try {
    return await navigator.permissions.query({ name: "microphone" as PermissionName });
  } catch {
    return null;
  }
}

/** An unanswerable prompt would leave getUserMedia pending forever. */
const MIC_TIMEOUT_MS = 8000;

function openMic(): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException("Microphone prompt timed out", "NotAllowedError")), MIC_TIMEOUT_MS);
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(
      (stream) => {
        clearTimeout(timer);
        resolve(stream);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function useVoiceInput(options: Options): VoiceInput {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [label, setLabel] = useState("");
  const opts = useRef(options);
  opts.current = options;
  const phaseRef = useRef<VoicePhase>("idle");
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const abort = useRef<AbortController | null>(null);
  const cancelled = useRef(false);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const releaseMic = useCallback(() => {
    if (maxTimer.current) clearTimeout(maxTimer.current);
    maxTimer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    setAnalyser(null);
  }, []);

  const needPermission = useCallback(async () => {
    askMicInTab();
    opts.current.onNotice("Allow microphone access in the tab that just opened, then tap the mic again.");
    const status = await micPermission();
    if (!status) return;
    status.onchange = () => {
      if (status.state !== "granted") return;
      status.onchange = null;
      opts.current.onNotice("Microphone allowed. Tap the mic to dictate.");
    };
  }, []);

  const micFailed = useCallback((error: unknown) => {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      opts.current.onNotice("No microphone found.");
    } else if (name === "NotAllowedError" || name === "SecurityError" || error === "not-allowed") {
      void needPermission();
    } else {
      opts.current.onNotice(`Could not start the microphone: ${errorText(error)}`);
    }
  }, [needPermission]);

  const finishRecording = useCallback(
    async (audio: Blob, choice: Extract<SttChoice, { kind: "api" }>) => {
      releaseMic();
      recorder.current = null;
      if (cancelled.current) return go("idle");
      if (audio.size < 800) {
        opts.current.onNotice("Didn't catch anything. Hold on a moment longer next time.");
        return go("idle");
      }
      go("transcribing");
      const controller = new AbortController();
      abort.current = controller;
      try {
        const { provider, modelId } = choice;
        const result = await transcribe({ provider, modelId, audio, language: opts.current.language || undefined, signal: controller.signal });
        void recordUsage([
          {
            ts: Date.now(),
            convId: opts.current.convId,
            providerId: provider.id,
            providerName: provider.name,
            modelId,
            input: result.inputTokens ?? 0,
            output: result.outputTokens ?? 0,
            cached: 0,
            reasoning: 0,
            cost: result.cost ?? null,
            costSource: result.cost !== undefined ? "provider" : "none",
            approx: false,
          },
        ]);
        if (controller.signal.aborted) return;
        if (result.text === "") opts.current.onNotice("No speech detected.");
        opts.current.onFinal(result.text);
      } catch (error) {
        if (!controller.signal.aborted) opts.current.onNotice(`Transcription failed. ${errorText(error)}`);
      } finally {
        abort.current = null;
        go("idle");
      }
    },
    [go, releaseMic],
  );

  const startRecorder = useCallback(
    (mic: MediaStream, choice: Extract<SttChoice, { kind: "api" }>) => {
      const mimeType = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(mic, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => void finishRecording(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }), choice);
      rec.start(1000);
      recorder.current = rec;
    },
    [finishRecording],
  );

  const startRecognition = useCallback(() => {
    const g = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = g.SpeechRecognition ?? g.webkitSpeechRecognition;
    if (!Ctor) throw new Error("This browser has no built-in speech recognition.");
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = opts.current.language || navigator.language;
    let final = "";
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) final += result[0]?.transcript ?? "";
        else interim += result[0]?.transcript ?? "";
      }
      opts.current.onPartial(`${final}${interim}`.trim());
    };
    rec.onerror = (event) => {
      if (event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") micFailed("not-allowed");
      else if (event.error === "no-speech") opts.current.onNotice("No speech detected.");
      else if (event.error === "network") opts.current.onNotice("Chrome's speech service is unreachable. Pick an API model in Settings → Voice input.");
      else opts.current.onNotice(`Speech recognition stopped: ${event.error}`);
    };
    rec.onend = () => {
      recognition.current = null;
      releaseMic();
      if (!cancelled.current) opts.current.onFinal(final.trim());
      go("idle");
    };
    rec.start();
    recognition.current = rec;
  }, [go, micFailed, releaseMic]);

  const stop = useCallback(() => {
    if (phaseRef.current !== "recording") return;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recognition.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recognition.current?.abort();
    abort.current?.abort();
    if (phaseRef.current === "starting") releaseMic();
  }, [releaseMic]);

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    const choice = opts.current.choice;
    if (!choice) {
      opts.current.onNotice("No speech-to-text model available. Add an OpenRouter key, or pick one in Settings → Voice input.");
      return;
    }
    cancelled.current = false;
    setLabel(shortSttLabel(choice.label));
    go("starting");
    const permission = await micPermission();
    if (permission && permission.state !== "granted") {
      go("idle");
      void needPermission();
      return;
    }
    let mic: MediaStream;
    try {
      mic = await openMic();
    } catch (error) {
      go("idle");
      micFailed(error);
      return;
    }
    if (cancelled.current) {
      mic.getTracks().forEach((t) => t.stop());
      go("idle");
      return;
    }
    stream.current = mic;
    try {
      const ctx = new AudioContext();
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      node.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(mic).connect(node);
      audioCtx.current = ctx;
      setAnalyser(node);
    } catch {
      // The waveform is decoration; recording works without it.
    }
    try {
      if (choice.kind === "browser") startRecognition();
      else startRecorder(mic, choice);
    } catch (error) {
      releaseMic();
      go("idle");
      opts.current.onNotice(`Could not start voice input: ${errorText(error)}`);
      return;
    }
    maxTimer.current = setTimeout(stop, MAX_RECORDING_MS);
    setStartedAt(Date.now());
    go("recording");
  }, [go, micFailed, needPermission, releaseMic, startRecognition, startRecorder, stop]);

  useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      recognition.current?.abort();
      abort.current?.abort();
      stream.current?.getTracks().forEach((t) => t.stop());
      void audioCtx.current?.close().catch(() => undefined);
    },
    [],
  );

  return { phase, analyser, startedAt, label, start, stop, cancel };
}
