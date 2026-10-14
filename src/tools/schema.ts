// Shared Zod primitives for tool params. Per-tool schemas live in table.ts.

import { z } from "zod";

/** Raw tab id. Symbolic t1..tn aliases land with the multi-tab task. */
export const tabSchema = z.number().int().nonnegative().optional();

/** Integer ref previously issued to the model ([e12] -> 12). */
export const refSchema = z.number().int().positive();

export const modeSchema = z.enum(["markdown", "text"]);

export const extractKindSchema = z.enum(["table", "list", "links", "forms", "metadata"]);
