import { kv } from "@vercel/kv";

const PREFIX = "wa:seen:";
const localSeen = new Set<string>();

export async function isDuplicateMessage(messageSid: string): Promise<boolean> {
  if (!messageSid) return false;

  // 🔥 DEV MODE → usar memoria local
  if (process.env.NODE_ENV !== "production") {
    if (localSeen.has(messageSid)) return true;
    localSeen.add(messageSid);
    return false;
  }

  // 🔥 PROD → usar KV real
  try {
    const key = PREFIX + messageSid;
    const already = await kv.get<string>(key);
    if (already) return true;

    await kv.set(key, "1", { ex: 24 * 60 * 60 });
    return false;
  } catch (err) {
    console.warn("[idempotency] KV failed, fallback to memory", err);
    if (localSeen.has(messageSid)) return true;
    localSeen.add(messageSid);
    return false;
  }
}
