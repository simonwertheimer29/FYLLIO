// app/api/admin/clinicas/[id]/route.ts
// Sprint 7 Fase 6 — actualizar una clínica (renombrar, cambiar ciudad,
// teléfono, activar/desactivar).

import { NextResponse } from "next/server";
import { withAdmin } from "../../../../lib/auth/session";
import { base, TABLES } from "../../../../lib/airtable";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAdmin<Ctx>(async (_session, req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    nombre?: string;
    ciudad?: string | null;
    telefono?: string | null;
    activa?: boolean;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const fields: Record<string, any> = {};
  if (typeof body.nombre === "string" && body.nombre.trim()) fields["Nombre"] = body.nombre.trim();
  if (body.ciudad !== undefined) fields["Ciudad"] = body.ciudad ?? "";
  if (body.telefono !== undefined) fields["Telefono"] = body.telefono ?? "";
  if (typeof body.activa === "boolean") fields["Activa"] = body.activa;

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  try {
    const updated = (await base(TABLES.clinics).update([{ id, fields }]))[0]!;
    const f = updated.fields ?? {};
    return NextResponse.json({
      clinica: {
        id: updated.id,
        nombre: String(f["Nombre"] ?? ""),
        ciudad: f["Ciudad"] ? String(f["Ciudad"]) : null,
        telefono: f["Telefono"] ? String(f["Telefono"]) : null,
        activa: Boolean(f["Activa"] ?? false),
      },
    });
  } catch {
    return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  }
});
