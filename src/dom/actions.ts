// Synthetic input primitives (page context). Everything here is UNTRUSTED
// input (isTrusted:false): sites that require trusted events will no-op,
// and the caller must verify effects instead of assuming success.

export function isInteractable(element: Element): boolean {
  if (element.hasAttribute("disabled")) return false;
  if (element.hasAttribute("hidden")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  const tag = element.tagName.toLowerCase();
  return !["script", "style", "noscript", "template"].includes(tag);
}

function mouseButton(button: "left" | "right" | "middle"): number {
  return button === "right" ? 2 : button === "middle" ? 1 : 0;
}

export function clickElement(
  element: Element,
  button: "left" | "right" | "middle" = "left",
  double = false,
): void {
  // Pure synthetic dispatch, always untrusted. Pages decide what untrusted
  // input means (navigate, mutate, or refuse visibly); the caller verifies
  // effects instead of assuming. Deliberately no requestSubmit: that path is
  // engine-driven and would fake trusted input from the DOM backend.
  const code = mouseButton(button);
  const press = () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: code }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: code }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: code }));
  };
  press();
  if (double) {
    press();
    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: code }));
  }
}

export interface TypeOptions {
  replace?: boolean;
  mode?: "fill" | "keys";
}

/** Returns the value after typing (caller verifies it took). */
export function typeInto(element: Element, text: string, options: TypeOptions = {}): string {
  const replace = options.replace ?? true;
  const mode = options.mode ?? "fill";
  // Tag-based (not instanceof): callers may pass nodes from another realm.
  const tag = element.tagName.toLowerCase();
  const field = element as HTMLInputElement;
  if (tag === "input" || tag === "textarea" || tag === "select") {
    field.focus();
    if (mode === "keys") {
      if (replace) {
        field.value = "";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      for (const char of text) {
        field.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true, cancelable: true }));
        field.value += char;
        field.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true, cancelable: true }));
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
      }
    } else {
      field.value = replace ? text : field.value + text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return field.value;
  }
  const editable = element as HTMLElement;
  if (typeof editable.isContentEditable === "boolean" && editable.isContentEditable) {
    editable.focus();
    editable.textContent = replace ? text : `${editable.textContent ?? ""}${text}`;
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    return editable.textContent ?? "";
  }
  return "";
}

export function pressKeyOn(target: Element | Document, key: string): void {
  const printable = key.length === 1;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  if (printable) {
    target.dispatchEvent(new KeyboardEvent("keypress", { key, bubbles: true, cancelable: true }));
  }
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
}

export interface ScrollMetrics {
  scrollY: number;
  pageHeight: number;
  atTop: boolean;
  atBottom: boolean;
}

export interface ScrollViewport {
  readonly scrollY: number;
  readonly innerHeight: number;
  scrollTo(x: number, y: number): void;
  readonly document: { readonly documentElement: { readonly scrollHeight: number } };
}

export function scrollByAmount(
  win: ScrollViewport,
  direction: "up" | "down" | "top" | "bottom",
  amount?: number,
  scope?: Element | null,
): ScrollMetrics {
  const step = amount ?? win.innerHeight;
  // Duck-typed (not instanceof): callers may pass nodes from another realm.
  const scoped = scope as HTMLElement | null;
  const scrollable =
    !!scoped && typeof scoped.scrollHeight === "number" && scoped.scrollHeight > scoped.clientHeight;
  const top = scrollable ? (scoped as HTMLElement).scrollTop : win.scrollY;
  const height = scrollable
    ? (scoped as HTMLElement).scrollHeight
    : win.document.documentElement.scrollHeight;
  const view = scrollable ? (scoped as HTMLElement).clientHeight : win.innerHeight;
  const apply = (y: number) => {
    if (scrollable) (scoped as HTMLElement).scrollTop = y;
    else win.scrollTo(0, y);
  };
  if (direction === "top") apply(0);
  else if (direction === "bottom") apply(height);
  else apply(top + (direction === "down" ? step : -step));
  const now = scrollable ? (scoped as HTMLElement).scrollTop : win.scrollY;
  return { scrollY: now, pageHeight: height, atTop: now <= 0, atBottom: now + view >= height - 1 };
}

export function observeMutations(doc: Document, windowMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      observer.disconnect();
      doc.defaultView?.removeEventListener("pagehide", onHide);
      resolve(value);
    };
    const onHide = () => finish(true);
    const observer = new MutationObserver(() => finish(true));
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    doc.defaultView?.addEventListener("pagehide", onHide);
    setTimeout(() => finish(false), windowMs);
  });
}

/** Poll for a selector/text condition. Resolves elapsed ms, or -1 on timeout. */
export function waitForContent(
  doc: Document,
  kind: "selector" | "text",
  value: string,
  timeoutMs: number,
): Promise<number> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = (): boolean =>
      kind === "selector" ? doc.querySelector(value) !== null : (doc.body?.textContent ?? "").includes(value);
    if (check()) {
      resolve(0);
      return;
    }
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        clearTimeout(killer);
        resolve(Date.now() - start);
      }
    }, 100);
    const killer = setTimeout(() => {
      clearInterval(timer);
      resolve(-1);
    }, timeoutMs);
  });
}

export interface FormPreview {
  action: string;
  method: string;
  fields: { name: string; value: string }[];
}

/** Resolve the form to submit: anchor's owning form, or the first form on the page. */
export function findForm(doc: Document, anchor?: Element | null): HTMLFormElement | null {
  if (anchor) {
    const tag = anchor.tagName?.toLowerCase();
    if (tag === "form") return anchor as HTMLFormElement;
    const owner = anchor.closest?.("form");
    if (owner) return owner as HTMLFormElement;
  }
  return doc.querySelector("form");
}

/** Field names + values, capped so previews stay readable. */
export function buildFormPreview(form: HTMLFormElement): FormPreview {
  const fields: { name: string; value: string }[] = [];
  for (const element of Array.from(form.elements)) {
    const tag = element.tagName?.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") continue;
    const field = element as HTMLInputElement;
    if (!field.name || field.disabled) continue;
    if (field.type === "submit" || field.type === "button" || field.type === "reset") continue;
    if (field.type === "password") {
      fields.push({ name: field.name, value: "••••••" });
      continue;
    }
    fields.push({ name: field.name, value: field.value });
    if (fields.length >= 40) break;
  }
  return {
    action: form.action || location.href,
    method: (form.method || "get").toUpperCase(),
    fields,
  };
}

/**
 * Submit an approved form via requestSubmit (fires the real submit event).
 * Safe here because form_submit is ALWAYS gated — the user approved this.
 * Returns whether a submit event fired and was not defaultPrevented.
 */
export function submitForm(form: HTMLFormElement, submitter?: Element | null): { submitted: boolean } {
  let sawSubmit = false;
  let prevented = false;
  const onSubmit = (event: Event): void => {
    sawSubmit = true;
    if (event.defaultPrevented) prevented = true;
  };
  form.addEventListener("submit", onSubmit);
  try {
    const tag = submitter?.tagName?.toLowerCase();
    const button = tag === "button" || tag === "input" ? (submitter as HTMLElement) : undefined;
    form.requestSubmit(button);
  } catch {
    // requestSubmit throws when the submitter is not a member of this form.
  } finally {
    form.removeEventListener("submit", onSubmit);
  }
  return { submitted: sawSubmit && !prevented };
}
