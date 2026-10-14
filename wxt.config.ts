import { defineConfig } from "wxt";

// Chrome-only MV3 build. `<all_urls>` host access covers every page the agent
// reads or drives and any provider base URL the user configures.
export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Comet Assistant",
    description: "AI assistant in your side panel that reads, searches, and drives your browser.",
    minimum_chrome_version: "116",
    permissions: [
      "storage",
      "unlimitedStorage",
      "tabs",
      "scripting",
      "sidePanel",
      "debugger",
      "contextMenus",
      "activeTab",
    ],
    host_permissions: ["<all_urls>"],
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    action: {
      default_title: "Open Comet Assistant",
      default_icon: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    },
    side_panel: { default_path: "sidepanel.html" },
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+A", mac: "Alt+A" },
        description: "Open the assistant side panel",
      },
    },
  },
});
