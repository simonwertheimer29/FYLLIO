// app/lib/scheduler/sessionStore.ts
import { kv } from "@vercel/kv";

export type StoredSession<T> = T & { createdAtMs: number };

const PREFIX = "wa:sess:";

export async function getSession<T>(key: string): Promise<StoredSession<T> | null> {
  const v = await kv.get<StoredSession<T>>(PREFIX + key);
  return v ?? null;
}

export async function setSession<T>(
  key: string,
  value: StoredSession<T>,
  ttlSeconds: number
) {
  await kv.set(PREFIX + key, value, { ex: ttlSeconds });
}

export async function deleteSession(key: string) {
  await kv.del(PREFIX + key);
}
