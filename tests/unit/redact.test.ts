import { describe, expect, it } from "vitest";
import { containsKeyMaterial, redactSecrets } from "../../src/security/redact";

describe("redact", () => {
  it("scrubs sk- keys, bearer tokens, and api_key assignments", () => {
    expect(redactSecrets("key sk-live-abcdef1234567890 end")).toBe("key [redacted] end");
    expect(redactSecrets("Authorization: Bearer abcdef1234567890")).toContain("[redacted]");
    expect(redactSecrets("api_key=abcdef1234567890")).toContain("[redacted]");
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here");
  });

  it("detects remaining key material", () => {
    expect(containsKeyMaterial("sk-live-abcdef1234567890")).toBe(true);
    expect(containsKeyMaterial("just text")).toBe(false);
  });
});
