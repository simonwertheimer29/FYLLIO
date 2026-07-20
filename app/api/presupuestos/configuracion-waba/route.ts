// app/api/presupuestos/configuracion-waba/route.ts
// GET  → estado operativo de WABA (sin credenciales).
// POST → { activoParaClinica: boolean } (solo acepta ese campo).
//
// NUNCA devuelve el Access Token ni siquiera parcialmente.

import { findConfigWABAPorClinicaRaw, updateConfigWABARaw, createConfigWABARaw } from "../../../lib/presupuestos/waba-credentials";
import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { hasWABACredentials, getWABACredentials } from "../../../lib/presupuestos/waba-credentials";
import type { UserSession } from "../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { nombresClinicasPermitidas, permiteClinica } from "../../../lib/presupuestos/clinica-scope";

export const dynamic = "force-dynamic";

const GRAPH_API_VERSION = "v21.0";

// Sprint B Fase 4 — clínica efectiva sobre la que operar, acotada a las permitidas
// de la sesión (IDs). Una clínica pedida que no esté permitida se descarta (null):
// evita leer/escribir la config de otra clínica. Antes se resolvía por
// `session.clinica` (nombre, hoy null) y el filtro no aislaba nada.
async function clinicaEfectiva(
  session: UserSession,
  requested: string | null,
): Promise<string | null> {
  const permitidas = await nombresClinicasPermitidas(session);
  if (requested) return permiteClinica(permitidas, requested) ? requested : null;
  if (permitidas && permitidas.size === 1) return [...permitidas][0]!;
  return null;
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export const GET = withPresupuestosAuth(async (session, req: Request) => {

  const { searchParams } = new URL(req.url);
  const clinica = await clinicaEfectiva(session, searchParams.get("clinica"));

  const credencialesConfiguradas = hasWABACredentials();

  let numeroConectado: string | undefined;
  let tokenExpirado = false;

  if (credencialesConfiguradas) {
    try {
      const { phoneNumberId, accessToken } = getWABACredentials();
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.ok) {
        const data = (await res.json()) as { display_phone_number?: string };
        if (data.display_phone_number) numeroConectado = data.display_phone_number;
      } else if (res.status === 401) {
        tokenExpirado = true;
      }
    } catch {
      // Ignorar; el probe es opcional.
    }
  }

  let activoParaClinica = false;
  let ultimoMensajeEnviado: string | undefined;
  let ultimoMensajeRecibido: string | undefined;

  if (clinica && process.env.AIRTABLE_API_KEY) {
    try {
      const rec0 = await findConfigWABAPorClinicaRaw(clinica);
      const recs = rec0 ? [rec0] : [];
      if (recs.length > 0) {
        const f = recs[0].fields as any;
        activoParaClinica = f["Activo"] === true;
        if (f["Ultimo_mensaje_enviado"]) ultimoMensajeEnviado = String(f["Ultimo_mensaje_enviado"]);
        if (f["Ultimo_mensaje_recibido"]) ultimoMensajeRecibido = String(f["Ultimo_mensaje_recibido"]);
      }
    } catch (err) {
      console.error("[configuracion-waba GET]", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    credencialesConfiguradas,
    activoParaClinica,
    numeroConectado,
    ultimoMensajeEnviado,
    ultimoMensajeRecibido,
    tokenExpirado,
  });
});

// ─── POST ────────────────────────────────────────────────────────────────────

export const POST = withPresupuestosAuth(async (session, req: Request) => {
  if (session.rol !== "manager_general" && session.rol !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  // Solo aceptamos este campo; todo lo demás se ignora silenciosamente.
  const activoParaClinica = body?.activoParaClinica === true;

  const { searchParams } = new URL(req.url);
  const clinica = await clinicaEfectiva(session, searchParams.get("clinica") ?? body?.clinica ?? null);
  if (!clinica) {
    return NextResponse.json({ error: "Falta clinica o no permitida" }, { status: 400 });
  }

  if (!process.env.AIRTABLE_API_KEY) {
    return NextResponse.json({ ok: true, isDemo: true });
  }

  try {
    const existingRec = await findConfigWABAPorClinicaRaw(clinica);
    const existing = existingRec ? [existingRec] : [];

    if (existing.length > 0) {
      await updateConfigWABARaw(existing[0].id, { Activo: activoParaClinica });
    } else {
      await createConfigWABARaw({ Clinica: clinica, Activo: activoParaClinica });
    }

    return NextResponse.json({ ok: true, activoParaClinica });
  } catch (err) {
    console.error("[configuracion-waba POST]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }
});
