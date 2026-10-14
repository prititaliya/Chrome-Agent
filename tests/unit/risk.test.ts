import { describe, expect, it } from "vitest";
import { clickRisk, keyRisk, typeRisk } from "../../src/agent/risk";
import type { TargetFacts } from "../../src/browser/protocol";

function facts(patch: Partial<TargetFacts>): TargetFacts {
  return {
    tag: "button",
    role: "button",
    name: "",
    inputType: "",
    href: "",
    isSubmit: false,
    inForm: false,
    formHasPassword: false,
    formHasPayment: false,
    formIsSearch: false,
    formAction: "",
    ...patch,
  };
}

describe("risk classifier", () => {
  it("lets ordinary clicks through", () => {
    expect(clickRisk(facts({ name: "Next page" })).risky).toBe(false);
    expect(clickRisk(facts({ tag: "a", role: "link", name: "Pricing" })).risky).toBe(false);
    expect(clickRisk(facts({ name: "Add to cart" })).risky).toBe(false);
  });

  it("flags purchases, sending, deleting", () => {
    for (const name of ["Place order", "Buy now", "Send", "Delete repository", "Post", "Confirm payment"]) {
      expect(clickRisk(facts({ name })).risky, name).toBe(true);
    }
  });

  it("flags form submits except search forms", () => {
    expect(clickRisk(facts({ name: "Go", isSubmit: true, inForm: true })).risky).toBe(true);
    expect(clickRisk(facts({ name: "Search", isSubmit: true, inForm: true, formIsSearch: true })).risky).toBe(false);
  });

  it("allows typing into search boxes with submit", () => {
    expect(typeRisk(facts({ tag: "input", name: "Search", inForm: true, formIsSearch: true }), true).risky).toBe(false);
    expect(typeRisk(facts({ tag: "input", name: "Comment", inForm: true }), true).risky).toBe(true);
    expect(typeRisk(facts({ tag: "input", name: "Comment", inForm: true }), false).risky).toBe(false);
  });

  it("flags entering card details", () => {
    expect(typeRisk(facts({ tag: "input", name: "Card number", inForm: true, formHasPayment: true }), false).risky).toBe(true);
  });

  it("flags Enter inside non-search forms only", () => {
    expect(keyRisk("Enter", facts({ tag: "input", inForm: true })).risky).toBe(true);
    expect(keyRisk("Enter", facts({ tag: "input", inForm: true, formIsSearch: true })).risky).toBe(false);
    expect(keyRisk("Escape", facts({ tag: "input", inForm: true })).risky).toBe(false);
    expect(keyRisk("Enter", null).risky).toBe(false);
  });
});
