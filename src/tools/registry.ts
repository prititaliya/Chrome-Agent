// Name -> ToolDef map plus argument validation. Invalid args become tool
// error observations — never executions.

import { READONLY_TOOLS, type ToolDef } from "./table";

const BY_NAME: Record<string, ToolDef> = Object.fromEntries(READONLY_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDef | undefined {
  return BY_NAME[name];
}

export function listToolNames(): string[] {
  return READONLY_TOOLS.map((t) => t.name);
}

export type ArgsVerdict = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

export function parseToolArgs(name: string, args: unknown): ArgsVerdict {
  const tool = getTool(name);
  if (!tool) return { ok: false, error: `unknown tool "${name}"` };
  const parsed = tool.argsSchema.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, args: parsed.data as Record<string, unknown> };
}
