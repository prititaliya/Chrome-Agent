// Blanks out secret values (API keys, tokens, passwords, codes, card numbers)
// before text from earlier chats is stored in a digest or shown to a model.

export const REDACTED = "[redacted secret]";

const TOKEN_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b(?:\d[ -]?){13,19}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

/** "password: hunter2", "api key = abc...", "code is 123456", "OTP 482913". */
const LABELLED =
  /\b(password|passcode|passwd|pwd|api[ _-]?key|secret(?: key)?|access token|token|private key|seed phrase|recovery phrase|cvv|pin|otp|one-time code|verification code|security code|code)\b(\s*(?:is|was|:|=)?\s*["'`]?)([^\s"'`,;)]{4,})/gi;

/** Long random-looking strings: mixed case and digits, 32+ chars (slugs and words are left alone). */
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;

function looksRandom(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);
}

const COMMON_WORDS =
  /^(?:required|incorrect|wrong|invalid|saved|stored|correct|needed|missing|filled|empty|reset|changed|updated|expired|not|the|a|an|for|and|field|manager)[.!]?$/i;

function labelledValue(label: string, sep: string, value: string): boolean {
  if (/^(?:pin|otp)$|code$/i.test(label)) return /^\d{4,10}$/.test(value) || (/^[A-Z0-9]{4,10}$/.test(value) && /\d/.test(value));
  if (value.startsWith("[") || COMMON_WORDS.test(value)) return false;
  // "password: x" or "token = x"; without a separator only token-like values ("api key abc123xyz").
  return /[:=]|\b(?:is|was)\b/i.test(sep) || (value.length >= 6 && /\d/.test(value) && /[A-Za-z]/.test(value));
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, REDACTED);
  out = out.replace(LONG_TOKEN, (m) => (looksRandom(m) ? REDACTED : m));
  out = out.replace(LABELLED, (match, label: string, sep: string, value: string) =>
    labelledValue(label, sep, value) ? `${label}${sep}${REDACTED}` : match,
  );
  return out;
}
