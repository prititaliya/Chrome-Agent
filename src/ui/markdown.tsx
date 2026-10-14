import { useMemo, type MouseEvent } from "react";
import { browser } from "wxt/browser";
import { renderMarkdown } from "./sanitize";

/** Links open in a new browser tab; the side panel itself never navigates. */
function onLinkClick(event: MouseEvent<HTMLDivElement>) {
  const anchor = (event.target as HTMLElement).closest("a");
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute("href") ?? "";
  if (/^https?:\/\//i.test(href)) void browser.tabs.create({ url: href, active: !event.metaKey && !event.ctrlKey });
}

export default function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className={className ?? "md"} onClick={onLinkClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
