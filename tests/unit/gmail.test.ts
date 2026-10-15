// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findCode, latestCode, parseGmailFeed, waitForCode, type Inbox } from "../../src/browser/gmail";

const NOW = Date.parse("2026-10-14T23:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function feed(entries: { from: string; email: string; title: string; summary: string; issued: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed version="0.3" xmlns="http://purl.org/atom/ns#">
  <title>Gmail - Inbox for jatin@example.com</title>
  <fullcount>${entries.length}</fullcount>
  ${entries
    .map(
      (e) => `<entry><title>${e.title}</title><summary>${e.summary}</summary><issued>${e.issued}</issued>
      <author><name>${e.from}</name><email>${e.email}</email></author></entry>`,
    )
    .join("")}
</feed>`;
}

describe("Gmail verification codes", () => {
  it("parses the inbox feed", () => {
    const inbox = parseGmailFeed(
      feed([{ from: "GitHub", email: "noreply@github.com", title: "[GitHub] Sign-in code", summary: "Your code is 482913", issued: minutesAgo(1) }]),
    );
    expect(inbox.account).toBe("jatin@example.com");
    expect(inbox.items[0]).toMatchObject({ from: "GitHub", fromEmail: "noreply@github.com", subject: "[GitHub] Sign-in code" });
    expect(inbox.items[0]!.received).toBe(NOW - 60_000);
  });

  it("rejects a sign-in page instead of a feed", () => {
    expect(() => parseGmailFeed("<html><body>Sign in</body></html>")).toThrow(/not signed in/);
  });

  it("finds codes in common email wording", () => {
    expect(findCode("Your verification code", "Use 482913 to verify your account")).toBe("482913");
    expect(findCode("Amazon OTP", "Your one-time password is 123 456. Do not share it.")).toBe("123456");
    expect(findCode("739201 is your Instagram code", "")).toBe("739201");
    expect(findCode("G-552901 is your Google verification code", "")).toBe("552901");
    expect(findCode("Login code", "Enter 4821 to sign in")).toBe("4821");
    expect(findCode("Your order shipped", "Order 4021-1123 arrives on 2026-10-20")).toBeNull();
    expect(findCode("Security code", "Copyright 2026. Your code: 90817")).toBe("90817");
  });

  it("picks the newest recent code from the matching sender", () => {
    const items = parseGmailFeed(
      feed([
        { from: "GitHub", email: "noreply@github.com", title: "Sign-in code", summary: "Your code is 111111", issued: minutesAgo(30) },
        { from: "GitHub", email: "noreply@github.com", title: "Sign-in code", summary: "Your code is 222222", issued: minutesAgo(2) },
        { from: "Slack", email: "no-reply@slack.com", title: "Slack confirmation code: 333-444", summary: "", issued: minutesAgo(1) },
      ]),
    ).items;
    const since = NOW - 10 * 60_000;
    expect(latestCode(items, { since })?.code).toBe("333444");
    expect(latestCode(items, { since, from: "github.com" })?.code).toBe("222222");
    expect(latestCode(items, { since, from: "amazon" })).toBeNull();
  });

  it("waits for the code to arrive", async () => {
    let calls = 0;
    const fetchInbox = async (): Promise<Inbox> => {
      calls++;
      const items =
        calls < 3 ? [] : [{ from: "Shop", fromEmail: "a@shop.test", subject: "Your code", summary: "Code: 654321", received: Date.now() }];
      return { account: "jatin@example.com", items };
    };
    const { found, account } = await waitForCode({ since: Date.now() - 60_000, waitMs: 1000, pollMs: 10, fetchInbox });
    expect(found?.code).toBe("654321");
    expect(account).toBe("jatin@example.com");
    expect(calls).toBe(3);
  });
});
