// app/api/presupuestos/recordatorios/configuracion/route.ts
// GET/PUT — configuración de recordatorios por clínica

import {
  listConfigRecordatorios,
  upsertConfigRecordatorios,
} from "../../../../lib/presupuestos/recordatorios-config";
import { NextResponse } from "next/server";
import type { ConfigRecordatorios } from "../../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  nombresClinicasPermitidas,
  permiteClinica,
} from "../../../../lib/presupuestos/clinica-scope";

const DEFAULTS: Omit<ConfigRecordatorios, "clinica"> = {
  secuenciaDias: [3, 7, 10],
  recordatorioMax: 3,
  horaEnvio: "09:00",
  diasRechazoAuto: 30,
  activa: true,
};


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
    const clinicaLabel =
      clinicaSel ?? (permitidas && permitidas.size === 1 ? [...permitidas][0]! : "");

    // El filtro por clínica se aplica en código (son ≤10 filas): antes viajaba
    // como filterByFormula de Airtable.
    const todas = await listConfigRecordatorios();
    const recs = efectivas ? todas.filter((c) => efectivas.has(c.clinica)) : todas;

    if (recs.length === 0) {
      // Return defaults
      return NextResponse.json({
        configuracion: { clinica: clinicaLabel || "default", ...DEFAULTS },
      });
    }

    const configs: ConfigRecordatorios[] = recs;
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

    await upsertConfigRecordatorios(clinica, {
      secuenciaDias: secuenciaDias ?? DEFAULTS.secuenciaDias,
      recordatorioMax: recordatorioMax ?? DEFAULTS.recordatorioMax,
      horaEnvio: horaEnvio ?? DEFAULTS.horaEnvio,
      diasRechazoAuto: diasRechazoAuto ?? DEFAULTS.diasRechazoAuto,
      activa: activa ?? true,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recordatorios/configuracion] PUT error:", err);
    return NextResponse.json({ error: "Error al guardar configuración" }, { status: 500 });
  }
});
