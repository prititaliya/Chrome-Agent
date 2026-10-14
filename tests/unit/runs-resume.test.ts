import { describe, expect, it } from "vitest";
import { createMemoryRunStore, resumeRuns, type RunCheckpoint } from "../../src/storage/runs";

function checkpoint(runId: string, status: RunCheckpoint["status"]): RunCheckpoint {
  return { runId, threadId: `t-${runId}`, task: "task", status, lastPhase: "idle", updatedAt: 1 };
}

describe("resumeRuns cold-boot", () => {
  it("re-enters only non-terminal runs via a fresh store instance", async () => {
    const store = createMemoryRunStore([
      checkpoint("running-1", "running"),
      checkpoint("gated-1", "awaiting_gate"),
      checkpoint("done-1", "done"),
      checkpoint("failed-1", "failed"),
      checkpoint("cancelled-1", "cancelled"),
    ]);
    const resumed: string[] = [];
    const resumedIds = await resumeRuns(store, async (cp) => {
      resumed.push(cp.runId);
    });
    expect(resumed.sort()).toEqual(["gated-1", "running-1"]);
    expect(resumedIds.sort()).toEqual(["gated-1", "running-1"]);
  });

  it("resumes nothing when every checkpoint is terminal", async () => {
    const store = createMemoryRunStore([checkpoint("done-1", "done")]);
    let calls = 0;
    const resumedIds = await resumeRuns(store, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    expect(resumedIds).toEqual([]);
  });
});
