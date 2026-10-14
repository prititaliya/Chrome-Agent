import { useMemo } from "react";
import { renderMarkdown } from "./sanitize";

export default function Markdown({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
