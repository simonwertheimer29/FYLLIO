// app/api/waitlist/[id]/route.ts
import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";

const ALLOWED = new Set(["Esperando", "Contactado", "Aceptado", "Expirado"]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const estado = String(body?.estado ?? "").trim();
    const ultimoContactoRaw = body?.ultimoContacto;

    if (!estado) {
      return NextResponse.json({ error: "estado required" }, { status: 400 });
    }

    if (!ALLOWED.has(estado)) {
      return NextResponse.json(
        { error: `estado inválido. Usa: ${Array.from(ALLOWED).join(", ")}` },
        { status: 400 }
      );
    }

    // Si pasan a Contactado y no viene ultimoContacto -> set automático
    const ultimoContacto =
      typeof ultimoContactoRaw === "string" && ultimoContactoRaw.trim()
        ? ultimoContactoRaw
        : estado === "Contactado"
        ? new Date().toISOString()
        : undefined;

    const fields: Record<string, any> = {
      Estado: estado,
      ...(ultimoContacto ? { "Último contacto": ultimoContacto } : {}),
    };

    const updated = await base(TABLES.waitlist).update(params.id, fields);

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "PATCH failed" }, { status: 500 });
  }
}
