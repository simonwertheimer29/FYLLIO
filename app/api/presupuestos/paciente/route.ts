// app/api/presupuestos/paciente/route.ts
// GET ?nombre=X — todos los presupuestos + historial de acciones de un paciente

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import type { Presupuesto, HistorialAccion } from "../../../lib/presupuestos/types";
import { computeUrgencyScore } from "../../../lib/presupuestos/urgency";
import { DEMO_PRESUPUESTOS } from "../../../lib/presupuestos/demo";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

const ZONE = "Europe/Madrid";

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

export const GET = withPresupuestosAuth(async (_session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const nombre = searchParams.get("nombre") ?? "";
  if (!nombre) {
    return NextResponse.json({ error: "Falta parámetro nombre" }, { status: 400 });
  }

  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    const demo = DEMO_PRESUPUESTOS.filter(
      (p) => p.patientName.toLowerCase() === nombre.toLowerCase()
    );
    return NextResponse.json({ presupuestos: demo, historial: [], isDemo: true });
  }

  try {
    const today = DateTime.now().setZone(ZONE).toISODate()!;

    // Fetch all presupuestos for this patient by name (case-insensitive contains)
    const recs = await base(TABLES.presupuestos as any)
      .select({
        fields: [
          "Paciente_nombre", "Teléfono", "Tratamiento_nombre",
          "Importe", "Estado", "Fecha", "Notas",
          "Paciente_Telefono", "Doctor", "Doctor_Especialidad",
          "TipoPaciente", "TipoVisita", "FechaAlta", "Clinica",
          "ContactCount", "CreadoPor",
          "OrigenLead", "MotivoPerdida", "MotivoPerdidaTexto", "MotivoDuda",
          "Reactivacion", "PortalEnviado", "OfertaActiva",
        ],
        filterByFormula: `FIND(LOWER("${nombre.replace(/['"\\]/g, "")}"), LOWER(ARRAYJOIN({Paciente_nombre}, ""))) > 0`,
        sort: [{ field: "Fecha", direction: "desc" }],
        maxRecords: 100,
      })
      .all();

    // Sprint 14a Bloque 1 — primer record id de Pacientes encontrado
    // entre los presupuestos cargados. Lo usamos para que Paciente360View
    // pueda llamar a /api/pacientes/[id]/pagos. Caso edge: homonimos
    // distintos en Pacientes — tomamos el primero y dejamos un warning.
    let resolvedPacienteId: string | null = null;
    const allLinkedPacienteIds = new Set<string>();
    for (const r of recs) {
      const links = ((r.fields as any)?.["Paciente"] ?? []) as string[];
      if (links[0]) {
        allLinkedPacienteIds.add(links[0]);
        if (!resolvedPacienteId) resolvedPacienteId = links[0];
      }
    }
    if (allLinkedPacienteIds.size > 1) {
      console.warn(
        `[paciente GET] nombre="${nombre}" mapea a ${allLinkedPacienteIds.size} record IDs distintos en Pacientes. Tomando el primero (${resolvedPacienteId}).`,
      );
    }

    const presupuestos: Presupuesto[] = recs.map((r) => {
      const f = r.fields as any;
      const fechaPresupuesto = String(f["Fecha"] ?? "").slice(0, 10) || today;
      const patientName = Array.isArray(f["Paciente_nombre"])
        ? String(f["Paciente_nombre"][0] ?? "Paciente")
        : "Paciente";
      const patientPhone =
        f["Paciente_Telefono"]
          ? String(f["Paciente_Telefono"])
          : Array.isArray(f["Teléfono"]) && f["Teléfono"][0]
          ? String(f["Teléfono"][0])
          : undefined;
      const treatmentRaw = f["Tratamiento_nombre"] ?? "";
      const notasStr = f["Notas"] ? String(f["Notas"]) : "";
      const metaMatch = notasStr.match(/Doctor:\s*([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/);

      const p: Presupuesto = {
        id: r.id,
        patientName,
        patientPhone,
        treatments: treatmentRaw
          ? String(treatmentRaw).split(/[,+]/).map((t: string) => t.trim()).filter(Boolean)
          : [],
        doctor: f["Doctor"] ? String(f["Doctor"]) : (metaMatch ? metaMatch[1].trim() : undefined),
        doctorEspecialidad: f["Doctor_Especialidad"] ?? undefined,
        tipoPaciente: f["TipoPaciente"] ?? (metaMatch ? metaMatch[3].trim() : undefined),
        tipoVisita: f["TipoVisita"] ?? (metaMatch ? metaMatch[4].trim() : undefined),
        amount: f["Importe"] ? Number(f["Importe"]) : undefined,
        estado: f["Estado"] ?? "PRESENTADO",
        fechaPresupuesto,
        fechaAlta: String(f["FechaAlta"] ?? fechaPresupuesto).slice(0, 10),
        daysSince: daysSince(fechaPresupuesto),
        clinica: f["Clinica"] ? String(f["Clinica"]) : (metaMatch ? metaMatch[2].trim() : undefined),
        notes: notasStr || undefined,
        urgencyScore: 0,
        contactCount: Number(f["ContactCount"] ?? 0),
        createdBy: f["CreadoPor"] ? String(f["CreadoPor"]) : undefined,
        origenLead: f["OrigenLead"] ?? undefined,
        motivoPerdida: f["MotivoPerdida"] ?? undefined,
        motivoPerdidaTexto: f["MotivoPerdidaTexto"] ? String(f["MotivoPerdidaTexto"]) : undefined,
        motivoDuda: f["MotivoDuda"] ?? undefined,
        reactivacion: f["Reactivacion"] === true,
        portalEnviado: f["PortalEnviado"] === true,
        ofertaActiva: f["OfertaActiva"] === true,
      };
      p.urgencyScore = computeUrgencyScore(p);
      return p;
    });

    // Fetch historial for all these presupuestos
    const ids = presupuestos.map((p) => p.id);
    let historial: HistorialAccion[] = [];

    if (ids.length > 0) {
      try {
        const orFormula = ids.map((id) => `{presupuesto_id}="${id}"`).join(",");
        const formula = ids.length === 1 ? orFormula : `OR(${orFormula})`;
        const hRecs = await base(TABLES.historialAcciones as any)
          .select({
            filterByFormula: formula,
            sort: [{ field: "fecha", direction: "desc" }],
            maxRecords: 200,
          })
          .all();

        historial = hRecs.map((r) => {
          const f = r.fields as any;
          let metadata: Record<string, unknown> | undefined;
          try {
            if (f["metadata"]) metadata = JSON.parse(String(f["metadata"]));
          } catch { /* ignore */ }
          return {
            id: r.id,
            presupuestoId: String(f["presupuesto_id"] ?? ""),
            tipo: f["tipo"] ?? "cambio_estado",
            descripcion: String(f["descripcion"] ?? ""),
            metadata,
            registradoPor: f["registrado_por"] ? String(f["registrado_por"]) : undefined,
            clinica: f["clinica"] ? String(f["clinica"]) : undefined,
            fecha: String(f["fecha"] ?? ""),
          } as HistorialAccion;
        });
      } catch {
        // historial falla silenciosamente
      }
    }

    return NextResponse.json({
      presupuestos,
      historial,
      isDemo: false,
      pacienteId: resolvedPacienteId,
    });
  } catch (err) {
    console.error("[paciente GET]", err);
    const demo = DEMO_PRESUPUESTOS.filter(
      (p) => p.patientName.toLowerCase() === nombre.toLowerCase()
    );
    return NextResponse.json({ presupuestos: demo, historial: [], isDemo: true });
  }
});
