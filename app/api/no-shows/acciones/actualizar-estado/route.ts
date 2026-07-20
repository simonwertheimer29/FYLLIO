// app/api/no-shows/acciones/actualizar-estado/route.ts
// POST: actualiza el campo Estado de una cita en Airtable
// Body: { recordId: string, estado: "Confirmado" | "Cancelado" }
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { updateCitaEstado } from "../../../../lib/scheduler/repo/airtableRepo";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { base, TABLES } from "../../../../lib/airtable";
import { legacyJwtSecret } from "@/lib/auth/legacy-secret";

const COOKIE = "fyllio_noshows_token";
const secret = legacyJwtSecret();

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

    const { recordId, estado } = await req.json() as { recordId: string; estado: string };
    if (!recordId) return NextResponse.json({ error: "recordId requerido" }, { status: 400 });
    if (!["Confirmado", "Cancelado"].includes(estado)) {
      return NextResponse.json({ error: "estado debe ser Confirmado o Cancelado" }, { status: 400 });
    }

    // FASE 1 migración: escritura via repo del dominio Agenda.
    await updateCitaEstado(recordId, estado);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[acciones/actualizar-estado] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
