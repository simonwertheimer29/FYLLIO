// app/api/waitlist/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { base, TABLES } from "../../../lib/airtable";

export async function PATCH(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const { id } = context.params;

  const body = await req.json().catch(() => ({}));
  const { estado, ultimoContacto } = body as { estado?: string; ultimoContacto?: string };

  if (!estado) {
    return NextResponse.json({ error: "estado required" }, { status: 400 });
  }

  const updated = await base(TABLES.waitlist).update(id, {
    Estado: estado,
    ...(ultimoContacto ? { "Último contacto": ultimoContacto } : {}),
  });

  return NextResponse.json({ ok: true, id: updated.id });
}
