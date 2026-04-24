// app/api/admin/clinicas/route.ts
// Sprint 7 Fase 6 — listar y crear clínicas.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth/session";
import { listClinicas } from "../../../lib/auth/users";
import { base, TABLES } from "../../../lib/airtable";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => {
  const clinicas = await listClinicas();
  return NextResponse.json({ clinicas });
});

export const POST = withAdmin(async (_session, req) => {
  const body = (await req.json().catch(() => null)) as {
    nombre?: string;
    ciudad?: string;
    telefono?: string;
  } | null;
  const nombre = (body?.nombre ?? "").trim();
  if (!nombre) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }
  const fields: Record<string, any> = {
    Nombre: nombre,
    Activa: true,
  };
  if (body?.ciudad) fields["Ciudad"] = body.ciudad.trim();
  if (body?.telefono) fields["Telefono"] = body.telefono.trim();

  const created = (await base(TABLES.clinics).create([{ fields }]))[0]!;
  const f = created.fields ?? {};
  return NextResponse.json({
    clinica: {
      id: created.id,
      nombre: String(f["Nombre"] ?? ""),
      ciudad: f["Ciudad"] ? String(f["Ciudad"]) : null,
      telefono: f["Telefono"] ? String(f["Telefono"]) : null,
      activa: Boolean(f["Activa"] ?? false),
    },
  });
});
