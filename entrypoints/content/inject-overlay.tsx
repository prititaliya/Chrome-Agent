import ReactDOM from "react-dom/client";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import Bubble from "./overlay/Bubble";

// Closed shadow root + inline styles only: page CSS cannot leak in or out.
// React root is created in onMount and torn down in onRemove, and the whole
// UI is removed on context invalidation (see index.ts).
export async function mountOverlay(ctx: ContentScriptContext): Promise<{ unmount: () => void }> {
  const ui = await createShadowRootUi(ctx, {
    name: "assistant-overlay",
    position: "overlay",
    mode: "closed",
    isolateEvents: true,
    onMount: (container) => {
      const root = ReactDOM.createRoot(container);
      root.render(<Bubble />);
      return root;
    },
    onRemove: (root) => root?.unmount(),
  });
  ui.mount();
  return {
    unmount: () => ui.remove(),
  };
}
