// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/ui/sanitize";

describe("markdown sanitizer", () => {
  it("renders markdown formatting", () => {
    expect(renderMarkdown("**bold** and `code`")).toContain("<strong>bold</strong>");
  });

  it("strips script tags", () => {
    expect(renderMarkdown('hello<script>alert("xss")</script>world')).not.toContain("<script>");
  });

  it("strips event-handler attributes", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("neutralizes javascript: links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("strips forbidden structural tags but keeps their text", () => {
    const html = renderMarkdown('<form action="/steal"><button>go</button></form>done');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).toContain("done");
  });

  it("strips style attributes", () => {
    const html = renderMarkdown('<p style="color:expression(alert(1))">x</p>');
    expect(html).not.toContain("style=");
  });
});
