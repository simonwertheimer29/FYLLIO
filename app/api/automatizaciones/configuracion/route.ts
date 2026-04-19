// app/api/automatizaciones/configuracion/route.ts
// GET  ?clinica=X  → configuración de automatizaciones de la clínica (o defaults)
// PUT  { clinica, activa, dias_inactividad_alerta, ... }  → upsert

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import type { UserSession, ConfiguracionAutomatizacion, ModoWhatsApp } from "../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

const DEFAULTS: Omit<ConfiguracionAutomatizacion, "clinica"> = {
  activa: true,
  diasInactividadAlerta: 3,
  diasPortalSinRespuesta: 2,
  diasReactivacion: 90,
};

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

function recordToConfig(rec: { fields: Record<string, unknown> }, clinica: string): ConfiguracionAutomatizacion {
  const f = rec.fields as any;
  const rawModo = f["modo_whatsapp"];
  const modoWhatsapp: ModoWhatsApp = rawModo === "waba" ? "waba" : "manual";
  return {
    clinica,
    activa:                   f["activa"] === true,
    diasInactividadAlerta:    Number(f["dias_inactividad_alerta"]   ?? DEFAULTS.diasInactividadAlerta),
    diasPortalSinRespuesta:   Number(f["dias_portal_sin_respuesta"] ?? DEFAULTS.diasPortalSinRespuesta),
    diasReactivacion:         Number(f["dias_reactivacion"]         ?? DEFAULTS.diasReactivacion),
    modoWhatsapp,
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ configuracion: null, defaults: DEFAULTS, isDemo: true });
  }

  const { searchParams } = new URL(req.url);
  const clinicaParam = searchParams.get("clinica") ?? "";

  const clinica =
    session.rol === "encargada_ventas" && session.clinica
      ? session.clinica
      : clinicaParam;

  try {
    if (clinica) {
      // Fetch specific clinic config
      const recs = await base(TABLES.configuracionAutomatizaciones as any)
        .select({
          filterByFormula: `{clinica}="${clinica}"`,
          maxRecords: 1,
        })
        .firstPage();

      if (recs.length > 0) {
        return NextResponse.json({ configuracion: recordToConfig({ fields: recs[0].fields as Record<string, unknown> }, clinica) });
      }
      return NextResponse.json({ configuracion: { clinica, ...DEFAULTS } });
    } else {
      // Manager/admin: fetch all clinic configs
      const recs = await base(TABLES.configuracionAutomatizaciones as any)
        .select({
          fields: ["clinica", "activa", "dias_inactividad_alerta", "dias_portal_sin_respuesta", "dias_reactivacion", "modo_whatsapp"],
          maxRecords: 100,
        })
        .all();

      const configuraciones: ConfiguracionAutomatizacion[] = recs.map((r) => {
        const c = String((r.fields as any)["clinica"] ?? "");
        return recordToConfig({ fields: r.fields as Record<string, unknown> }, c);
      });

      return NextResponse.json({ configuraciones, defaults: DEFAULTS });
    }
  } catch (err) {
    console.error("[configuracion GET]", err);
    return NextResponse.json({ error: "Error al obtener configuración" }, { status: 500 });
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (session.rol !== "manager_general" && session.rol !== "admin") {
    return NextResponse.json({ error: "Sin permisos para editar configuración" }, { status: 403 });
  }

  const body = await req.json();
  const { clinica, activa, diasInactividadAlerta, diasPortalSinRespuesta, diasReactivacion, modoWhatsapp } = body as ConfiguracionAutomatizacion;

  if (!clinica) {
    return NextResponse.json({ error: "Falta campo: clinica" }, { status: 400 });
  }

  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ ok: true, isDemo: true });
  }

  const now = new Date().toISOString();

  try {
    const existing = await base(TABLES.configuracionAutomatizaciones as any)
      .select({
        filterByFormula: `{clinica}="${clinica}"`,
        maxRecords: 1,
      })
      .firstPage();

    // Update parcial: solo escribimos los campos que vienen en el body.
    // Esto permite llamadas tipo { clinica, modoWhatsapp } sin resetear los días.
    const updateFields: Record<string, unknown> = { actualizado_en: now };
    if (activa !== undefined) updateFields.activa = activa === true;
    if (diasInactividadAlerta !== undefined) {
      updateFields.dias_inactividad_alerta = Number(diasInactividadAlerta) || DEFAULTS.diasInactividadAlerta;
    }
    if (diasPortalSinRespuesta !== undefined) {
      updateFields.dias_portal_sin_respuesta = Number(diasPortalSinRespuesta) || DEFAULTS.diasPortalSinRespuesta;
    }
    if (diasReactivacion !== undefined) {
      updateFields.dias_reactivacion = Number(diasReactivacion) || DEFAULTS.diasReactivacion;
    }
    if (modoWhatsapp !== undefined) {
      updateFields.modo_whatsapp = modoWhatsapp === "waba" ? "waba" : "manual";
    }

    if (existing.length > 0) {
      await base(TABLES.configuracionAutomatizaciones as any).update(existing[0].id, updateFields as any);
    } else {
      // Create: rellenar campos que falten con defaults.
      const createFields: Record<string, unknown> = {
        clinica,
        activa: activa !== undefined ? activa === true : true,
        dias_inactividad_alerta: Number(diasInactividadAlerta) || DEFAULTS.diasInactividadAlerta,
        dias_portal_sin_respuesta: Number(diasPortalSinRespuesta) || DEFAULTS.diasPortalSinRespuesta,
        dias_reactivacion: Number(diasReactivacion) || DEFAULTS.diasReactivacion,
        modo_whatsapp: modoWhatsapp === "waba" ? "waba" : "manual",
        creado_en: now,
        actualizado_en: now,
      };
      await base(TABLES.configuracionAutomatizaciones as any).create([{
        fields: createFields,
      }] as any);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[configuracion PUT]", err);
    return NextResponse.json({ error: "Error al guardar configuración" }, { status: 500 });
  }
}
