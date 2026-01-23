// app/api/waitlist/[id]/route.ts
import { NextResponse } from "next/server";
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

    const updated = await base(TABLES.waitlist).update(id, {
      Estado: estado,
      ...(ultimoContacto ? { "Último contacto": ultimoContacto } : {}),
    });

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to update waitlist" },
      { status: 500 }
    );
  }
}
