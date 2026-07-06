// app/api/presupuestos/recordatorios/configuracion/route.ts
// GET/PUT — configuración de recordatorios por clínica

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../../lib/airtable";
import type { ConfigRecordatorios } from "../../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  nombresClinicasPermitidas,
  permiteClinica,
  formulaClinicaPermitida,
} from "../../../../lib/presupuestos/clinica-scope";

const DEFAULTS: Omit<ConfigRecordatorios, "clinica"> = {
  secuenciaDias: [3, 7, 10],
  recordatorioMax: 3,
  horaEnvio: "09:00",
  diasRechazoAuto: 30,
  activa: true,
};

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
export const GET = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const url = new URL(req.url);
    // Sprint B Fase 4 — aislamiento por clínica por IDs de la sesión. Una clínica
    // pedida solo cuenta si está permitida; si no, se devuelven todas las
    // permitidas (null = admin, sin restricción). Antes una encargada con
    // `session.clinica` null recibía las configs de TODAS las clínicas.
    const permitidas = await nombresClinicasPermitidas(session);
    const requested = url.searchParams.get("clinica");
    const clinicaSel = requested && permiteClinica(permitidas, requested) ? requested : null;
    const efectivas = clinicaSel ? new Set([clinicaSel]) : permitidas;
    const clinicaFormula = formulaClinicaPermitida(efectivas, "Clinica");
    const clinicaLabel =
      clinicaSel ?? (permitidas && permitidas.size === 1 ? [...permitidas][0]! : "");

    const recs = await base(TABLES.configuracionRecordatorios as any)
      .select({
        fields: ["Clinica", "Secuencia_dias", "Recordatorio_max", "Hora_envio", "Dias_rechazo_auto", "Activa"],
        ...(clinicaFormula ? { filterByFormula: clinicaFormula } : {}),
        maxRecords: 10,
      })
      .all();

    if (recs.length === 0) {
      // Return defaults
      return NextResponse.json({
        configuracion: { clinica: clinicaLabel || "default", ...DEFAULTS },
      });
    }

    const configs = recs.map(recordToConfig);
    return NextResponse.json({
      configuracion: configs[0],
      configuraciones: configs,
    });
  } catch (err) {
    console.error("[recordatorios/configuracion] GET error:", err);
    return NextResponse.json({
      configuracion: { clinica: "default", ...DEFAULTS },
    });
  }
});

// PUT — upsert configuración de recordatorios
export const PUT = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const body = await req.json();
    const { clinica, secuenciaDias, recordatorioMax, horaEnvio, diasRechazoAuto, activa } = body as ConfigRecordatorios;

    if (!clinica) return NextResponse.json({ error: "clinica requerida" }, { status: 400 });
    // Sprint B Fase 4 — solo se puede escribir la config de una clínica permitida.
    const permitidas = await nombresClinicasPermitidas(session);
    if (!permiteClinica(permitidas, clinica)) {
      return NextResponse.json({ error: "Clínica no permitida" }, { status: 403 });
    }

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
});
