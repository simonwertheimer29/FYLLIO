// app/api/presupuestos/kanban/[id]/route.ts
// PATCH: actualizar campos de un presupuesto

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../../lib/airtable";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function isAuthed(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return false;
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    const fields: Record<string, unknown> = {};
    // Only write to fields that exist in the base Airtable schema
    if (body.estado !== undefined) fields["Estado"] = body.estado;
    if (body.fechaPresupuesto !== undefined) fields["Fecha"] = body.fechaPresupuesto;
    if (body.amount !== undefined) fields["Importe"] = Number(body.amount);
    if (body.treatments !== undefined) {
      fields["Tratamiento_nombre"] = Array.isArray(body.treatments)
        ? body.treatments.join(" + ")
        : body.treatments;
    }
    if (body.notes !== undefined) fields["Notas"] = body.notes;

    await base(TABLES.presupuestos as any).update(id, fields as any);
    return NextResponse.json({ ok: true });
  } catch {
    // Demo mode
    return NextResponse.json({ ok: true, demo: true });
  }
}
