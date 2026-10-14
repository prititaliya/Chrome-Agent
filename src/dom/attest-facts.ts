// Attested DOM facts for the write-gate: derived from the live DOM and the
// ref map — never from model claims. Shared by the content bridge (real
// pages) and unit tests (jsdom + fixture pages).

export interface TargetFacts {
  role: string;
  name: string;
  tag: string;
  inputType?: string;
  inForm: boolean;
  isSubmitControl: boolean;
  isFileInput: boolean;
  formAction?: string;
  formMethod?: string;
}

export interface FocusFacts {
  tag: string;
  inForm: boolean;
  formAction?: string;
}

export interface AttestFacts {
  target?: TargetFacts;
  focus: FocusFacts;
  url: string;
}

function isElement(node: unknown): node is Element {
  // Duck-typed: content scripts and tests run across realms where
  // cross-realm instanceof is false for live DOM nodes.
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as Element).closest === "function" &&
    typeof (node as Element).getAttribute === "function"
  );
}

function formOf(element: Element | null): HTMLFormElement | null {
  if (!isElement(element)) return null;
  if (element.tagName.toLowerCase() === "form") return element as HTMLFormElement;
  return element.closest("form");
}

export function attestTarget(element: Element, role: string, name: string): TargetFacts {
  const tag = element.tagName.toLowerCase();
  const inputType = tag === "input" ? (element.getAttribute("type") ?? "text").toLowerCase() : undefined;
  const form = formOf(element);
  const buttonType = tag === "button" ? (element.getAttribute("type") ?? "submit").toLowerCase() : undefined;
  const isSubmitControl =
    (tag === "button" && buttonType !== "button") ||
    (tag === "input" && (inputType === "submit" || inputType === "image"));
  return {
    role,
    name,
    tag,
    inputType,
    inForm: form !== null,
    isSubmitControl,
    isFileInput: tag === "input" && inputType === "file",
    formAction: form?.getAttribute("action") ?? undefined,
    formMethod: form?.getAttribute("method")?.toLowerCase() ?? undefined,
  };
}

export function attestFocus(doc: Document): FocusFacts {
  const active: unknown = doc.activeElement;
  const tag = isElement(active) ? active.tagName.toLowerCase() : "body";
  const form = formOf(isElement(active) ? active : null);
  return {
    tag,
    inForm: form !== null,
    formAction: form?.getAttribute("action") ?? undefined,
  };
}

export function computeAttestFacts(
  doc: Document,
  target: { element: Element; role: string; name: string } | null,
  url: string,
): AttestFacts {
  return {
    target: target ? attestTarget(target.element, target.role, target.name) : undefined,
    focus: attestFocus(doc),
    url,
  };
}
