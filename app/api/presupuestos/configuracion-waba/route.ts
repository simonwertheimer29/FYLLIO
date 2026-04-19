// app/api/presupuestos/configuracion-waba/route.ts
// GET  → estado operativo de WABA (sin credenciales).
// POST → { activoParaClinica: boolean } (solo acepta ese campo).
//
// NUNCA devuelve el Access Token ni siquiera parcialmente.

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import { hasWABACredentials, getWABACredentials } from "../../../lib/presupuestos/waba-credentials";
import type { UserSession } from "../../../lib/presupuestos/types";

export const dynamic = "force-dynamic";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const GRAPH_API_VERSION = "v21.0";

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

function resolveClinica(session: UserSession, fromQuery: string | null): string | null {
  if (session.rol === "encargada_ventas" && session.clinica) return session.clinica;
  return fromQuery || session.clinica || null;
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clinica = resolveClinica(session, searchParams.get("clinica"));

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
      const recs = await base(TABLES.configuracionWABA as any)
        .select({
          filterByFormula: `{Clinica}='${clinica}'`,
          maxRecords: 1,
        })
        .firstPage();
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
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.rol !== "manager_general" && session.rol !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  // Solo aceptamos este campo; todo lo demás se ignora silenciosamente.
  const activoParaClinica = body?.activoParaClinica === true;

  const { searchParams } = new URL(req.url);
  const clinica = resolveClinica(session, searchParams.get("clinica") ?? body?.clinica ?? null);
  if (!clinica) {
    return NextResponse.json({ error: "Falta clinica" }, { status: 400 });
  }

  if (!process.env.AIRTABLE_API_KEY) {
    return NextResponse.json({ ok: true, isDemo: true });
  }

  try {
    const existing = await base(TABLES.configuracionWABA as any)
      .select({
        filterByFormula: `{Clinica}='${clinica}'`,
        maxRecords: 1,
      })
      .firstPage();

    if (existing.length > 0) {
      await base(TABLES.configuracionWABA as any).update(existing[0].id, {
        Activo: activoParaClinica,
      } as any);
    } else {
      await base(TABLES.configuracionWABA as any).create([{
        fields: { Clinica: clinica, Activo: activoParaClinica } as any,
      }]);
    }

    return NextResponse.json({ ok: true, activoParaClinica });
  } catch (err) {
    console.error("[configuracion-waba POST]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }
}
