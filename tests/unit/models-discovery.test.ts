import { describe, expect, it } from "vitest";
import {
  addManualModels,
  extractModelIds,
  listCachedModels,
  parsePastedIds,
  refreshModels,
  setModelWireOverride,
} from "../../src/providers/models";
import { openrouterEntry } from "../../src/providers/entries/openrouter";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("model discovery", () => {
  it("tolerates {data}, {models}, and bare-array shapes", () => {
    expect(extractModelIds({ data: [{ id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
    expect(extractModelIds({ models: ["c"] })).toEqual(["c"]);
    expect(extractModelIds(["d", { id: "e" }, 42, null])).toEqual(["d", "e"]);
    expect(extractModelIds({ unexpected: true })).toEqual([]);
  });

  it("parses pasted ids on lines and commas", () => {
    expect(parsePastedIds("a\nb, c  ,a")).toEqual(["a", "b", "c"]);
  });

  it("fetches, caches, and serves stale-then-fresh correctly", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ data: [{ id: "m1" }] });
    }) as typeof fetch;
    const first = await refreshModels(openrouterEntry.def, null, { fetchImpl });
    expect(first.map((m) => m.id)).toEqual(["m1"]);
    expect(first[0]?.wire).toBe("chat.completions");
    const second = await refreshModels(openrouterEntry.def, null, { fetchImpl });
    expect(calls).toBe(1);
    expect(second.map((m) => m.id)).toEqual(["m1"]);
    const forced = await refreshModels(openrouterEntry.def, null, { fetchImpl, force: true });
    expect(calls).toBe(2);
    expect(forced.map((m) => m.id)).toEqual(["m1"]);
  });

  it("merges manual models and honors wire overrides", async () => {
    await addManualModels(openrouterEntry.def, "custom-1, custom-1");
    await setModelWireOverride("openrouter", "custom-1", "responses");
    const models = await listCachedModels("openrouter");
    expect(models.map((m) => m.id)).toContain("custom-1");
    expect(models.find((m) => m.id === "custom-1")?.wire).toBe("responses");
  });
});
