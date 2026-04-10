// app/api/no-shows/agenda/[id]/mover/route.ts
// PATCH: actualiza hora inicio/fin de una cita, o su estado (confirmar/no-show)
// Body: { startIso?, endIso?, estado? }
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES } from "../../../../../lib/airtable";
import type { NoShowsUserSession } from "../../../../../lib/no-shows/types";
import { ZONE } from "../../../../../lib/no-shows/score";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession(): Promise<NoShowsUserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as NoShowsUserSession;
  } catch { return null; }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { startIso, endIso, estado } = body as {
      startIso?: string;
      endIso?: string;
      estado?: string;
    };

    const fields: Record<string, unknown> = {};

    if (startIso && endIso) {
      const startDt = DateTime.fromISO(startIso, { zone: ZONE });
      const endDt   = DateTime.fromISO(endIso,   { zone: ZONE });
      if (!startDt.isValid || !endDt.isValid) {
        return NextResponse.json({ error: "Fechas inválidas" }, { status: 400 });
      }
      if (endDt <= startDt) {
        return NextResponse.json({ error: "Hora final debe ser posterior al inicio" }, { status: 400 });
      }
      fields["Hora inicio"] = startDt.toUTC().toISO();
      fields["Hora final"]  = endDt.toUTC().toISO();
    }

    if (estado) {
      fields["Estado"] = estado;
    }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }

    await base(TABLES.appointments as any).update(id, fields as any);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[agenda/mover] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
