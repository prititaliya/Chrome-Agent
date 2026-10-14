import { describe, expect, it } from "vitest";
import { classify } from "../../src/security/write-gate";
import type { AttestFacts } from "../../src/dom/attest-facts";

function facts(target: AttestFacts["target"], focusInForm = false): AttestFacts {
  return {
    target,
    focus: { tag: "body", inForm: focusInForm },
    url: "https://example.com/page",
  };
}

function button(name: string): AttestFacts["target"] {
  return { role: "button", name, tag: "button", inForm: false, isSubmitControl: false, isFileInput: false };
}

describe("write-gate classification", () => {
  it("reads are always read", () => {
    for (const name of ["browser_snapshot", "browser_read_text", "read_selection", "browser_extract"]) {
      expect(classify(name, {}, undefined, []).cls).toBe("read");
    }
  });

  it("submit controls and destructive lexicon are irreversible", () => {
    expect(
      classify(
        "browser_click",
        {},
        facts({
          role: "button",
          name: "Send",
          tag: "button",
          inForm: true,
          isSubmitControl: true,
          isFileInput: false,
        }),
        [],
      ).cls,
    ).toBe("irreversible");
    expect(classify("browser_click", {}, facts(button("Delete account")), []).cls).toBe("irreversible");
    expect(classify("browser_click", {}, facts(button("Buy now")), []).cls).toBe("irreversible");
    expect(
      classify(
        "browser_click",
        {},
        facts({
          role: "textbox",
          name: "avatar",
          tag: "input",
          inputType: "file",
          inForm: true,
          isSubmitControl: false,
          isFileInput: true,
        }),
        [],
      ).cls,
    ).toBe("irreversible");
    expect(classify("form_submit", {}, undefined, []).cls).toBe("irreversible");
    expect(classify("browser_tabs", { action: "close" }, undefined, []).cls).toBe("irreversible");
  });

  it("Enter inside a form is irreversible; plain keys are mutate", () => {
    expect(classify("browser_press_key", { key: "Enter" }, facts(undefined, true), []).cls).toBe(
      "irreversible",
    );
    expect(classify("browser_press_key", { key: "Enter" }, facts(undefined, false), []).cls).toBe("mutate");
    expect(classify("browser_press_key", { key: "Escape" }, facts(undefined, true), []).cls).toBe("mutate");
  });

  it("navigation outside granted origins is irreversible", () => {
    expect(
      classify("browser_navigate", { url: "https://evil.test/x" }, undefined, ["https://example.com"]).cls,
    ).toBe("irreversible");
    expect(
      classify("browser_navigate", { url: "https://example.com/y" }, undefined, ["https://example.com"]).cls,
    ).toBe("mutate");
  });

  it("must NOT over-block: plain links, typing, tab list", () => {
    expect(
      classify(
        "browser_click",
        {},
        facts({
          role: "link",
          name: "Learn more",
          tag: "a",
          inForm: false,
          isSubmitControl: false,
          isFileInput: false,
        }),
        [],
      ).cls,
    ).toBe("mutate");
    expect(classify("browser_type", {}, undefined, []).cls).toBe("mutate");
    expect(classify("browser_tabs", { action: "list" }, undefined, []).cls).toBe("read");
    expect(classify("browser_click", {}, undefined, []).cls).toBe("mutate");
  });

  it("unknown tools default to mutate, never to read", () => {
    expect(classify("browser_eval", {}, undefined, []).cls).toBe("mutate");
  });
});
