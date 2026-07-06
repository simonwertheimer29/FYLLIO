// app/api/automatizaciones/secuencias/route.ts
// GET  ?estado=pendiente&clinica=X  → lista secuencias
// PATCH { id, accion, mensaje? }    → enviar | descartar | editar

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import type { Secuencia } from "../../../lib/presupuestos/types";
import { registrarAccion } from "../../../lib/historial/registrar";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  nombresClinicasPermitidas,
  permiteClinica,
  formulaClinicaPermitida,
} from "../../../lib/presupuestos/clinica-scope";

// Sprint B — migrado a withPresupuestosAuth (contexto de cliente) + aislamiento
// por clínica vía clinicasAccesibles. Antes leía la cookie inline sin contexto
// (500 por el fail-closed) y filtraba por session.clinica (null → sin filtro).
export const dynamic = "force-dynamic";

function recordToSecuencia(rec: { id: string; fields: Record<string, unknown> }): Secuencia {
  const f = rec.fields as any;
  return {
    id: rec.id,
    presupuestoId:    String(f["presupuesto_id"]   ?? ""),
    clinica:          String(f["clinica"]           ?? ""),
    pacienteNombre:   String(f["paciente_nombre"]   ?? ""),
    telefono:         String(f["telefono"]          ?? ""),
    tratamiento:      String(f["tratamiento"]       ?? ""),
    tipoEvento:       (f["tipo_evento"]             ?? "presupuesto_inactivo") as Secuencia["tipoEvento"],
    estado:           (f["estado"]                  ?? "pendiente")           as Secuencia["estado"],
    mensajeGenerado:  String(f["mensaje_generado"]  ?? ""),
    tonoUsado:        String(f["tono_usado"]        ?? ""),
    canalSugerido:    (f["canal_sugerido"]          ?? "whatsapp")            as Secuencia["canalSugerido"],
    creadoEn:         String(f["creado_en"]         ?? ""),
    actualizadoEn:    String(f["actualizado_en"]    ?? ""),
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export const GET = withPresupuestosAuth(async (session, req) => {
  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ secuencias: [], isDemo: true });
  }

  const { searchParams } = new URL(req.url);
  const estadoFilter = searchParams.get("estado") ?? "pendiente";
  const clinicaParam = searchParams.get("clinica") ?? "";

  // Sprint B Fase 4 — aislamiento por clínica por IDs de la sesión. La clínica
  // elegida solo cuenta si está permitida; si no, todas las permitidas (null =
  // admin, sin restricción).
  const permitidas = await nombresClinicasPermitidas(session);
  const clinicaSel = clinicaParam && permiteClinica(permitidas, clinicaParam) ? clinicaParam : null;
  const efectivas = clinicaSel ? new Set([clinicaSel]) : permitidas;
  const clinicaFormula = formulaClinicaPermitida(efectivas, "clinica");

  const filters: string[] = [`{estado}="${estadoFilter}"`];
  if (clinicaFormula) filters.push(clinicaFormula);
  const formula = filters.length === 1 ? filters[0] : `AND(${filters.join(",")})`;

  try {
    const recs = await base(TABLES.secuenciasAutomaticas as any)
      .select({
        filterByFormula: formula,
        sort: [{ field: "creado_en", direction: "desc" }],
        maxRecords: 200,
      })
      .all();

    const secuencias: Secuencia[] = recs.map((r) =>
      recordToSecuencia({ id: r.id, fields: r.fields as Record<string, unknown> })
    );

    return NextResponse.json({ secuencias });
  } catch (err) {
    console.error("[secuencias GET]", err);
    return NextResponse.json({ error: "Error al obtener secuencias" }, { status: 500 });
  }
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

export const PATCH = withPresupuestosAuth(async (session, req) => {
  const body = await req.json();
  const { id, accion, mensaje } = body as {
    id?: string;
    accion?: "enviar" | "descartar" | "editar";
    mensaje?: string;
  };

  if (!id || !accion) {
    return NextResponse.json({ error: "Faltan campos: id, accion" }, { status: 400 });
  }

  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ ok: true, isDemo: true });
  }

  const now = new Date().toISOString();

  try {
    const updates: Record<string, unknown> = { actualizado_en: now };

    if (accion === "enviar") {
      updates["estado"] = "enviado";
    } else if (accion === "descartar") {
      updates["estado"] = "descartado";
    } else if (accion === "editar") {
      if (mensaje != null) updates["mensaje_generado"] = mensaje;
      // estado stays "pendiente"
    }

    await base(TABLES.secuenciasAutomaticas as any).update(id, updates as any);

    // Registrar en historial cuando se envía el mensaje
    if (accion === "enviar") {
      try {
        const rec = await base(TABLES.secuenciasAutomaticas as any).find(id);
        const f = (rec as any).fields as Record<string, unknown>;
        await registrarAccion({
          presupuestoId: String(f["presupuesto_id"] ?? ""),
          tipo: "mensaje_automatico",
          descripcion: `Mensaje automático enviado vía ${String(f["canal_sugerido"] ?? "whatsapp")}`,
          metadata: { secuenciaId: id, tipoEvento: f["tipo_evento"] },
          registradoPor: session.nombre || session.email,
          clinica: String(f["clinica"] ?? ""),
        });
      } catch {
        // no bloquear
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[secuencias PATCH]", err);
    return NextResponse.json({ error: "Error al actualizar secuencia" }, { status: 500 });
  }
});
