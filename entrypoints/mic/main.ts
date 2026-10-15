// Opened from the side panel, which can't show Chrome's permission prompt itself. Once granted
// here, the extension origin keeps the permission and the panel can record.

const root = document.getElementById("root")!;
const title = document.getElementById("title")!;
const text = document.getElementById("text")!;
const retry = document.getElementById("retry") as HTMLButtonElement;

function show(state: "ok" | "bad", heading: string, body: string) {
  root.className = state;
  title.textContent = heading;
  text.textContent = body;
}

async function ask() {
  retry.hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    show("ok", "Microphone allowed", "Go back to the side panel and tap the mic. This tab closes on its own.");
    setTimeout(() => window.close(), 1800);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotFoundError") {
      show("bad", "No microphone found", "Connect a microphone, then try again.");
    } else {
      show(
        "bad",
        "Microphone blocked",
        "Click the icon at the right of the address bar (or open chrome://settings/content/microphone), allow this extension, then try again.",
      );
    }
    retry.hidden = false;
  }
}

retry.addEventListener("click", () => void ask());
void ask();
