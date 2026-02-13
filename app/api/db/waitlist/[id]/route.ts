import { NextRequest, NextResponse } from "next/server";
import { updateWaitlistEntry } from "../../../../lib/scheduler/repo/waitlistRepo";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) return new NextResponse("Missing id", { status: 400 });

    const body = await req.json().catch(() => ({}));

    const estado = body?.estado ? String(body.estado) : undefined;
    const ultimoContacto = body?.ultimoContacto ? String(body.ultimoContacto) : undefined;

    await updateWaitlistEntry({
      waitlistRecordId: id,
      patch: { estado, ultimoContacto },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
