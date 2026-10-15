import { useContext, useMemo, type MouseEvent } from "react";
import { browser } from "wxt/browser";
import { chatIdFromHref, OpenChatContext } from "./chatLinks";
import { renderMarkdown } from "./sanitize";

export default function Markdown({ source, className }: { source: string; className?: string }) {
  const openChat = useContext(OpenChatContext);
  const html = useMemo(() => renderMarkdown(source), [source]);

  /** Web links open in a new browser tab, `#chat/<id>` links open that chat; the side panel itself never navigates. */
  const onLinkClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    const chatId = chatIdFromHref(href);
    if (chatId) openChat(chatId);
    else if (/^https?:\/\//i.test(href)) void browser.tabs.create({ url: href, active: !event.metaKey && !event.ctrlKey });
  };

  return <div className={className ?? "md"} onClick={onLinkClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
