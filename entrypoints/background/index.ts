import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { PENDING_PROMPT_KEY, type PendingPrompt } from "../../src/storage/pending";

const MENU_ASK_SELECTION = "comet-ask-selection";
const MENU_SUMMARIZE = "comet-summarize-page";

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  browser.runtime.onInstalled.addListener(() => {
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_ASK_SELECTION,
        title: 'Ask Comet about "%s"',
        contexts: ["selection"],
      });
      browser.contextMenus.create({
        id: MENU_SUMMARIZE,
        title: "Summarize this page with Comet",
        contexts: ["page"],
      });
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    // sidePanel.open must run synchronously inside the user gesture.
    if (tab?.windowId !== undefined) void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    const prompt: PendingPrompt | null =
      info.menuItemId === MENU_ASK_SELECTION && info.selectionText
        ? { text: `Explain this:\n\n"${info.selectionText}"`, at: Date.now() }
        : info.menuItemId === MENU_SUMMARIZE
          ? { text: "Summarize this page.", at: Date.now() }
          : null;
    if (prompt) void browser.storage.session.set({ [PENDING_PROMPT_KEY]: prompt });
  });
});
