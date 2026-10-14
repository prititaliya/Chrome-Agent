// Byte-safe payload parsing for all three stream framings, plus a
// cancellable body pump with an idle watchdog. No provider semantics here:
// JSON parsing and tool accumulation live in the wire adapters.

export type Framing = "sse" | "ndjson" | "json-body";

/** Incremental payload splitter. Feed decoded text, receive complete payloads. */
export class PayloadParser {
  private buffer = "";

  constructor(private readonly framing: Framing) {}

  feed(text: string): string[] {
    this.buffer += text;
    if (this.framing === "json-body") return [];
    if (this.framing === "ndjson") return this.splitLines();
    return this.splitSSE();
  }

  /** Drain whatever is left (EOF without terminator, single JSON body). */
  flush(): string[] {
    if (this.framing === "json-body") {
      const rest = this.buffer.trim();
      this.buffer = "";
      return rest === "" ? [] : [rest];
    }
    if (this.framing === "ndjson") {
      const rest = this.buffer.trim();
      this.buffer = "";
      return rest === "" ? [] : [rest];
    }
    this.buffer += "\n\n";
    return this.splitSSE();
  }

  private splitLines(): string[] {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    const out: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed !== "") out.push(trimmed);
    }
    return out;
  }

  private splitSSE(): string[] {
    const normalized = this.buffer.replace(/\r\n/g, "\n");
    const frames = normalized.split("\n\n");
    this.buffer = frames.pop() ?? "";
    const out: string[] = [];
    for (const frame of frames) {
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith(":")) continue; // heartbeat/comment
        if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).replace(/^ /, ""));
      }
      if (dataLines.length > 0) out.push(dataLines.join("\n"));
    }
    return out;
  }
}

export interface PumpResult {
  aborted: boolean;
}

/**
 * Read a response body to completion, delivering payloads. Resolves quickly
 * on abort or idle timeout (watchdog cancels the reader). Never throws on
 * abort — check `result.aborted` instead.
 */
export async function pumpBody(
  body: ReadableStream<Uint8Array>,
  options: {
    framing: Framing;
    idleTimeoutMs: number;
    signal?: AbortSignal;
    onPayload: (payload: string) => void;
  },
): Promise<PumpResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new PayloadParser(options.framing);
  let aborted = false;

  const cancel = async () => {
    aborted = true;
    try {
      await reader.cancel();
    } catch {
      // Reader already closed: nothing to do.
    }
  };

  const onAbort = () => {
    void cancel();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void cancel();
    }, options.idleTimeoutMs);
  };

  try {
    arm();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (options.signal?.aborted === true) break;
      arm();
      for (const payload of parser.feed(decoder.decode(value, { stream: true }))) {
        options.onPayload(payload);
      }
    }
    for (const payload of parser.flush()) {
      options.onPayload(payload.concat(decoder.decode()));
    }
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    options.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  return { aborted: aborted || options.signal?.aborted === true };
}
