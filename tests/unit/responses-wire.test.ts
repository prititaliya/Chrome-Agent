import { describe, expect, it } from "vitest";
import { ResponsesConsumer, toInputItems } from "../../src/providers/responses";

describe("responses wire", () => {
  it("maps messages to input items", () => {
    expect(
      toInputItems([
        { role: "system", content: "sys" },
        { role: "user", content: "q" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "snapshot", args: "{}" }] },
        { role: "tool", toolCallId: "c1", content: "r" },
      ]),
    ).toEqual([
      { role: "developer", content: [{ type: "input_text", text: "sys" }] },
      { role: "user", content: [{ type: "input_text", text: "q" }] },
      { type: "function_call", call_id: "c1", name: "snapshot", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "r" },
    ]);
  });

  it("streams text and assembles function calls", () => {
    const c = new ResponsesConsumer();
    const events = [
      { type: "response.output_text.delta", delta: "Hi" },
      { type: "response.output_item.added", item: { type: "function_call", id: "fc1", call_id: "call_1", name: "click" } },
      { type: "response.function_call_arguments.delta", item_id: "fc1", delta: '{"ref":' },
      { type: "response.function_call_arguments.delta", item_id: "fc1", delta: "4}" },
      { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 2 } } },
    ].flatMap((e) => c.consume(JSON.stringify(e)));
    expect(events).toEqual([
      { type: "text", text: "Hi" },
      { type: "usage", inputTokens: 5, outputTokens: 2 },
    ]);
    expect(c.drain()).toEqual([{ id: "call_1", name: "click", args: '{"ref":4}' }]);
  });
});
