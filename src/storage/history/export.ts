// JSON + Markdown export and validated import. Pure serialization:
// no storage imports, so the panel can safely build export blobs.
// Redaction runs here AND at persist time — exports never carry secrets.

import { z } from "zod";
import { redactSecrets } from "../../security/redact";
import { SCHEMA_VERSION, type ThreadRecord } from "./store";
import { ulid } from "../../lib/ulid";

const envelopeSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  ts: z.number(),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  artifactRefs: z.array(z.string()).optional(),
  outcomeUnknown: z.boolean().optional(),
});

const threadSchema = z.object({
  id: z.string(),
  title: z.string(),
  titleSource: z.enum(["derived", "user"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  origin: z.string().optional(),
  pinned: z.boolean().optional(),
  messages: z.array(envelopeSchema),
  outcome: z.enum(["done", "cancelled", "budget_paused", "failed"]).optional(),
  schemaVersion: z.literal(SCHEMA_VERSION),
});

export type ImportConflict = "skip" | "copy";
export type ImportAction = "imported" | "copied" | "skipped";

function redactedCopy(thread: ThreadRecord): ThreadRecord {
  return {
    ...thread,
    messages: thread.messages.map((m) => ({ ...m, content: redactSecrets(m.content) })),
  };
}

export function toJSONThread(thread: ThreadRecord): string {
  return `${JSON.stringify({ ...redactedCopy(thread), exportedAt: new Date().toISOString() }, null, 2)}\n`;
}

export function toMarkdownThread(thread: ThreadRecord): string {
  const safe = redactedCopy(thread);
  const lines = [
    `# ${safe.title}`,
    "",
    `- thread: \`${safe.id}\``,
    `- created: ${new Date(safe.createdAt).toISOString()}`,
    `- updated: ${new Date(safe.updatedAt).toISOString()}`,
    `- outcome: ${safe.outcome ?? "open"}`,
    "",
  ];
  for (const m of safe.messages) {
    const head = m.toolName ? `## ${m.role} · tool:${m.toolName}` : `## ${m.role}`;
    lines.push(head, "", m.content, "");
    if (m.outcomeUnknown === true) lines.push("> outcome unknown — never replayed", "");
  }
  return lines.join("\n");
}

/** Zod-validated parse. Rejects unknown schemaVersion and wrong shapes. */
export function parseImportedThread(jsonText: string): ThreadRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error("import is not valid JSON");
  }
  const parsed = threadSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`import failed validation: ${parsed.error.message}`);
  return parsed.data;
}

/** Dedup by threadId: newer updatedAt wins; copy mints a new id. */
export function resolveImport(
  existing: ThreadRecord | null,
  incoming: ThreadRecord,
  onConflict: ImportConflict,
  mintId: () => string = ulid,
): { action: ImportAction; thread: ThreadRecord } {
  if (existing === null || incoming.updatedAt > existing.updatedAt) {
    return { action: "imported", thread: incoming };
  }
  if (onConflict === "copy") {
    const copy: ThreadRecord = {
      ...incoming,
      id: mintId(),
      title: `${incoming.title} (imported)`,
      messages: incoming.messages.map((m) => ({ ...m, threadId: "" })),
    };
    for (const m of copy.messages) m.threadId = copy.id;
    return { action: "copied", thread: copy };
  }
  return { action: "skipped", thread: existing };
}
