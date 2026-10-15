import { createContext } from "react";

/** Opens an earlier chat from a `#chat/<id>` link in an answer. */
export const OpenChatContext = createContext<(id: string) => void>(() => undefined);

export function chatIdFromHref(href: string): string | null {
  const match = /^#chat\/([\w-]+)$/.exec(href);
  return match ? match[1]! : null;
}
