// app/api/db/waitlist/[id]/route.ts
import { NextResponse } from "next/server";
import { updateWaitlistEntry } from "../../../../lib/scheduler/repo/waitlistRepo";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    if (!id) return new NextResponse("Missing id", { status: 400 });

    const body = await req.json().catch(() => ({}));

    // Normaliza lo que manda el UI
    const estado = body?.estado ? String(body.estado) : undefined;
    const ultimoContacto = body?.ultimoContacto ? String(body.ultimoContacto) : undefined;

    await updateWaitlistEntry({
      waitlistRecordId: id,
      patch: {
        estado,
        ultimoContacto,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
