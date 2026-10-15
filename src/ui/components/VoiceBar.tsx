import { useEffect, useRef, useState } from "react";
import type { VoiceInput } from "../hooks/useVoiceInput";
import { CheckIcon, CloseIcon } from "./Icons";

const BARS = 36;

/** Mirrored frequency bars drawn from the live microphone signal. */
function Waveform({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const color = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#0b7d88";
    const data = new Uint8Array(analyser?.frequencyBinCount ?? 0);
    const levels = new Float32Array(BARS);
    let frame = 0;
    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (analyser) analyser.getByteFrequencyData(data);
      // Speech energy sits in the lower bins; spread those across the bars.
      const usable = Math.max(1, Math.floor(data.length * 0.45));
      const gap = 2;
      const barW = Math.max(1.5, (w - gap * (BARS - 1)) / BARS);
      ctx.fillStyle = color;
      for (let i = 0; i < BARS; i++) {
        const mirrored = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
        const bin = Math.floor(mirrored * (usable - 1));
        const raw = analyser ? (data[bin] ?? 0) / 255 : 0;
        const idle = 0.08 + 0.05 * Math.sin(t / 380 + i * 0.5);
        const target = Math.max(idle, raw * (1 - mirrored * 0.35));
        levels[i] = levels[i]! + (target - levels[i]!) * 0.35;
        const barH = Math.max(2, levels[i]! * h);
        ctx.globalAlpha = 0.45 + levels[i]! * 0.55;
        const x = i * (barW + gap);
        const y = (h - barH) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  return <canvas ref={canvasRef} className="voice-wave" aria-hidden="true" />;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="voice-time">
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}

export default function VoiceBar({ voice }: { voice: VoiceInput }) {
  if (voice.phase === "idle") return null;
  const transcribing = voice.phase === "transcribing";
  return (
    <div className={transcribing ? "voice-bar transcribing" : "voice-bar"} role="status" aria-live="polite">
      <span className="voice-dot" aria-hidden="true" />
      {transcribing ? (
        <span className="voice-shimmer">Transcribing with {voice.label}…</span>
      ) : (
        <>
          <Waveform analyser={voice.analyser} />
          {voice.phase === "recording" && <Elapsed since={voice.startedAt} />}
        </>
      )}
      <span className="voice-model" title="Speech-to-text model (change in Settings → Voice input)">
        {transcribing ? "" : voice.label}
      </span>
      <button className="chip-x" onClick={voice.cancel} aria-label="Cancel voice input" title="Cancel (Esc)">
        <CloseIcon size={12} />
      </button>
      {voice.phase === "recording" && (
        <button className="voice-done" onClick={voice.stop} aria-label="Finish voice input" title="Done (Enter)">
          <CheckIcon size={13} />
        </button>
      )}
    </div>
  );
}
