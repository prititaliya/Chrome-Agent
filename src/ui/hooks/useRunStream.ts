import { useCallback, useState } from "react";

// Incremental stream state for one assistant turn. Driven by port events
// from the agent loop (plan Task 18); the hook itself only owns text.

export type StreamStatus = "idle" | "streaming" | "done" | "error";

export interface RunStreamState {
  status: StreamStatus;
  text: string;
  error: string;
}

const INITIAL: RunStreamState = { status: "idle", text: "", error: "" };

export function useRunStream() {
  const [state, setState] = useState<RunStreamState>(INITIAL);

  const pushDelta = useCallback((delta: string) => {
    setState((prev) => ({ status: "streaming", text: prev.text + delta, error: "" }));
  }, []);

  const complete = useCallback(() => {
    setState((prev) => ({ ...prev, status: "done" }));
  }, []);

  const fail = useCallback((error: string) => {
    setState((prev) => ({ ...prev, status: "error", error }));
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL);
  }, []);

  return { state, pushDelta, complete, fail, reset };
}
