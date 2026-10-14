// Generation-scoped ref map (content-script side). Refs from an older
// generation resolve to E_STALE_REF — never to the wrong element. The
// background owns the generation counter and bumps it on navigation.

import type { RefEntry } from "./snapshot";

export const STALE_REF = "E_STALE_REF" as const;

export type RefResolution = { ok: true; entry: RefEntry } | { ok: false; code: typeof STALE_REF };

export class RefMap {
  private generation = -1;
  private readonly map = new Map<number, RefEntry>();

  register(refs: RefEntry[], generation: number): void {
    this.generation = generation;
    this.map.clear();
    for (const entry of refs) this.map.set(entry.ref, entry);
  }

  resolve(ref: number, generation: number): RefResolution {
    if (generation !== this.generation) return { ok: false, code: STALE_REF };
    const entry = this.map.get(ref);
    if (!entry) return { ok: false, code: STALE_REF };
    return { ok: true, entry };
  }

  currentGeneration(): number {
    return this.generation;
  }
}
