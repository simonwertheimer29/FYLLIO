// app/api/no-shows/acciones/actualizar-estado/route.ts
// POST: actualiza el campo Estado de una cita en Airtable
// Body: { recordId: string, estado: "Confirmado" | "Cancelado" }
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

    const { recordId, estado } = await req.json() as { recordId: string; estado: string };
    if (!recordId) return NextResponse.json({ error: "recordId requerido" }, { status: 400 });
    if (!["Confirmado", "Cancelado"].includes(estado)) {
      return NextResponse.json({ error: "estado debe ser Confirmado o Cancelado" }, { status: 400 });
    }

    await (base(TABLES.appointments as any) as any).update(recordId, { Estado: estado });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[acciones/actualizar-estado] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
