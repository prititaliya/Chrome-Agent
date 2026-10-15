// Session digests: a short, secret-free summary of each saved chat, so later
// chats can find out what happened in earlier ones. Stored only in this browser.

import { storage } from "wxt/utils/storage";

export interface SessionDigest {
  convId: string;
  title: string;
  /** When the chat was last updated at the time of the digest. */
  updatedAt: number;
  digest: string;
  keywords: string[];
  /** Length of the chat's `api` transcript the digest covers. */
  apiLength: number;
}

const digestsItem = storage.defineItem<SessionDigest[]>("local:sessions:v1", { fallback: [] });

export async function listDigests(): Promise<SessionDigest[]> {
  return digestsItem.getValue();
}

export async function getDigest(convId: string): Promise<SessionDigest | undefined> {
  return (await digestsItem.getValue()).find((d) => d.convId === convId);
}

export async function saveDigest(digest: SessionDigest): Promise<void> {
  const rest = (await digestsItem.getValue()).filter((d) => d.convId !== digest.convId);
  await digestsItem.setValue([digest, ...rest]);
}

export async function deleteDigest(convId: string): Promise<void> {
  const all = await digestsItem.getValue();
  if (all.some((d) => d.convId === convId)) await digestsItem.setValue(all.filter((d) => d.convId !== convId));
}

export async function clearDigests(): Promise<void> {
  await digestsItem.setValue([]);
}

export function watchDigests(listener: (digests: SessionDigest[]) => void): () => void {
  return digestsItem.watch((value) => listener(value ?? []));
}
