import { describe, expect, it, vi } from "vitest";
import { runTurn, type TurnOptions } from "../../src/agent/loop";
import type { ApiMessage, StreamEvent, StreamRequest, ToolCall } from "../../src/providers/types";

type Script = StreamEvent[][];

function scripted(script: Script) {
  const requests: ApiMessage[][] = [];
  const stream = async function* (req: StreamRequest): AsyncGenerator<StreamEvent> {
    requests.push(req.messages);
    const turn = script[requests.length - 1] ?? [{ type: "text", text: "(exhausted)" }];
    for (const event of turn) yield event;
  };
  return { stream, requests };
}

const call = (id: string, name: string, args = "{}"): StreamEvent => ({ type: "toolCall", call: { id, name, args } });

function options(stream: TurnOptions["stream"], patch: Partial<TurnOptions> = {}): TurnOptions {
  return {
    provider: { id: "p", name: "P", baseUrl: "https://x", apiKey: "k", wire: "chat", models: [] },
    model: { id: "m", vision: false, tools: true },
    systemPrompt: "SYS",
    history: [],
    userMessage: { role: "user", content: "question" },
    tools: [],
    maxSteps: 10,
    signal: new AbortController().signal,
    executor: { execute: async (c: ToolCall) => ({ ok: true, text: `result of ${c.name}` }) },
    callbacks: { onText: () => {}, onReasoning: () => {}, onStep: () => {} },
    stream,
    ...patch,
  };
}

describe("agent turn", () => {
  it("answers directly when the model calls no tools", async () => {
    const { stream, requests } = scripted([[{ type: "text", text: "Hello" }, { type: "done", reason: "stop" }]]);
    const onText = vi.fn();
    const result = await runTurn(options(stream, { callbacks: { onText, onReasoning: () => {}, onStep: () => {} } }));
    expect(result.end).toBe("done");
    expect(onText).toHaveBeenCalledWith("Hello");
    expect(requests[0]![0]).toEqual({ role: "system", content: "SYS" });
    expect(result.api).toEqual([
      { role: "user", content: "question" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("runs tools, feeds results back, and keeps going until an answer", async () => {
    const { stream, requests } = scripted([
      [call("c1", "web_search", '{"query":"x"}')],
      [call("c2", "read_url", '{"url":"https://a"}')],
      [{ type: "text", text: "Answer" }],
    ]);
    const steps: string[] = [];
    const result = await runTurn(
      options(stream, { callbacks: { onText: () => {}, onReasoning: () => {}, onStep: (s) => steps.push(`${s.tool}:${s.status}`) } }),
    );
    expect(result.end).toBe("done");
    expect(steps).toEqual(["web_search:running", "web_search:ok", "read_url:running", "read_url:ok"]);
    const last = requests[2]!;
    expect(last.filter((m) => m.role === "tool").map((m) => m.content)).toEqual(["result of web_search", "result of read_url"]);
    expect(result.api.at(-1)).toEqual({ role: "assistant", content: "Answer" });
  });

  it("includes prior history in the request", async () => {
    const { stream, requests } = scripted([[{ type: "text", text: "Sure" }]]);
    await runTurn(
      options(stream, {
        history: [
          { role: "user", content: "earlier question" },
          { role: "assistant", content: "earlier answer" },
        ],
      }),
    );
    expect(requests[0]!.map((m) => m.content)).toEqual(["SYS", "earlier question", "earlier answer", "question"]);
  });

  it("attaches screenshots as an image message after tool results", async () => {
    const { stream, requests } = scripted([[call("s", "screenshot")], [{ type: "text", text: "I see" }]]);
    await runTurn(
      options(stream, { executor: { execute: async () => ({ ok: true, text: "captured", image: "data:image/jpeg;base64,AA" }) } }),
    );
    const sent = requests[1]!;
    expect(sent.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Screenshot from the tool call above:" },
        { type: "image", dataUrl: "data:image/jpeg;base64,AA" },
      ],
    });
  });

  it("stops on abort and seals unanswered tool calls", async () => {
    const abort = new AbortController();
    const { stream } = scripted([[call("a", "click", '{"ref":1}'), call("b", "click", '{"ref":2}')]]);
    const result = await runTurn(
      options(stream, {
        signal: abort.signal,
        executor: {
          execute: async () => {
            abort.abort();
            return { ok: true, text: "clicked" };
          },
        },
      }),
    );
    expect(result.end).toBe("cancelled");
    const tools = result.api.filter((m) => m.role === "tool");
    expect(tools.map((m) => m.toolCallId)).toEqual(["a", "b"]);
  });

  it("stops when the model repeats the same action", async () => {
    const same = [call("x", "snapshot")];
    const { stream } = scripted([same, same, same, same, same]);
    const result = await runTurn(options(stream));
    expect(result.end).toBe("loop");
  });

  it("reports provider errors", async () => {
    const stream = async function* (): AsyncGenerator<StreamEvent> {
      yield* [];
      throw new Error("P rejected the API key (401).");
    };
    const result = await runTurn(options(stream));
    expect(result.end).toBe("error");
    expect(result.error).toContain("401");
  });

  it("respects the step limit", async () => {
    let n = 0;
    const stream = async function* (): AsyncGenerator<StreamEvent> {
      n += 1;
      yield call(`c${n}`, "scroll", `{"direction":"down","n":${n}}`);
    };
    const result = await runTurn(options(stream, { maxSteps: 3 }));
    expect(result.end).toBe("max_steps");
    expect(n).toBe(3);
  });

  it("ignores tool calls for chat-only models", async () => {
    const { stream } = scripted([[{ type: "text", text: "plain" }, call("c", "snapshot")]]);
    const result = await runTurn(options(stream, { executor: null }));
    expect(result.end).toBe("done");
    expect(result.api.at(-1)).toEqual({ role: "assistant", content: "plain" });
  });
});
