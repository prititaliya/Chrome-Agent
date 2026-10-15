// Messages between the side panel (agent) and the content script.

export type ExtractKind = "table" | "list" | "links" | "forms" | "metadata";
export type ScrollDirection = "up" | "down" | "top" | "bottom";
export type SearchEngine = "google" | "duckduckgo" | "bing";

/** How long the on-page cursor takes to glide to an element; actions wait for it. */
export const POINTER_TRAVEL_MS = 450;
export type PointerAction = "click" | "type" | "hover" | "select";

export type ContentRequest =
  | { type: "cs/ping" }
  | { type: "cs/snapshot"; maxChars?: number }
  | { type: "cs/pageText"; maxChars?: number }
  | { type: "cs/extract"; kind: ExtractKind }
  | { type: "cs/find"; query: string }
  | { type: "cs/selection" }
  | { type: "cs/target"; ref: number }
  | { type: "cs/activeFacts" }
  | { type: "cs/focus"; ref: number; clear: boolean }
  | { type: "cs/domClick"; ref: number }
  | { type: "cs/domType"; ref: number; text: string; replace: boolean }
  | { type: "cs/domSelect"; ref: number; value: string }
  | { type: "cs/domHover"; ref: number }
  | { type: "cs/domKey"; key: string }
  | { type: "cs/submitOf"; ref: number }
  | { type: "cs/scroll"; direction: ScrollDirection; ref?: number; amount?: number }
  | { type: "cs/waitText"; text: string; timeoutMs: number }
  | { type: "cs/highlight"; ref: number; action?: PointerAction }
  | { type: "cs/agentActive"; on: boolean; label?: string }
  | { type: "cs/searchResults"; engine: SearchEngine }
  | { type: "cs/loginState"; ref: number };

/** Facts about an element the risk classifier relies on (read from the DOM, never the model). */
export interface TargetFacts {
  tag: string;
  role: string;
  name: string;
  inputType: string;
  href: string;
  isSubmit: boolean;
  inForm: boolean;
  formHasPassword: boolean;
  formHasPayment: boolean;
  /** Sign-in or verification-code form (not a sign-up form). */
  formIsLogin: boolean;
  /** Search boxes submit freely; other forms need approval. */
  formIsSearch: boolean;
  formAction: string;
}

export interface TargetInfo {
  x: number;
  y: number;
  facts: TargetFacts;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type ContentResponse =
  | { ok: false; error: string }
  | { ok: true; kind: "pong" }
  | { ok: true; kind: "snapshot"; url: string; title: string; text: string; refCount: number }
  | { ok: true; kind: "pageText"; url: string; title: string; text: string; truncated: boolean }
  | { ok: true; kind: "data"; data: unknown }
  | { ok: true; kind: "text"; text: string }
  | { ok: true; kind: "target"; target: TargetInfo }
  | { ok: true; kind: "facts"; facts: TargetFacts | null }
  | { ok: true; kind: "done"; note: string }
  | { ok: true; kind: "search"; results: SearchResult[] }
  /** Never carries the password itself. */
  | { ok: true; kind: "login"; username: string; passwordFilled: boolean; hasPassword: boolean };
