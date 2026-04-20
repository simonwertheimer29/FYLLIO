// app/api/presupuestos/recordatorios/configuracion/route.ts
// GET/PUT — configuración de recordatorios por clínica

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../../lib/airtable";
import type { UserSession, ConfigRecordatorios } from "../../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

const DEFAULTS: Omit<ConfigRecordatorios, "clinica"> = {
  secuenciaDias: [3, 7, 10],
  recordatorioMax: 3,
  horaEnvio: "09:00",
  diasRechazoAuto: 30,
  activa: true,
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

function recordToConfig(r: any): ConfigRecordatorios {
  const f = r.fields as any;
  const secStr = String(f["Secuencia_dias"] ?? "3,7,10");
  return {
    id: r.id,
    clinica: String(f["Clinica"] ?? ""),
    secuenciaDias: secStr.split(",").map((s: string) => Number(s.trim())).filter((n: number) => !isNaN(n) && n > 0),
    recordatorioMax: Number(f["Recordatorio_max"] ?? 3),
    horaEnvio: String(f["Hora_envio"] ?? "09:00"),
    diasRechazoAuto: Number(f["Dias_rechazo_auto"] ?? 30),
    activa: f["Activa"] === true,
  };
}

// GET — lee configuración de recordatorios
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const clinicaParam = url.searchParams.get("clinica");
    // encargada_ventas NO puede consultar otras clínicas: se fuerza la suya.
    const clinica =
      session.rol === "encargada_ventas"
        ? (session.clinica ?? "")
        : (clinicaParam || session.clinica || "");

    const clinicaEsc = clinica.replace(/'/g, "\\'");
    const recs = await base(TABLES.configuracionRecordatorios as any)
      .select({
        fields: ["Clinica", "Secuencia_dias", "Recordatorio_max", "Hora_envio", "Dias_rechazo_auto", "Activa"],
        ...(clinica ? { filterByFormula: `{Clinica}='${clinicaEsc}'` } : {}),
        maxRecords: 10,
      })
      .all();

    if (recs.length === 0) {
      // Return defaults
      return NextResponse.json({
        configuracion: { clinica: clinica || "default", ...DEFAULTS },
      });
    }

    const configs = recs.map(recordToConfig);
    return NextResponse.json({
      configuracion: clinica ? configs[0] : configs[0],
      configuraciones: configs,
    });
  } catch (err) {
    console.error("[recordatorios/configuracion] GET error:", err);
    return NextResponse.json({
      configuracion: { clinica: "default", ...DEFAULTS },
    });
  }
}

// PUT — upsert configuración de recordatorios
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await req.json();
    const { clinica, secuenciaDias, recordatorioMax, horaEnvio, diasRechazoAuto, activa } = body as ConfigRecordatorios;

    if (!clinica) return NextResponse.json({ error: "clinica requerida" }, { status: 400 });

    const fields: Record<string, any> = {
      Clinica: clinica,
      Secuencia_dias: (secuenciaDias ?? DEFAULTS.secuenciaDias).join(","),
      Recordatorio_max: recordatorioMax ?? DEFAULTS.recordatorioMax,
      Hora_envio: horaEnvio ?? DEFAULTS.horaEnvio,
      Dias_rechazo_auto: diasRechazoAuto ?? DEFAULTS.diasRechazoAuto,
      Activa: activa ?? true,
    };

    // Check if exists
    const existing = await base(TABLES.configuracionRecordatorios as any)
      .select({
        filterByFormula: `{Clinica}='${clinica}'`,
        maxRecords: 1,
        fields: ["Clinica"],
      })
      .all();

    if (existing.length > 0) {
      await base(TABLES.configuracionRecordatorios as any).update(existing[0].id, fields as any);
    } else {
      await (base(TABLES.configuracionRecordatorios as any).create as any)(fields);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recordatorios/configuracion] PUT error:", err);
    return NextResponse.json({ error: "Error al guardar configuración" }, { status: 500 });
  }
}
