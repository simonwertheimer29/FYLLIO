// app/api/dashboard/sessions/route.ts
// Lists and deletes active WhatsApp sessions from Vercel KV.

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const PREFIX = "wa:sess:";

export async function GET() {
  try {
    // Scan all session keys — Upstash KV (Redis) supports KEYS/SCAN
    const keys: string[] = await kv.keys(`${PREFIX}*`);

    const sessions = await Promise.all(
      keys.map(async (key) => {
        const data = await kv.get<Record<string, unknown>>(key);
        const phone = key.replace(PREFIX, "");
        return {
          phone,
          stage: (data?.stage as string) ?? "unknown",
          treatmentName: (data?.treatmentName as string) ?? null,
          staffId: (data?.staffId as string) ?? null,
          createdAtMs: (data?.createdAtMs as number) ?? null,
          updatedAtMs: (data?.updatedAtMs as number) ?? (data?.createdAtMs as number) ?? null,
        };
      })
    );

    // Sort by most recent first
    sessions.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));

    return NextResponse.json({ sessions });
  } catch (e: any) {
    console.error("[sessions] GET error", e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone");
    if (!phone) return new NextResponse("Missing phone", { status: 400 });

    await kv.del(`${PREFIX}${phone}`);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[sessions] DELETE error", e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
