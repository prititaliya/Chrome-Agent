import type { ToolSchema } from "../providers/types";

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required };
}

const tabId = { type: "integer", description: "Tab id from list_tabs or page_context. Defaults to the tab you are working in." };
const ref = { type: "integer", description: "Element ref number from the latest snapshot, e.g. 12 for [12]." };

export const TOOLS: ToolSchema[] = [
  {
    name: "get_page_text",
    description: "Read the readable text of a tab (article text or visible text). Use for questions about page content beyond what was attached.",
    parameters: schema({ tab_id: tabId, max_chars: { type: "integer", description: "Default 15000, max 40000." } }),
  },
  {
    name: "snapshot",
    description:
      "List the visible interactive elements of a tab with ref numbers ([12] button \"Sign in\"), plus headings. The working tab's elements are already in page_context at the start of a turn; call this after the page changes or for other tabs.",
    parameters: schema({ tab_id: tabId }),
  },
  {
    name: "find_text",
    description: "Find occurrences of text on a page and return the surrounding context.",
    parameters: schema({ query: { type: "string" }, tab_id: tabId }, ["query"]),
  },
  {
    name: "extract",
    description: "Extract structured data from a page as JSON: the first table, the first list, all links, forms, or metadata.",
    parameters: schema(
      { kind: { type: "string", enum: ["table", "list", "links", "forms", "metadata"] }, tab_id: tabId },
      ["kind"],
    ),
  },
  {
    name: "screenshot",
    description: "Capture the visible part of a tab as an image so you can see layout, images, and charts.",
    parameters: schema({ tab_id: tabId }),
  },
  {
    name: "click",
    description: "Click an element by ref.",
    parameters: schema({ ref, double: { type: "boolean", description: "Double-click." }, tab_id: tabId }, ["ref"]),
  },
  {
    name: "type",
    description: "Type text into an input, textarea, or editable element by ref. Replaces existing text unless clear=false. Set submit=true to press Enter afterwards (e.g. search boxes).",
    parameters: schema(
      {
        ref,
        text: { type: "string" },
        submit: { type: "boolean" },
        clear: { type: "boolean", description: "Clear the field first (default true)." },
        tab_id: tabId,
      },
      ["ref", "text"],
    ),
  },
  {
    name: "select_option",
    description: "Choose an option in a native <select> dropdown by its visible text or value.",
    parameters: schema({ ref, value: { type: "string" }, tab_id: tabId }, ["ref", "value"]),
  },
  {
    name: "press_key",
    description: "Press a key or combination on the focused element, e.g. Enter, Escape, Tab, ArrowDown, Control+a.",
    parameters: schema({ key: { type: "string" }, tab_id: tabId }, ["key"]),
  },
  {
    name: "scroll",
    description: "Scroll the page (or a scrollable element by ref) up, down, to the top, or to the bottom.",
    parameters: schema(
      {
        direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
        ref: { ...ref, description: "Optional scrollable container ref." },
        amount: { type: "integer", description: "Pixels; defaults to one screen." },
        tab_id: tabId,
      },
      ["direction"],
    ),
  },
  {
    name: "hover",
    description: "Move the mouse over an element by ref (opens hover menus and tooltips).",
    parameters: schema({ ref, tab_id: tabId }, ["ref"]),
  },
  {
    name: "wait",
    description: "Wait for some text to appear on the page, or for a number of seconds (max 10).",
    parameters: schema({ text: { type: "string" }, seconds: { type: "number" }, tab_id: tabId }),
  },
  {
    name: "navigate",
    description: "Load a URL in the tab you are working in (or tab_id).",
    parameters: schema({ url: { type: "string" }, tab_id: tabId }, ["url"]),
  },
  {
    name: "go_back",
    description: "Go back to the previous page in the tab's history.",
    parameters: schema({ tab_id: tabId }),
  },
  {
    name: "list_tabs",
    description: "List the open tabs in this window with their ids, titles, and URLs.",
    parameters: schema({}),
  },
  {
    name: "open_tab",
    description:
      "Open a URL in a new tab, only when the user wants a new tab or the current page must stay open. Otherwise use navigate or click links in the working tab. With active=true (default) it becomes the tab you work in.",
    parameters: schema({ url: { type: "string" }, active: { type: "boolean" } }, ["url"]),
  },
  {
    name: "switch_tab",
    description: "Bring a tab to the front and work in it.",
    parameters: schema({ tab_id: { type: "integer" } }, ["tab_id"]),
  },
  {
    name: "close_tab",
    description: "Close a tab.",
    parameters: schema({ tab_id: { type: "integer" } }, ["tab_id"]),
  },
  {
    name: "read_tab",
    description: "Read the text of another open tab without switching to it.",
    parameters: schema({ tab_id: { type: "integer" }, max_chars: { type: "integer" } }, ["tab_id"]),
  },
  {
    name: "read_url",
    description: "Open a URL in a hidden background tab, read its text, and close it. Ideal for reading search results.",
    parameters: schema({ url: { type: "string" }, max_chars: { type: "integer" } }, ["url"]),
  },
  {
    name: "web_search",
    description:
      "Search the web and return the top results (title, URL, snippet). Only for information not available on the current site; use the site's own search box for things on it.",
    parameters: schema({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "get_my_email",
    description: "Get the user's email address (their Chrome profile and the Gmail account signed in to this browser), e.g. to fill a sign-in form.",
    parameters: schema({}),
  },
  {
    name: "use_saved_password",
    description:
      "Sign in with the login Chrome has saved for this site: clicks the username or password field (by ref) and picks Chrome's saved-login suggestion. The password is filled by Chrome and never shown to you. Reports whether it worked.",
    parameters: schema({ ref: { ...ref, description: "Ref of the username/email or password field." }, tab_id: tabId }, ["ref"]),
  },
  {
    name: "get_email_code",
    description:
      "Find a verification / one-time code that a site just emailed to the user, by checking their unread Gmail. Waits for the email to arrive. Returns only the code, sender and subject.",
    parameters: schema({
      from: { type: "string", description: "Site or sender name to match, e.g. \"github\" or \"amazon.in\"." },
      wait_seconds: { type: "integer", description: "How long to wait for the email to arrive. Default 30, max 90." },
      max_age_minutes: { type: "integer", description: "Ignore emails older than this. Default 10." },
    }),
  },
];

export const MEMORY_TOOLS: ToolSchema[] = [
  {
    name: "remember",
    description:
      "Save a lasting fact, preference, or standing instruction about the user to long-term memory (kept across chats). One short third-person sentence. Use replaces_id to update an existing memory.",
    parameters: schema(
      {
        text: { type: "string", description: 'e.g. "User lives in Ahmedabad and prefers prices in INR."' },
        replaces_id: { type: "string", description: "Id of a memory this one corrects or updates, e.g. m3k9a1b." },
      },
      ["text"],
    ),
  },
  {
    name: "forget",
    description: "Delete a memory by id (from <memory> or recall) when the user asks you to forget it or it is no longer true.",
    parameters: schema({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "recall",
    description: "Search long-term memory for saved facts about the user that are not shown in <memory>.",
    parameters: schema({ query: { type: "string" } }, ["query"]),
  },
];

export function toolsFor(options: { vision: boolean; screenshots: boolean; memory?: boolean }): ToolSchema[] {
  const browserTools = TOOLS.filter((t) => t.name !== "screenshot" || (options.vision && options.screenshots));
  return options.memory ? [...browserTools, ...MEMORY_TOOLS] : browserTools;
}
