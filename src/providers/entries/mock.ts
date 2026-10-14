// Scripted provider for deterministic tests and offline dev.
// A script is an array of turns; each turn is assistant text plus optional
// tool calls. `mock.mjs` streams a script as chat-completions SSE.
// (Zod validation of scripts lands with the provider registry, Task 8.)

export interface MockToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface MockTurn {
  text: string;
  toolCalls?: MockToolCall[];
}

export interface MockScript {
  turns: MockTurn[];
}

export const MOCK_PROVIDER_ID = "mock";

export function mockModels(): { id: string; label: string }[] {
  return [{ id: "mock-agent", label: "Mock agent (scripted)" }];
}

/** Render one turn as OpenAI chat-completions SSE chunks (text + tool calls). */
export function turnToSSE(turn: MockTurn): string {
  const chunks: string[] = [];
  if (turn.text !== "") {
    chunks.push(
      `data: ${JSON.stringify({ choices: [{ delta: { content: turn.text }, finish_reason: null }] })}\n\n`,
    );
  }
  for (const [index, call] of (turn.toolCalls ?? []).entries()) {
    chunks.push(
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index,
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: JSON.stringify(call.args) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
  }
  const finish = (turn.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "stop";
  chunks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`);
  chunks.push("data: [DONE]\n\n");
  return chunks.join("");
}
