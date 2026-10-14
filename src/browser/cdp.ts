// Trusted input and screenshots through chrome.debugger. Chrome shows a
// "started debugging this browser" bar while attached, so we attach lazily
// and detach when the agent turn ends.

import { browser } from "wxt/browser";

const PROTOCOL_VERSION = "1.3";

interface KeySpec {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const SPECIAL_KEYS: Record<string, KeySpec> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
};

const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

/** Parse "Enter", "a", "Control+a", "Shift+Tab" into a key spec + modifier bitmask. */
export function parseKeyCombo(combo: string): { spec: KeySpec; modifiers: number } {
  const parts = combo.split("+").map((p) => p.trim()).filter((p) => p !== "");
  let modifiers = 0;
  let main = parts.pop() ?? combo;
  for (const part of parts) modifiers |= MODIFIER_BITS[part.toLowerCase()] ?? 0;
  if (main === "" && combo.endsWith("+")) main = "+";
  const special = SPECIAL_KEYS[main.toLowerCase()];
  if (special) return { spec: special, modifiers };
  if (main.length === 1) {
    const upper = main.toUpperCase();
    const isLetter = /[A-Z]/.test(upper);
    const isDigit = /[0-9]/.test(main);
    return {
      spec: {
        key: main,
        code: isLetter ? `Key${upper}` : isDigit ? `Digit${main}` : main,
        keyCode: upper.charCodeAt(0),
        // Ctrl/Meta shortcuts must not also type the character.
        text: modifiers & (2 | 4) ? undefined : main,
      },
      modifiers,
    };
  }
  return { spec: { key: main, code: main, keyCode: 0 }, modifiers };
}

export class CdpController {
  private readonly attached = new Set<number>();
  private listening = false;

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    browser.debugger.onDetach.addListener((source) => {
      if (source.tabId !== undefined) this.attached.delete(source.tabId);
    });
  }

  /** Attach if needed; resolves true when this call created the attachment. */
  async ensureAttached(tabId: number): Promise<boolean> {
    this.listen();
    if (this.attached.has(tabId)) return false;
    await browser.debugger.attach({ tabId }, PROTOCOL_VERSION);
    this.attached.add(tabId);
    return true;
  }

  async send<T = Record<string, unknown>>(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.ensureAttached(tabId);
    try {
      return (await browser.debugger.sendCommand({ tabId }, method, params)) as T;
    } catch (error) {
      this.attached.delete(tabId);
      throw error;
    }
  }

  async click(tabId: number, x: number, y: number, clickCount = 1): Promise<void> {
    await this.send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (let i = 1; i <= clickCount; i++) {
      await this.send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: i });
      await this.send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: i });
    }
  }

  async hover(tabId: number, x: number, y: number): Promise<void> {
    await this.send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }

  async insertText(tabId: number, text: string): Promise<void> {
    await this.send(tabId, "Input.insertText", { text });
  }

  async press(tabId: number, combo: string): Promise<void> {
    const { spec, modifiers } = parseKeyCombo(combo);
    const base = {
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.keyCode,
      nativeVirtualKeyCode: spec.keyCode,
      modifiers,
    };
    await this.send(tabId, "Input.dispatchKeyEvent", {
      ...base,
      type: spec.text !== undefined ? "keyDown" : "rawKeyDown",
      ...(spec.text !== undefined ? { text: spec.text, unmodifiedText: spec.text } : {}),
    });
    await this.send(tabId, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  }

  /** JPEG data URL of the visible viewport. */
  async screenshot(tabId: number): Promise<string> {
    const result = await this.send<{ data: string }>(tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 70,
      captureBeyondViewport: false,
    });
    return `data:image/jpeg;base64,${result.data}`;
  }

  async detachAll(): Promise<void> {
    for (const tabId of [...this.attached]) {
      this.attached.delete(tabId);
      await browser.debugger.detach({ tabId }).catch(() => undefined);
    }
  }
}
