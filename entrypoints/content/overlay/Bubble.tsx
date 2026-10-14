import { useEffect, useState } from "react";
import { readSelection } from "../../../src/dom/selection";

// Pure UI: no browser imports, so it stays testable without a browser.
// Quick actions and the live agent banner land in later tasks; the `active`
// prop already exists so the banner path is wired from day one.
export default function Bubble({ active = false }: { active?: boolean }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div>
      {active && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            padding: "6px 12px",
            background: "#1f2937",
            color: "#fff",
            fontSize: "13px",
            zIndex: 2147483647,
          }}
        >
          The assistant is driving this tab. Press Esc in the panel or stop the run to halt it.
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Assistant quick ask"
          style={{
            position: "fixed",
            right: "16px",
            bottom: "72px",
            width: "280px",
            padding: "12px",
            background: "#fff",
            color: "#111",
            border: "1px solid #ccc",
            borderRadius: "8px",
            fontSize: "14px",
            zIndex: 2147483647,
          }}
        >
          <p>Ask about this page. Selection quick-actions land in a later task.</p>
          <button onClick={() => setSelection(readSelection(window))}>Read selection</button>
          {selection !== null && <p>{selection === "" ? "(nothing selected)" : selection}</p>}
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
      <button
        aria-label="Open assistant"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          right: "16px",
          bottom: "16px",
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          border: "none",
          background: "#1f2937",
          color: "#fff",
          fontSize: "20px",
          cursor: "pointer",
          zIndex: 2147483647,
        }}
      >
        ✦
      </button>
    </div>
  );
}
