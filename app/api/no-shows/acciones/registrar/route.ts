// app/api/no-shows/acciones/registrar/route.ts
// POST: registra una acción sobre una cita (actualiza 4 campos en Airtable)
// Body: { recordId: string, tipo: string, fase: string, notas: string }
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { base, TABLES } from "../../../../lib/airtable";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { recordId, tipo, fase, notas } = await req.json();
    if (!recordId) return NextResponse.json({ error: "recordId requerido" }, { status: 400 });

    const todayIso = new Date().toISOString().slice(0, 10);

    const fields: Record<string, string> = {
      Ultima_accion: todayIso,
    };
    if (tipo)  fields["Tipo_ultima_accion"] = tipo;
    if (fase)  fields["Fase_recordatorio"]  = fase;
    if (notas) fields["Notas_accion"]       = notas;

    await (base(TABLES.appointments as any) as any).update(recordId, fields);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[acciones/registrar] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
