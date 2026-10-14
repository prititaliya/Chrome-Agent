// Provider API keys. Write-only by design:
// - stored in `storage.local` under `key:v1:{providerId}` — never `sync`
//   (sync would upload secrets to the browser-vendor account), never
//   `session` (session is readable from more contexts).
// - the UI may check presence (hasKey) but can never read a value back.
// - only the background entrypoint reads values, to call provider APIs.
import { storage } from "wxt/utils/storage";

export function keyStorageKey(providerId: string): `local:key:v1:${string}` {
  return `local:key:v1:${providerId}`;
}

export async function saveKey(providerId: string, key: string): Promise<void> {
  const value = key.trim();
  const item = storage.defineItem<string>(keyStorageKey(providerId));
  if (value === "") {
    await item.removeValue();
    return;
  }
  await item.setValue(value);
}

export async function deleteKey(providerId: string): Promise<void> {
  await storage.defineItem<string>(keyStorageKey(providerId)).removeValue();
}

/** Presence check for the UI. Returns true when a key is stored, never the key. */
export async function hasKey(providerId: string): Promise<boolean> {
  return (await storage.defineItem<string>(keyStorageKey(providerId)).getValue()) !== null;
}

/**
 * Background-only read. The background needs the secret to call provider
 * APIs; UI modules must never import this (asserted by the single-writer
 * test in a later task).
 */
export async function readKey(providerId: string): Promise<string | null> {
  return await storage.defineItem<string>(keyStorageKey(providerId)).getValue();
}
