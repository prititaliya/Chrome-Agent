// Single declaration site for v1 tools (read-only class). Each entry carries
// the model-facing JSON schema, the Zod validator, and the gate class.
// Mutation tools land with the control-loop task; the gate reads policyClass.

import { z } from "zod";
import { extractKindSchema, modeSchema, refSchema, tabSchema } from "./schema";

export type PolicyClass = "read" | "mutate" | "irreversible";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  argsSchema: z.ZodType;
  policyClass: PolicyClass;
}

const snapshotParams = z.object({
  tab: tabSchema,
  interactiveOnly: z.boolean().optional(),
  maxChars: z.number().positive().max(50_000).optional(),
});

const readTextParams = z.object({
  tab: tabSchema,
  ref: refSchema.optional(),
  mode: modeSchema,
  maxChars: z.number().positive().max(50_000).optional(),
});

const selectionParams = z.object({});

const extractParams = z.object({
  tab: tabSchema,
  ref: refSchema.optional(),
  kind: extractKindSchema,
  limit: z.number().positive().max(1000).optional(),
});

function jsonSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

export const READONLY_TOOLS: ToolDef[] = [
  {
    name: "browser_snapshot",
    description: "AX-style outline of the page with stable integer refs. Call first on any new page.",
    parameters: jsonSchema({
      tab: { type: "integer", description: "Tab id; defaults to the active tab." },
      interactiveOnly: { type: "boolean" },
      maxChars: { type: "integer" },
    }),
    argsSchema: snapshotParams,
    policyClass: "read",
  },
  {
    name: "browser_read_text",
    description: "Readable text or Markdown of the page or one ref element.",
    parameters: jsonSchema(
      {
        tab: { type: "integer" },
        ref: { type: "integer", description: "Element ref from a snapshot." },
        mode: { type: "string", enum: ["markdown", "text"] },
        maxChars: { type: "integer" },
      },
      ["mode"],
    ),
    argsSchema: readTextParams,
    policyClass: "read",
  },
  {
    name: "read_selection",
    description: "The user's currently highlighted text (or nothing selected).",
    parameters: jsonSchema({}),
    argsSchema: selectionParams,
    policyClass: "read",
  },
  {
    name: "browser_extract",
    description: "Structured JSON (table rows, lists, links, forms, metadata). Never returns DOM.",
    parameters: jsonSchema(
      {
        tab: { type: "integer" },
        ref: { type: "integer" },
        kind: { type: "string", enum: ["table", "list", "links", "forms", "metadata"] },
        limit: { type: "integer" },
      },
      ["kind"],
    ),
    argsSchema: extractParams,
    policyClass: "read",
  },
];

export function toolSchemasForProvider(): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}[] {
  return READONLY_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
