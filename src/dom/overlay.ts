// "Agent in control" overlay: a flowing gradient frame around the viewport, a
// breathing edge glow, a status pill with the current action, and a cursor
// that glides to each element the agent uses. Everything lives in one shadow
// root and never takes pointer events, so the page works underneath it.

import { POINTER_TRAVEL_MS, type PointerAction } from "../browser/protocol";

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.stage { position: fixed; inset: 0; pointer-events: none; font: 500 13px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }

.vignette, .ring, .pill { opacity: 0; transition: opacity .5s ease, transform .55s cubic-bezier(.2, .9, .3, 1.15); }
.on .vignette, .on .ring { opacity: 1; }

.vignette {
  position: fixed; inset: 0;
  box-shadow: inset 0 0 70px 8px rgba(124, 92, 255, .30), inset 0 0 18px 2px rgba(0, 212, 255, .18);
}
.on .vignette { animation: breathe 2.8s ease-in-out infinite; }

.ring {
  position: fixed; inset: 0; overflow: hidden; padding: 3px;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
.ring.halo { padding: 16px; filter: blur(14px); }
.on .ring.halo { opacity: .75; }
.spin {
  position: absolute; left: 50%; top: 50%;
  width: 250vmax; height: 250vmax; margin: -125vmax 0 0 -125vmax;
  background: conic-gradient(from 0deg, #7c5cff, #00d4ff, #3dffb5, #ff4fd8, #ffb84f, #7c5cff);
  animation: spin 5s linear infinite;
}

.focus {
  position: fixed; border-radius: 10px; opacity: 0;
  border: 2px solid rgba(155, 130, 255, .95);
  background: rgba(124, 92, 255, .10);
  box-shadow: 0 0 0 4px rgba(124, 92, 255, .18), 0 0 24px rgba(124, 92, 255, .45);
}
.focus.show { animation: focus-pop 1.9s ease forwards; }

.cursor {
  position: fixed; left: 0; top: 0; opacity: 0;
  transition: transform ${POINTER_TRAVEL_MS}ms cubic-bezier(.22, 1, .36, 1), opacity .3s ease;
  filter: drop-shadow(0 6px 12px rgba(70, 30, 200, .5));
  will-change: transform;
}
.on .cursor.shown { opacity: 1; }
.cursor svg { display: block; }
.cursor .tag {
  position: absolute; left: 22px; top: 22px; padding: 3px 9px; border-radius: 9px;
  background: linear-gradient(135deg, #7c5cff, #ff4fd8); color: #fff;
  font-weight: 650; font-size: 11px; letter-spacing: .02em; white-space: nowrap;
  box-shadow: 0 4px 14px rgba(124, 92, 255, .45);
}
.cursor.press svg { animation: press .28s ease; }

.ripple {
  position: fixed; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
  border: 2px solid #a48cff; box-shadow: 0 0 16px rgba(164, 140, 255, .8);
  animation: ripple .7s ease-out forwards;
}
.ripple.second { animation-delay: .12s; border-color: #ff4fd8; opacity: 0; }

.pill {
  position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 24px) scale(.94);
  display: flex; align-items: center; gap: 10px; max-width: min(560px, 84vw);
  padding: 8px 16px 8px 9px; border-radius: 999px; color: #fff;
  background: rgba(18, 14, 38, .74);
  -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
  box-shadow: 0 12px 34px rgba(20, 10, 60, .38), inset 0 0 0 1px rgba(255, 255, 255, .14);
}
.on .pill { opacity: 1; transform: translate(-50%, 0) scale(1); }
.orb {
  position: relative; flex: none; width: 24px; height: 24px; border-radius: 50%;
  background: conic-gradient(#7c5cff, #00d4ff, #3dffb5, #ff4fd8, #7c5cff);
  box-shadow: 0 0 16px rgba(124, 92, 255, .85);
  animation: spin 1.6s linear infinite;
}
.orb::after { content: ""; position: absolute; inset: 5px; border-radius: 50%; background: #17122e; }
.orb::before {
  content: ""; position: absolute; inset: 9px; border-radius: 50%; z-index: 1;
  background: #fff; box-shadow: 0 0 8px #fff; animation: twinkle 1.4s ease-in-out infinite;
}
.brand { flex: none; font-weight: 700; letter-spacing: .03em; color: #cdbfff; }
.text {
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  background: linear-gradient(90deg, #fff 0%, #fff 38%, #b7a4ff 50%, #fff 62%, #fff 100%);
  background-size: 260% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: shimmer 2.4s linear infinite;
}
.text.swap { animation: shimmer 2.4s linear infinite, swap-in .35s ease; }
.dots { flex: none; display: flex; gap: 3px; }
.dots i { width: 4px; height: 4px; border-radius: 50%; background: #b7a4ff; animation: bounce 1.2s ease-in-out infinite; }
.dots i:nth-child(2) { animation-delay: .15s; }
.dots i:nth-child(3) { animation-delay: .3s; }

@keyframes spin { to { transform: rotate(1turn); } }
@keyframes breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -160% 0; } }
@keyframes swap-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .45; } 40% { transform: translateY(-4px); opacity: 1; } }
@keyframes twinkle { 0%, 100% { transform: scale(.6); opacity: .6; } 50% { transform: scale(1); opacity: 1; } }
@keyframes ripple { 0% { transform: scale(.3); opacity: 1; } 100% { transform: scale(4.2); opacity: 0; } }
@keyframes press { 0%, 100% { transform: scale(1); } 45% { transform: scale(.82); } }
@keyframes focus-pop {
  0% { opacity: 0; transform: scale(1.08); }
  14% { opacity: 1; transform: scale(1); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .spin, .orb, .orb::before, .text, .dots i, .on .vignette { animation: none; }
  .cursor { transition: opacity .2s ease; }
  .ripple, .ripple.second { animation-duration: .01s; }
}
`;

const HTML = `
<div class="stage">
  <div class="vignette"></div>
  <div class="ring halo"><div class="spin"></div></div>
  <div class="ring"><div class="spin"></div></div>
  <div class="focus"></div>
  <div class="cursor">
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <defs>
        <linearGradient id="comet-cursor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#8b6dff" />
          <stop offset="1" stop-color="#ff4fd8" />
        </linearGradient>
      </defs>
      <path d="M4 2.5 L4 22 L9.2 17.2 L12.6 25 L16.2 23.4 L12.9 15.8 L20 15.6 Z"
        fill="url(#comet-cursor)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" />
    </svg>
    <span class="tag">Comet</span>
  </div>
  <div class="pill" role="status" aria-live="polite">
    <span class="orb"></span>
    <span class="brand">Comet</span>
    <span class="text">Working</span>
    <span class="dots"><i></i><i></i><i></i></span>
  </div>
</div>
`;

/** Where the cursor's tip sits inside its SVG. */
const TIP_X = 4;
const TIP_Y = 2.5;

interface Overlay {
  host: HTMLElement;
  stage: HTMLElement;
  focus: HTMLElement;
  cursor: HTMLElement;
  text: HTMLElement;
  /** Where the cursor tip is headed, to skip the travel wait when it is already there. */
  at: { x: number; y: number } | null;
}

let overlay: Overlay | null = null;

function ensure(doc: Document): Overlay {
  if (overlay && overlay.host.isConnected && overlay.host.ownerDocument === doc) return overlay;
  const host = doc.createElement("comet-agent-overlay");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style>${HTML}`;
  doc.documentElement.append(host);
  const pick = (selector: string) => root.querySelector(selector) as HTMLElement;
  overlay = { host, stage: pick(".stage"), focus: pick(".focus"), cursor: pick(".cursor"), text: pick(".text"), at: null };
  return overlay;
}

/** Re-run a one-shot CSS animation. */
function replay(element: Element, className: string): void {
  element.classList.remove(className);
  void (element as HTMLElement).offsetWidth;
  element.classList.add(className);
}

function place(cursor: HTMLElement, x: number, y: number): void {
  cursor.style.transform = `translate(${Math.round(x - TIP_X)}px, ${Math.round(y - TIP_Y)}px)`;
}

function ripple(o: Overlay, x: number, y: number): void {
  replay(o.cursor, "press");
  for (const extra of ["", "second"]) {
    const ring = o.stage.ownerDocument.createElement("div");
    ring.className = `ripple ${extra}`.trim();
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.addEventListener("animationend", () => ring.remove());
    o.stage.append(ring);
  }
}

export function setAgentActive(doc: Document, on: boolean, label?: string): void {
  const o = ensure(doc);
  o.stage.classList.toggle("on", on);
  if (!on) {
    o.cursor.classList.remove("shown");
    o.at = null;
    return;
  }
  if (label !== undefined && label !== o.text.textContent) {
    o.text.textContent = label;
    replay(o.text, "swap");
  }
}

/** Glide the cursor to an element and outline it; clicks end in a ripple. */
export function pointAt(doc: Document, element: Element, action?: PointerAction): void {
  const o = ensure(doc);
  const view = doc.defaultView;
  const rect = element.getBoundingClientRect();
  Object.assign(o.focus.style, {
    left: `${rect.left - 4}px`,
    top: `${rect.top - 4}px`,
    width: `${rect.width + 8}px`,
    height: `${rect.height + 8}px`,
  });
  replay(o.focus, "show");
  if (!action) return;

  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (!o.cursor.classList.contains("shown")) {
    // First appearance: rise from the status pill instead of the corner.
    o.cursor.style.transition = "none";
    place(o.cursor, (view?.innerWidth ?? 800) / 2, (view?.innerHeight ?? 600) - 70);
    void o.cursor.offsetWidth;
    o.cursor.style.transition = "";
    o.cursor.classList.add("shown");
  }
  const arrived = o.at !== null && Math.abs(o.at.x - x) < 2 && Math.abs(o.at.y - y) < 2;
  o.at = { x, y };
  place(o.cursor, x, y);
  if (action === "click" || action === "select") setTimeout(() => ripple(o, x, y), arrived ? 0 : POINTER_TRAVEL_MS);
}
