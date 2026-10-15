// Verification codes from the user's Gmail, read through Gmail's unread-inbox
// Atom feed with the browser's own Google session. Only the code, sender and
// subject are handed to the model, never whole emails.

export interface MailItem {
  from: string;
  fromEmail: string;
  subject: string;
  summary: string;
  /** Epoch ms. */
  received: number;
}

export interface Inbox {
  account: string;
  items: MailItem[];
}

export interface FoundCode {
  code: string;
  item: MailItem;
}

const FEED_URL = (account: number) => `https://mail.google.com/mail/u/${account}/feed/atom`;

const CODE_CONTEXT =
  /(?:code|otp|pin|passcode|password|verif\w*|one[- ]time|security|log ?in|sign[- ]?in|authenticat\w*|confirm\w*)\b[^\d]{0,60}?\b(\d{3}[ -]\d{3}|\d{4,8})\b/i;
const CODE_FIRST = /\b(\d{3}[ -]\d{3}|\d{4,8})\b[^\d]{0,15}\b(?:is your|is the|is a|as your)\b/i;
const CODE_WORDS = /\b(?:code|otp|passcode|verif\w*|one[- ]time|authenticat\w*)\b/i;

function text(parent: Element | null, tag: string): string {
  return parent?.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
}

export function parseGmailFeed(xml: string): Inbox {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || doc.documentElement.tagName !== "feed") {
    throw new Error("Gmail did not return its inbox feed (not signed in to Gmail in this browser?).");
  }
  const feedTitle = text(doc.documentElement, "title");
  const account = feedTitle.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0] ?? "";
  const items = [...doc.getElementsByTagName("entry")].map((entry): MailItem => {
    const author = entry.getElementsByTagName("author")[0] ?? null;
    const when = Date.parse(text(entry, "issued") || text(entry, "modified"));
    return {
      from: text(author, "name"),
      fromEmail: text(author, "email"),
      subject: text(entry, "title"),
      summary: text(entry, "summary"),
      received: Number.isFinite(when) ? when : 0,
    };
  });
  return { account, items };
}

/** The verification code in an email's subject or preview, if there is one. */
export function findCode(subject: string, summary: string): string | null {
  for (const source of [subject, summary, `${subject} ${summary}`]) {
    const match = source.match(CODE_CONTEXT) ?? source.match(CODE_FIRST);
    if (!match) continue;
    const code = match[1]!.replace(/[ -]/g, "");
    if (code.length === 4 && /^(19|20)\d\d$/.test(code)) continue;
    return code;
  }
  const loose = `${subject} ${summary}`;
  if (CODE_WORDS.test(loose)) {
    const six = loose.match(/\b(\d{6})\b/);
    if (six) return six[1]!;
  }
  return null;
}

/** Newest code received after `since`, optionally from a sender matching `from` (site name or domain). */
export function latestCode(items: MailItem[], options: { since: number; from?: string }): FoundCode | null {
  const hint = (options.from ?? "").toLowerCase().replace(/^www\./, "").split(".")[0]!.trim();
  const candidates = items
    .filter((item) => item.received >= options.since)
    .filter((item) => hint === "" || `${item.from} ${item.fromEmail} ${item.subject}`.toLowerCase().includes(hint))
    .sort((a, b) => b.received - a.received);
  for (const item of candidates) {
    const code = findCode(item.subject, item.summary);
    if (code) return { code, item };
  }
  return null;
}

export async function fetchGmailInbox(account = 0): Promise<Inbox> {
  const response = await fetch(FEED_URL(account), { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(`Gmail feed returned HTTP ${response.status} (not signed in to Gmail in this browser?).`);
  return parseGmailFeed(await response.text());
}

/** Poll the inbox until a matching code arrives or `waitMs` passes. */
export async function waitForCode(options: {
  from?: string;
  since: number;
  waitMs: number;
  fetchInbox?: () => Promise<Inbox>;
  pollMs?: number;
}): Promise<{ found: FoundCode | null; account: string }> {
  const fetchInbox = options.fetchInbox ?? (() => fetchGmailInbox());
  const deadline = Date.now() + options.waitMs;
  for (;;) {
    const inbox = await fetchInbox();
    const found = latestCode(inbox.items, options);
    if (found || Date.now() >= deadline) return { found, account: inbox.account };
    await new Promise((r) => setTimeout(r, options.pollMs ?? 4000));
  }
}
