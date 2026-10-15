import { defineConfig } from "wxt";

// Shared permissions both engines need. Justifications live in store/listing.md.
// - storage: settings/keys/history (local-only)
// - tabs+scripting+activeTab: snapshot/drive pages via content bridge
// - contextMenus: selection quick-actions ("ask selection")
// - identity: optional profile email for model attribution (executor.ts), never synced
// - debugger (Chrome only): trusted-input escape hatch, OFF by default (cdp.ts)
// host_permissions <all_urls> covers fixture/user pages + user-configured provider base URLs.
const SHARED_PERMISSIONS = ["storage", "tabs", "scripting", "activeTab", "contextMenus", "identity"] as const;

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: (env) => {
    const base = {
      name: "UnComet Assistant",
      description: "AI assistant in your side panel that reads, searches, and drives your browser.",
      permissions: [...SHARED_PERMISSIONS],
      host_permissions: ["<all_urls>"],
      icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
      action: {
        default_title: "Open UnComet Assistant",
        default_icon: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
      },
      commands: {
        _execute_action: {
          suggested_key: { default: "Alt+A", mac: "Alt+A" },
          description: "Open the assistant side panel",
        },
      },
    } as const;

    if (env.browser === "firefox") {
      return {
        ...base,
        sidebar_action: {
          default_title: "UnComet Assistant",
          default_panel: "sidepanel.html",
          default_icon: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
        },
        browser_specific_settings: {
          // AMO (since Nov 2025) requires data_collection_permissions for new submissions.
          // Honest declaration: page text (websiteContent) + user prompts/queries (searchTerms)
          // are sent to the user's OWN configured provider on every agent run. Nothing else
          // leaves the browser (keys/history stay in storage.local). See docs/PRIVACY.md.
          gecko: {
            id: "uncomet-assistant@example.com",
            data_collection_permissions: { required: ["websiteContent", "searchTerms"] },
            strict_min_version: "140.0",
          },
        },
      };
    }

    // Chrome
    return {
      ...base,
      minimum_chrome_version: "116",
      permissions: [...SHARED_PERMISSIONS, "sidePanel", "debugger", "downloads"],
      side_panel: { default_path: "sidepanel.html" },
    };
  },
});
