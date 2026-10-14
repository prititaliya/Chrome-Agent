import { describe, expect, it } from "vitest";
import {
  listProviders,
  loadCustomProviders,
  materializeDiscoveredModel,
  resolveProvider,
  saveCustomProvider,
  validateModelDef,
  validateProviderDef,
} from "../../src/providers/registry";
import { openrouterEntry } from "../../src/providers/entries/openrouter";

describe("provider registry", () => {
  it("resolves the openrouter built-in", () => {
    const entry = resolveProvider("openrouter");
    expect(entry.def.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(entry.def.wire).toBe("chat.completions");
  });

  it("rejects unknown ids with a readable message", () => {
    expect(() => resolveProvider("nope")).toThrowError(/Unknown provider "nope"/);
  });

  it("rejects a malformed provider entry via Zod", () => {
    expect(() => validateProviderDef({ id: "x" })).toThrowError();
  });

  it("requires wire on every hand-written ModelDef", () => {
    expect(() =>
      validateModelDef({
        id: "m",
        label: "m",
        contextWindow: 1000,
        maxOutput: 100,
        supportsTools: false,
        supportsVision: false,
        reasoning: false,
      }),
    ).toThrowError();
  });

  it("materializes discovered models inheriting the provider wire", () => {
    const model = materializeDiscoveredModel(openrouterEntry.def, "some/new-model");
    expect(model.wire).toBe(openrouterEntry.def.wire);
    expect(model.id).toBe("some/new-model");
  });

  it("persists a custom provider and lists it alongside built-ins", async () => {
    await saveCustomProvider({
      id: "local",
      label: "Local",
      baseUrl: "https://localhost:11434/v1",
      wire: "chat.completions",
      tools: "prompted",
    });
    const custom = await loadCustomProviders();
    expect(
      listProviders(custom)
        .map((e) => e.def.id)
        .sort(),
    ).toEqual(["local", "openrouter"]);
    expect(resolveProvider("local", custom).def.origins).toEqual(["https://localhost:11434/*"]);
  });

  it("rejects a custom provider with a non-https/non-url base", async () => {
    await expect(
      saveCustomProvider({
        id: "bad",
        label: "Bad",
        baseUrl: "not-a-url",
        wire: "chat.completions",
        tools: "native",
      }),
    ).rejects.toThrowError();
  });
});
