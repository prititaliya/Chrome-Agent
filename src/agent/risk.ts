// Which agent actions need the user's OK. Decided from facts read off the
// live DOM, never from what the model claims about the element.

import type { TargetFacts } from "../browser/protocol";

export interface RiskVerdict {
  risky: boolean;
  reason: string;
}

const SAFE: RiskVerdict = { risky: false, reason: "" };

const RISKY_LABEL =
  /\b(buy|purchase|pay|checkout|check out|place (your )?order|order now|complete (order|purchase)|confirm|send|post|publish|tweet|reply|comment|delete|trash|discard|unsubscribe|subscribe|transfer|withdraw|donate|book now|reserve|sign up|register|create account|apply|deactivate|close account|cancel (my |your )?(subscription|order|plan|membership)|submit)\b/i;

function label(facts: TargetFacts): string {
  return facts.name.trim() === "" ? facts.tag : `"${facts.name.trim().slice(0, 60)}"`;
}

/** Clicking a button that submits a non-search form, or whose label signals a commitment. */
export function clickRisk(facts: TargetFacts): RiskVerdict {
  if (RISKY_LABEL.test(facts.name)) {
    return { risky: true, reason: `Clicking ${label(facts)} may buy, send, post, delete, or submit something.` };
  }
  if (facts.isSubmit && !facts.formIsSearch) {
    if (facts.formHasPayment) return { risky: true, reason: `Clicking ${label(facts)} submits a payment form.` };
    return { risky: true, reason: `Clicking ${label(facts)} submits a form.` };
  }
  return SAFE;
}

/** Typing is risky when it submits a non-search form or enters payment details. */
export function typeRisk(facts: TargetFacts, submit: boolean): RiskVerdict {
  const hint = `${facts.name} ${facts.inputType}`;
  if (facts.formHasPayment && /card|cvc|cvv|expir|iban|account number/i.test(hint)) {
    return { risky: true, reason: `Entering payment details into ${label(facts)}.` };
  }
  if (submit && facts.inForm && !facts.formIsSearch) {
    return { risky: true, reason: `Typing into ${label(facts)} and pressing Enter submits a form.` };
  }
  return SAFE;
}

/** Enter on a focused field inside a non-search form submits it. */
export function keyRisk(key: string, focused: TargetFacts | null): RiskVerdict {
  if (!focused || !/(^|\+)enter$/i.test(key.trim())) return SAFE;
  if (focused.isSubmit && !focused.formIsSearch) return clickRisk(focused);
  if (focused.inForm && !focused.formIsSearch && focused.tag !== "textarea") {
    return { risky: true, reason: `Pressing Enter in ${label(focused)} submits a form.` };
  }
  return SAFE;
}
