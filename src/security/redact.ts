// Secret scrubbing for anything persisted or exported (history, logs).
// Runs at history persist time AND immediately before export, so a pasted
// key can never leak into a shared file. Trade-off, documented: a key you
// paste into chat is masked in your own history too.

const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9-_]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9-_.~+/=]{8,}/g,
  /\bapi[_-]?key\s*[:=]\s*["']?[A-Za-z0-9-_.~+/=]{8,}["']?/gi,
];

export const REDACTED = "[redacted]";

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** True when the text looks like it still contains key material. */
export function containsKeyMaterial(text: string): boolean {
  return PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
