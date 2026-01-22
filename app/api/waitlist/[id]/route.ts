import { NextResponse, type NextRequest } from "next/server";
import { base, TABLES } from "../../../lib/airtable";

export async function PATCH(req: NextRequest, context: any) {
  const params = await Promise.resolve(context?.params);
  const id = params?.id as string;

  const body = await req.json().catch(() => ({}));
  const { estado, ultimoContacto } = body as { estado?: string; ultimoContacto?: string };

  if (!estado) return NextResponse.json({ error: "estado required" }, { status: 400 });

  const updated = await base(TABLES.waitlist).update(id, {
    Estado: estado,
    ...(ultimoContacto ? { "Último contacto": ultimoContacto } : {}),
  });

  return NextResponse.json({ ok: true, id: updated.id });
}
