// app/api/waitlist/[id]/route.ts
import { NextResponse } from "next/server";
import { updateWaitlistEstado } from "../../../lib/scheduler/repo/waitlistRepo";
import { base, TABLES } from "../../../lib/airtable";

type ParamsPromise = Promise<{ id: string }>;

export async function PATCH(req: Request, { params }: { params: ParamsPromise }) {
  try {
    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const { estado, ultimoContacto } = body as {
      estado?: string;
      ultimoContacto?: string;
    };

    if (!estado) {
      return NextResponse.json({ error: "estado required" }, { status: 400 });
    }

    // FASE 1 migración: escritura via repo del dominio Agenda.
    const updated = await updateWaitlistEstado(id, estado, ultimoContacto);

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to update waitlist" },
      { status: 500 }
    );
  }
}
