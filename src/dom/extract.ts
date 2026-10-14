// Structured extraction: tables/lists/links/forms/metadata as JSON.
// Never returns DOM — the model reasons over data, not markup.

export type ExtractKind = "table" | "list" | "links" | "forms" | "metadata";

function cellText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

export function extractTable(table: HTMLTableElement): TableData {
  const headerCells = [...table.querySelectorAll("thead th")];
  const headers =
    headerCells.length > 0
      ? headerCells.map(cellText)
      : [...(table.querySelector("tr")?.querySelectorAll("th, td") ?? [])].map(cellText);
  const bodyRows = [...table.querySelectorAll("tbody tr")];
  const rows = (
    bodyRows.length > 0 ? bodyRows : [...table.querySelectorAll("tr")].slice(headerCells.length > 0 ? 0 : 1)
  ).map((tr) => [...tr.querySelectorAll("td, th")].map(cellText));
  return { headers, rows };
}

export function extractList(list: HTMLOListElement | HTMLUListElement): string[] {
  return [...list.querySelectorAll(":scope > li")].map(cellText);
}

export interface LinkData {
  text: string;
  href: string;
}

export function extractLinks(root: ParentNode): LinkData[] {
  const scope = root instanceof Document ? root.documentElement : root;
  return [...scope.querySelectorAll("a[href]")].map((a) => ({
    text: cellText(a).slice(0, 120),
    href: (a as HTMLAnchorElement).href,
  }));
}

export interface FormData {
  action: string;
  method: string;
  fields: { name: string; type: string }[];
}

export function extractForms(root: ParentNode): FormData[] {
  const scope = root instanceof Document ? root.documentElement : root;
  return [...scope.querySelectorAll("form")].map((form) => ({
    action: form.getAttribute("action") ?? "",
    method: (form.getAttribute("method") ?? "get").toLowerCase(),
    fields: [...form.querySelectorAll("input, select, textarea")].map((field) => ({
      name: field.getAttribute("name") ?? "",
      type: field.getAttribute("type") ?? field.tagName.toLowerCase(),
    })),
  }));
}

export interface Metadata {
  title: string;
  description: string;
  headings: string[];
}

export function extractMetadata(doc: Document): Metadata {
  return {
    title: doc.title,
    description: doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    headings: [...doc.querySelectorAll("h1, h2")].map((h) => cellText(h).slice(0, 120)),
  };
}

/** Extract `kind` from the document, or scoped to `scope` when given. */
export function extractFromRoot(root: ParentNode, kind: ExtractKind, scope?: Element): unknown {
  const context: ParentNode = scope ?? root;
  const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root.ownerDocument;
  switch (kind) {
    case "table": {
      const table = (
        scope?.tagName.toLowerCase() === "table" ? scope : context.querySelector("table")
      ) as HTMLTableElement | null;
      if (!table) throw new Error("no table found");
      return extractTable(table);
    }
    case "list": {
      const list = context.querySelector("ul, ol") as HTMLOListElement | HTMLUListElement | null;
      if (!list) throw new Error("no list found");
      return extractList(list);
    }
    case "links":
      return extractLinks(context);
    case "forms":
      return extractForms(context);
    case "metadata": {
      if (!doc) throw new Error("no document for metadata");
      return extractMetadata(doc);
    }
  }
}
