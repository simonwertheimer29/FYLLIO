// app/api/no-shows/motor/accion/route.ts
// Sprint 18 Bloque 18.4 — POST de acciones del motor de no-shows desde la UI.
// Body: { citaId, accion } con
//   accion ∈ "programar_llamada_ia" | "enviar_plantilla_recordatorio"
//          | "marcar_contactado" | "considerar_overbooking"
// Llama aplicarAccionNoShow({ citaId, accion, manual:true }) y devuelve
// { ok, motivo?, detalle? }.
//
// Auth idéntica a riesgo/route.ts: cookie fyllio_noshows_token (jose jwtVerify).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import type { NoShowsUserSession } from "../../../../lib/no-shows/types";
import {
  aplicarAccionNoShow,
  type AccionNoShowTipo,
} from "../../../../lib/no-shows/acciones";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

const ACCIONES_VALIDAS = new Set<AccionNoShowTipo>([
  "programar_llamada_ia",
  "enviar_plantilla_recordatorio",
  "marcar_contactado",
  "considerar_overbooking",
]);

async function getSession(): Promise<NoShowsUserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as NoShowsUserSession;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    let body: { citaId?: string; accion?: string; plantillaNombre?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, motivo: "body_invalido" }, { status: 400 });
    }

    const citaId = typeof body.citaId === "string" ? body.citaId.trim() : "";
    const accion = body.accion as AccionNoShowTipo | undefined;

    if (!citaId) {
      return NextResponse.json({ ok: false, motivo: "cita_id_requerido" }, { status: 400 });
    }
    if (!accion || !ACCIONES_VALIDAS.has(accion)) {
      return NextResponse.json({ ok: false, motivo: "accion_invalida" }, { status: 400 });
    }

    const result = await aplicarAccionNoShow({
      citaId,
      accion,
      manual: true,
      plantillaNombre: typeof body.plantillaNombre === "string" ? body.plantillaNombre : undefined,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[no-shows/motor/accion] error", e);
    return NextResponse.json({ ok: false, motivo: "error", detalle: e?.message }, { status: 500 });
  }
}
