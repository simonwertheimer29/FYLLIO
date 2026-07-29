// app/api/presupuestos/objetivos/route.ts
// GET  ?mes=2026-03  → objetivos del mes para todas las clínicas
// POST { clinica, mes, objetivo_aceptados } → crear o actualizar objetivo

import { NextResponse } from "next/server";
import { listObjetivosRaw, findObjetivoRaw, updateObjetivoRaw, createObjetivoRaw } from "../../../lib/presupuestos/objetivos";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  nombresClinicasPermitidas,
  permiteClinica,
  formulaClinicaPermitida,
} from "../../../lib/presupuestos/clinica-scope";

function getMesMTD(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export const GET = withPresupuestosAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const mes = searchParams.get("mes") ?? getMesMTD();

  // (Aquí había una puerta a datos DEMO condicionada a AIRTABLE_API_KEY /
  // AIRTABLE_BASE_ID. Airtable está retirado y esas variables no existen en
  // Vercel, así que la condición se cumplía SIEMPRE en producción: la ruta no
  // llegaba nunca a su código real. Eliminada, no re-condicionada — si no se
  // pueden servir datos reales, se devuelve un error honesto, jamás inventados.
  // §4 y §1, 2026-07-29.)

  // Sprint B Fase 4 — aislamiento por clínica: un coord solo ve los objetivos de
  // sus clínicas permitidas; admin/manager (null) ven todas las del cliente.
  const permitidas = await nombresClinicasPermitidas(session);
  const clinicaFormula = formulaClinicaPermitida(permitidas, "clinica");
  const formula = clinicaFormula ? `AND({mes}="${mes}",${clinicaFormula})` : `{mes}="${mes}"`;

  try {
    const records = await listObjetivosRaw(formula);

    const objetivos = records.map((r) => ({
      id: r.id,
      clinica: String(r.fields["clinica"] ?? ""),
      mes: String(r.fields["mes"] ?? ""),
      objetivo_aceptados: Number(r.fields["objetivo_aceptados"] ?? 0),
    }));

    return NextResponse.json({ objetivos });
  } catch (err) {
    console.error("[objetivos GET]", err);
    return NextResponse.json({ error: "Error al obtener objetivos" }, { status: 500 });
  }
});

// ─── POST ─────────────────────────────────────────────────────────────────────

export const POST = withPresupuestosAuth(async (session, req: Request) => {

  // Solo manager_general y admin pueden editar objetivos
  if (session.rol !== "manager_general" && session.rol !== "admin") {
    return NextResponse.json({ error: "Sin permisos para editar objetivos" }, { status: 403 });
  }

  const body = await req.json();
  const { clinica, mes, objetivo_aceptados } = body as {
    clinica?: string;
    mes?: string;
    objetivo_aceptados?: number;
  };

  if (!clinica || !mes || objetivo_aceptados == null) {
    return NextResponse.json({ error: "Faltan campos: clinica, mes, objetivo_aceptados" }, { status: 400 });
  }

  // Sprint B Fase 4 — solo se puede fijar el objetivo de una clínica permitida.
  const permitidas = await nombresClinicasPermitidas(session);
  if (!permiteClinica(permitidas, clinica)) {
    return NextResponse.json({ error: "Clínica no permitida" }, { status: 403 });
  }

  // Solo editable hasta el día 5 del mes actual
  const mesMTD = getMesMTD();
  if (mes === mesMTD) {
    const dayOfMonth = new Date().getDate();
    if (dayOfMonth > 5) {
      return NextResponse.json(
        { error: "Solo se puede editar el objetivo hasta el día 5 del mes" },
        { status: 403 }
      );
    }
  }


  const now = new Date().toISOString();

  try {
    // Buscar si ya existe
    const existingRec = await findObjetivoRaw(clinica, mes);
    const existing = existingRec ? [existingRec] : [];

    if (existing.length > 0) {
      // Actualizar
      await updateObjetivoRaw(existing[0].id, {
        objetivo_aceptados: Number(objetivo_aceptados),
        actualizado_en: now,
      });
    } else {
      // Crear
      await createObjetivoRaw({
          clinica,
          mes,
          objetivo_aceptados: Number(objetivo_aceptados),
          creado_por: session.email,
          creado_en: now,
          actualizado_en: now,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[objetivos POST]", err);
    return NextResponse.json({ error: "Error al guardar objetivo" }, { status: 500 });
  }
});
