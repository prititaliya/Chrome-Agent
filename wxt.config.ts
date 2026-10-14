import { defineConfig } from "wxt";

// Single manifest source for both targets. MV3 is forced for Firefox here
// (WXT defaults Firefox to MV2); the CLI alternative is
// `wxt build -b firefox --mv3`. Never single-dash `-mv3`.
export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => {
    const permissions = ["storage", "tabs", "scripting", "alarms", "activeTab", "downloads"];
    const manifest = {
      name: "Comet-like Browser Assistant",
      permissions: [...permissions],
      // Provider API origins only. Page access is per-origin optional.
      host_permissions: ["https://openrouter.ai/*"],
      optional_host_permissions: ["http://*/*", "https://*/*"],
      action: {},
      // No manual content_scripts block: WXT generates it from
      // entrypoints/content (ISOLATED world, all_frames). A hand-written
      // block without js/css would duplicate or invalidate the manifest.
    };

    if (browser === "chrome") {
      return {
        ...manifest,
        minimum_chrome_version: "116",
        // `debugger` is declared but runtime-OFF by default (Settings toggle).
        permissions: [...manifest.permissions, "sidePanel", "offscreen", "debugger"],
        side_panel: {
          default_path: "sidepanel.html",
        },
      };
    }

    // Firefox: no debugger / sidePanel / offscreen.
    return {
      ...manifest,
      browser_specific_settings: {
        gecko: {
          id: "comet-like-assistant@example.local",
          strict_min_version: "128.0",
        },
      },
      sidebar_action: {
        default_panel: "sidepanel.html",
        default_title: "Assistant",
      },
    };
  },
});
