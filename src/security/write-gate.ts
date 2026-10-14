// Write-gate: pure code classification of every tool call. The model is
// never consulted; inputs are attested DOM facts (attest-facts.ts), never
// model claims. `irreversible` blocks on a panel approval card.

import type { AttestFacts } from "../dom/attest-facts";

export type GateClass = "read" | "mutate" | "irreversible";

export interface GateVerdict {
  cls: GateClass;
  reason: string;
  grantKey: string;
}

/** Button names that imply money, data loss, or sending something away. */
const DESTRUCTIVE_LEXICON = [
  /buy/i,
  /\bpay\b/i,
  /purchase/i,
  /\border\b/i,
  /\bsend\b/i,
  /delete/i,
  /remove/i,
  /destroy/i,
  /confirm/i,
  /\bsubmit\b/i,
  /upload/i,
  /subscribe/i,
  /checkout/i,
];

function matchesLexicon(name: string): boolean {
  return DESTRUCTIVE_LEXICON.some((pattern) => pattern.test(name));
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function classify(
  toolName: string,
  args: Record<string, unknown>,
  facts: AttestFacts | undefined,
  runOrigins: string[],
): GateVerdict {
  const grantKeyFor = (suffix: string) => `${toolName}:${suffix}`;

  switch (toolName) {
    case "browser_snapshot":
    case "browser_read_text":
    case "read_selection":
    case "browser_extract":
    case "browser_wait_for":
    case "browser_screenshot":
    case "task_plan":
      return { cls: "read", reason: `${toolName} only observes`, grantKey: grantKeyFor("read") };

    case "browser_type":
      return {
        cls: "mutate",
        reason: "typing changes field state but never submits",
        grantKey: grantKeyFor("type"),
      };

    case "browser_scroll":
      return { cls: "read", reason: `${toolName} only observes`, grantKey: grantKeyFor("read") };

    case "form_submit":
      return {
        cls: "irreversible",
        reason: "form_submit always sends data",
        grantKey: grantKeyFor("submit"),
      };

    case "browser_click": {
      const target = facts?.target;
      if (!target) {
        return {
          cls: "mutate",
          reason: "click on an unattested target (bridge did not attest)",
          grantKey: grantKeyFor("unattested"),
        };
      }
      if (target.isFileInput) {
        return {
          cls: "irreversible",
          reason: "file input attaches local files",
          grantKey: grantKeyFor(`file:${target.name}`),
        };
      }
      if (target.isSubmitControl) {
        return {
          cls: "irreversible",
          reason: `submit control "${target.name}"`,
          grantKey: grantKeyFor(`submit:${target.name}`),
        };
      }
      if (matchesLexicon(target.name) || (target.role === "button" && matchesLexicon(target.name))) {
        return {
          cls: "irreversible",
          reason: `destructive action "${target.name}"`,
          grantKey: grantKeyFor(`destructive:${target.name}`),
        };
      }
      return {
        cls: "mutate",
        reason: `click on "${target.name}"`,
        grantKey: grantKeyFor(`click:${target.name}`),
      };
    }

    case "browser_press_key": {
      const key = typeof args["key"] === "string" ? args["key"] : "";
      if (key === "Enter" && facts?.focus.inForm === true) {
        return {
          cls: "irreversible",
          reason: "Enter inside a form submits it",
          grantKey: grantKeyFor("enter-in-form"),
        };
      }
      return { cls: "mutate", reason: `key press "${key}"`, grantKey: grantKeyFor(`key:${key}`) };
    }

    case "browser_navigate": {
      const url = typeof args["url"] === "string" ? args["url"] : "";
      const origin = originOf(url);
      if (origin !== "" && !runOrigins.includes(origin)) {
        return {
          cls: "irreversible",
          reason: `navigation leaves granted origins (${origin})`,
          grantKey: grantKeyFor(`nav:${origin}`),
        };
      }
      return {
        cls: "mutate",
        reason: `navigation to ${origin || url}`,
        grantKey: grantKeyFor(`nav:${origin}`),
      };
    }

    case "browser_tabs": {
      const action = typeof args["action"] === "string" ? args["action"] : "";
      if (action === "close") {
        return {
          cls: "irreversible",
          reason: "closing a tab destroys its state",
          grantKey: grantKeyFor("close"),
        };
      }
      if (action === "list" || action === "activate") {
        return {
          cls: "read",
          reason: `tab ${action} only observes`,
          grantKey: grantKeyFor(`tabs:${action}`),
        };
      }
      return { cls: "mutate", reason: `tab ${action}`, grantKey: grantKeyFor(`tabs:${action}`) };
    }

    case "ask_user":
    case "finish":
      return {
        cls: "read",
        reason: `${toolName} is loop control, not a page action`,
        grantKey: grantKeyFor("meta"),
      };

    default:
      return {
        cls: "mutate",
        reason: `unknown tool "${toolName}" treated as mutating`,
        grantKey: grantKeyFor("unknown"),
      };
  }
}
