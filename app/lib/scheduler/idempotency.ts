import { kv } from "@vercel/kv";

const PREFIX = "wa:seen:";

export async function isDuplicateMessage(messageSid: string): Promise<boolean> {
  if (!messageSid) return false;
  const key = PREFIX + messageSid;

  const already = await kv.get<string>(key);
  if (already) return true;

  await kv.set(key, "1", { ex: 24 * 60 * 60 }); // 24h
  return false;
}
