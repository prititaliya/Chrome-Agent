// One user turn: stream the model, run any tool calls, feed results back,
// and repeat until the model answers without tools.

import { compactHistory, sealToolCalls } from "./context";
import { approxTokens, requestUsage, type RequestUsage, type UsageEvent } from "./usage";
import type { Step } from "../storage/conversations";
import { describeCall, parseArgs, type ToolExecutor } from "../tools/executor";
import type {
  ApiMessage,
  ContentPart,
  ModelConfig,
  ProviderConfig,
  StreamEvent,
  StreamRequest,
  ToolCall,
  ToolSchema,
} from "../providers/types";

export interface TurnCallbacks {
  onText: (delta: string) => void;
  onReasoning: (delta: string) => void;
  /** Called when a step starts and on every update (same id). */
  onStep: (step: Step) => void;
  /** Called once per model request. */
  onUsage?: (usage: RequestUsage) => void;
}

export interface TurnOptions {
  provider: ProviderConfig;
  model: ModelConfig;
  systemPrompt: string;
  history: ApiMessage[];
  userMessage: ApiMessage;
  tools?: ToolSchema[];
  maxSteps: number;
  signal: AbortSignal;
  executor: Pick<ToolExecutor, "execute"> | null;
  callbacks: TurnCallbacks;
  stream: (req: StreamRequest) => AsyncGenerator<StreamEvent>;
  sessionId?: string;
  /** Messages the user sent while the turn was running; each call drains them. */
  takeSteering?: () => string[];
}

export const STEER_PREFIX = "[User update while you were working]: ";
export const STEER_SKIPPED = "Skipped: the user sent a new instruction before this ran.";

export type TurnEnd = "done" | "cancelled" | "max_steps" | "loop" | "error";

export interface TurnResult {
  /** Messages produced by this turn (starting with the user message), safe to append to history. */
  api: ApiMessage[];
  end: TurnEnd;
  error?: string;
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function promptChars(messages: ApiMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") chars += m.content.length;
    else for (const p of m.content) chars += p.type === "text" ? p.text.length : 4000;
    for (const c of m.toolCalls ?? []) chars += c.name.length + c.args.length;
  }
  return chars;
}

export async function runTurn(opts: TurnOptions): Promise<TurnResult> {
  const turn: ApiMessage[] = [opts.userMessage];
  const history = compactHistory(opts.history);
  const finish = (end: TurnEnd, error?: string): TurnResult => ({ api: sealToolCalls(turn), end, error });
  let lastSignature = "";
  let repeats = 0;
  let stepCounter = 0;
  const steering: string[] = [];
  const pollSteering = () => {
    steering.push(...(opts.takeSteering?.() ?? []));
    return steering.length > 0;
  };

  for (let step = 0; step < opts.maxSteps; step++) {
    if (opts.signal.aborted) return finish("cancelled");
    pollSteering();
    for (const update of steering.splice(0)) turn.push({ role: "user", content: `${STEER_PREFIX}${update}` });
    let text = "";
    let reasoningChars = 0;
    const calls: ToolCall[] = [];
    let usage: UsageEvent | null = null;
    const messages: ApiMessage[] = [{ role: "system", content: opts.systemPrompt }, ...history, ...turn];
    const reportUsage = () =>
      opts.callbacks.onUsage?.(
        requestUsage(usage, opts.model.pricing, {
          input: approxTokens(promptChars(messages)),
          output: approxTokens(text.length + reasoningChars + calls.reduce((n, c) => n + c.name.length + c.args.length, 0)),
        }),
      );
    try {
      for await (const event of opts.stream({
        provider: opts.provider,
        model: opts.model,
        messages,
        tools: opts.tools,
        signal: opts.signal,
        sessionId: opts.sessionId,
      })) {
        if (event.type === "text") {
          if (text === "" && step > 0) opts.callbacks.onText("\n\n");
          text += event.text;
          opts.callbacks.onText(event.text);
        } else if (event.type === "reasoning") {
          reasoningChars += event.text.length;
          opts.callbacks.onReasoning(event.text);
        } else if (event.type === "toolCall") {
          calls.push(event.call);
        } else if (event.type === "usage") {
          usage = event;
        }
      }
      reportUsage();
    } catch (error) {
      if (text !== "" || calls.length > 0 || usage) reportUsage();
      if (isAbort(error, opts.signal)) {
        if (text !== "") turn.push({ role: "assistant", content: text });
        return finish("cancelled");
      }
      return finish("error", error instanceof Error ? error.message : String(error));
    }
    if (opts.signal.aborted) {
      if (text !== "") turn.push({ role: "assistant", content: text });
      return finish("cancelled");
    }

    const usable = opts.executor ? calls : [];
    turn.push({ role: "assistant", content: text, ...(usable.length > 0 ? { toolCalls: usable } : {}) });
    if (usable.length === 0) {
      if (pollSteering()) continue;
      if (text.trim() === "") return finish("error", "The model returned an empty response. Try again or pick another model.");
      return finish("done");
    }

    const images: ContentPart[] = [];
    for (const call of usable) {
      if (opts.signal.aborted) return finish("cancelled");
      if (pollSteering()) {
        opts.callbacks.onStep({
          id: `s${++stepCounter}-${call.id}`,
          tool: call.name,
          label: `Skipped: ${describeCall(call.name, parseArgs(call.args) ?? {})}`,
          status: "denied",
          detail: "You sent a new instruction before this ran.",
        });
        turn.push({ role: "tool", toolCallId: call.id, content: STEER_SKIPPED });
        continue;
      }
      const step: Step = {
        id: `s${++stepCounter}-${call.id}`,
        tool: call.name,
        label: describeCall(call.name, parseArgs(call.args) ?? {}),
        status: "running",
      };
      opts.callbacks.onStep({ ...step });
      const outcome = await opts.executor!.execute(call, (label) => {
        step.label = label;
        opts.callbacks.onStep({ ...step });
      });
      step.status = outcome.ok ? "ok" : outcome.text.startsWith("The user declined") ? "denied" : "error";
      step.detail = outcome.text.slice(0, 600);
      if (outcome.image) step.image = outcome.image;
      opts.callbacks.onStep({ ...step });
      turn.push({ role: "tool", toolCallId: call.id, content: outcome.text });
      if (outcome.image) images.push({ type: "image", dataUrl: outcome.image });
    }
    if (images.length > 0) {
      turn.push({ role: "user", content: [{ type: "text", text: "Screenshot from the tool call above:" }, ...images] });
    }

    const signature = usable.map((c) => `${c.name}:${c.args}`).join("|");
    repeats = signature === lastSignature ? repeats + 1 : 0;
    lastSignature = signature;
    if (repeats >= 2) {
      return finish("loop", "Stopped: the model kept repeating the same action. Try rephrasing the request or another model.");
    }
  }
  return finish("max_steps");
}
