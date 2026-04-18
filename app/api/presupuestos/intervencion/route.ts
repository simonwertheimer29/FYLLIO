// app/api/presupuestos/intervencion/route.ts
// GET — devuelve la cola de intervención del día, agrupada por intención

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { DateTime } from "luxon";
import { computeUrgencyScore } from "../../../lib/presupuestos/urgency";
import { generarMensajeSugerido } from "../../../lib/presupuestos/intervencion";
import { INTENCION_SECTIONS } from "../../../lib/presupuestos/colors";
import type {
  UserSession,
  PresupuestoIntervencion,
  SeccionIntervencion,
  IntencionDetectada,
  UrgenciaIntervencion,
  UrgenciaBidireccional,
  FaseSeguimiento,
  TipoUltimaAccionIntervencion,
  PresupuestoEstado,
} from "../../../lib/presupuestos/types";

export const dynamic = "force-dynamic";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const ZONE = "Europe/Madrid";

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

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

const URGENCIA_ORDER: Record<string, number> = {
  "CRÍTICO": 0,
  "ALTO": 1,
  "MEDIO": 2,
  "BAJO": 3,
  "NINGUNO": 4,
};

// -------------------------------------------------------------------
// Urgencia bidireccional (3 ejes)
// -------------------------------------------------------------------

const INTENCION_SCORE: Record<string, number> = {
  "Acepta sin condiciones": 40,
  "Acepta pero pregunta pago": 35,
  "Pide oferta/descuento": 25,
  "Tiene duda sobre tratamiento": 20,
  "Sin clasificar": 15,
  "Quiere pensarlo": 10,
  "Rechaza": 5,
};

function computeUrgenciaBidireccional(p: PresupuestoIntervencion): UrgenciaBidireccional {
  // Eje 1 — Intención del paciente (0-40)
  const scoreIntencion = INTENCION_SCORE[p.intencionDetectada ?? "Sin clasificar"] ?? 15;

  // Eje 2 — Tiempo de respuesta de la clínica (0-30)
  let scoreRespClinica = 0;
  if (p.fechaUltimaRespuesta) {
    const respuestaMs = new Date(p.fechaUltimaRespuesta).getTime();
    const accionMs = p.ultimaAccionRegistrada
      ? new Date(p.ultimaAccionRegistrada).getTime()
      : 0;
    // Solo cuenta si la clínica no ha respondido después de la última respuesta del paciente
    if (accionMs < respuestaMs) {
      const horasSinRespuesta = (Date.now() - respuestaMs) / (1000 * 60 * 60);
      if (horasSinRespuesta > 48) scoreRespClinica = 30;
      else if (horasSinRespuesta > 24) scoreRespClinica = 25;
      else if (horasSinRespuesta > 12) scoreRespClinica = 20;
      else if (horasSinRespuesta > 6) scoreRespClinica = 15;
      else if (horasSinRespuesta > 2) scoreRespClinica = 10;
      else scoreRespClinica = 5;
    }
  }

  // Eje 3 — Oportunidad de cierre (0-30)
  let importeScore = 0;
  if (p.amount != null) {
    if (p.amount > 5000) importeScore = 15;
    else if (p.amount > 2000) importeScore = 10;
    else if (p.amount > 500) importeScore = 5;
  }
  let estadoScore = 0;
  if (p.estado === "EN_NEGOCIACION") estadoScore = 15;
  else if (p.estado === "EN_DUDA") estadoScore = 10;
  else if (p.estado === "INTERESADO") estadoScore = 5;
  const scoreCierre = Math.min(importeScore + estadoScore, 30);

  return {
    scoreFinal: scoreIntencion + scoreRespClinica + scoreCierre,
    scoreIntencion,
    scoreRespClinica,
    scoreCierre,
  };
}

// -------------------------------------------------------------------
// GET /api/presupuestos/intervencion
// -------------------------------------------------------------------

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clinicaFilter = url.searchParams.get("clinica") || "";

  // Check env vars
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({
      secciones: [],
      allItems: [],
      totalPendientes: 0,
      completadasHoy: 0,
      casosCompletados: [],
      clinicas: [],
      doctores: [],
      tratamientos: [],
      isDemo: true,
    });
  }

  try {
    // Fetch presupuestos activos (no cerrados) que tengan respuesta o urgencia
    const filterFormula = `AND(
      {Estado}!='ACEPTADO',
      {Estado}!='PERDIDO',
      OR(
        {Ultima_respuesta_paciente}!='',
        AND({Urgencia_intervencion}!='', {Urgencia_intervencion}!='NINGUNO')
      )
    )`.replace(/\n\s*/g, "");

    const query = base(TABLES.presupuestos as any).select({
      fields: [
        // Campos base
        "Paciente_nombre", "Teléfono", "Tratamiento_nombre",
        "Importe", "Estado", "Fecha", "Notas",
        "Paciente_Telefono", "Doctor", "Doctor_Especialidad",
        "TipoPaciente", "TipoVisita", "FechaAlta", "Clinica",
        "ContactCount", "CreadoPor", "OrigenLead", "MotivoDuda", "OfertaActiva",
        // Campos de intervención
        "Ultima_respuesta_paciente", "Fecha_ultima_respuesta",
        "Intencion_detectada", "Urgencia_intervencion",
        "Accion_sugerida", "Mensaje_sugerido",
        "Fase_seguimiento", "Ultima_accion_registrada", "Tipo_ultima_accion",
      ],
      filterByFormula: filterFormula,
      sort: [{ field: "Fecha_ultima_respuesta", direction: "desc" }],
    });

    const recs = await fetchAll(query);

    const today = DateTime.now().setZone(ZONE).startOf("day");

    // Map Airtable records to PresupuestoIntervencion
    let items: PresupuestoIntervencion[] = recs.map((r) => {
      const f = r.fields as any;

      const fechaPresupuesto = String(f["Fecha"] ?? "").slice(0, 10) ||
        DateTime.now().setZone(ZONE).toISODate()!;

      const patientName = Array.isArray(f["Paciente_nombre"])
        ? String(f["Paciente_nombre"][0] ?? "Paciente")
        : String(f["Paciente_nombre"] ?? "Paciente");

      const patientPhone = f["Paciente_Telefono"]
        ? String(f["Paciente_Telefono"])
        : Array.isArray(f["Teléfono"])
          ? String(f["Teléfono"][0] ?? "")
          : String(f["Teléfono"] ?? "");

      const treatments = String(f["Tratamiento_nombre"] ?? "")
        .split(/[,+]/)
        .map((t: string) => t.trim())
        .filter(Boolean);

      const amount = f["Importe"] != null ? Number(f["Importe"]) : undefined;
      const estado = String(f["Estado"] ?? "PRESENTADO") as PresupuestoEstado;

      const clinica = Array.isArray(f["Clinica"])
        ? String(f["Clinica"][0] ?? "")
        : String(f["Clinica"] ?? "");

      const doctor = Array.isArray(f["Doctor"])
        ? String(f["Doctor"][0] ?? "")
        : String(f["Doctor"] ?? "");

      const ds = daysSince(fechaPresupuesto);

      // Intervention fields
      const ultimaRespuestaPaciente = f["Ultima_respuesta_paciente"]
        ? String(f["Ultima_respuesta_paciente"])
        : undefined;

      const fechaUltimaRespuesta = f["Fecha_ultima_respuesta"]
        ? String(f["Fecha_ultima_respuesta"])
        : undefined;

      const intencionDetectada = f["Intencion_detectada"]
        ? (String(f["Intencion_detectada"]) as IntencionDetectada)
        : undefined;

      const urgenciaIntervencion = f["Urgencia_intervencion"]
        ? (String(f["Urgencia_intervencion"]) as UrgenciaIntervencion)
        : undefined;

      const accionSugerida = f["Accion_sugerida"]
        ? String(f["Accion_sugerida"])
        : undefined;

      const mensajeSugerido = f["Mensaje_sugerido"]
        ? String(f["Mensaje_sugerido"])
        : undefined;

      const faseSeguimiento = f["Fase_seguimiento"]
        ? (String(f["Fase_seguimiento"]) as FaseSeguimiento)
        : undefined;

      const ultimaAccionRegistrada = f["Ultima_accion_registrada"]
        ? String(f["Ultima_accion_registrada"])
        : undefined;

      const tipoUltimaAccion = f["Tipo_ultima_accion"]
        ? (String(f["Tipo_ultima_accion"]) as TipoUltimaAccionIntervencion)
        : undefined;

      // Compute days since last contact
      let diasDesdeUltimoContacto: number | undefined;
      if (fechaUltimaRespuesta) {
        diasDesdeUltimoContacto = daysSince(fechaUltimaRespuesta);
      } else if (ultimaAccionRegistrada) {
        diasDesdeUltimoContacto = daysSince(ultimaAccionRegistrada);
      }

      const p: PresupuestoIntervencion = {
        id: r.id,
        patientName,
        patientPhone: patientPhone || undefined,
        treatments,
        doctor: doctor || undefined,
        doctorEspecialidad: f["Doctor_Especialidad"] || undefined,
        tipoPaciente: f["TipoPaciente"] || undefined,
        tipoVisita: f["TipoVisita"] || undefined,
        amount,
        estado,
        fechaPresupuesto,
        fechaAlta: String(f["FechaAlta"] ?? fechaPresupuesto).slice(0, 10),
        daysSince: ds,
        clinica: clinica || undefined,
        notes: f["Notas"] ? String(f["Notas"]) : undefined,
        urgencyScore: 0,
        contactCount: Number(f["ContactCount"] ?? 0),
        origenLead: f["OrigenLead"] || undefined,
        motivoDuda: f["MotivoDuda"] || undefined,
        ofertaActiva: Boolean(f["OfertaActiva"]),
        // Intervention fields
        ultimaRespuestaPaciente,
        fechaUltimaRespuesta,
        intencionDetectada,
        urgenciaIntervencion,
        accionSugerida,
        mensajeSugerido,
        faseSeguimiento,
        ultimaAccionRegistrada,
        tipoUltimaAccion,
        diasDesdeUltimoContacto,
      };

      p.urgencyScore = computeUrgencyScore(p);
      p.urgenciaBidireccional = computeUrgenciaBidireccional(p);
      return p;
    });

    // Filter by clinic if specified or user is encargada_ventas
    if (session.rol === "encargada_ventas" && session.clinica) {
      items = items.filter((p) => p.clinica === session.clinica);
    } else if (clinicaFilter) {
      items = items.filter((p) => p.clinica === clinicaFilter);
    }

    // Generate missing mensajeSugerido (batch, max 5 at a time to avoid slowness)
    const sinMensaje = items.filter((p) => !p.mensajeSugerido).slice(0, 5);
    if (sinMensaje.length > 0) {
      const generaciones = sinMensaje.map(async (p) => {
        const msg = await generarMensajeSugerido({
          patientName: p.patientName,
          treatments: p.treatments,
          estado: p.estado,
          amount: p.amount,
          intencion: p.intencionDetectada,
          clinica: p.clinica,
        });
        if (msg) {
          p.mensajeSugerido = msg;
          // Save to Airtable in background
          base(TABLES.presupuestos as any)
            .update(p.id, { Mensaje_sugerido: msg } as any)
            .catch(() => {});
        }
      });
      await Promise.all(generaciones);
    }

    // Separate completed today vs pending
    const completadosHoy: PresupuestoIntervencion[] = [];
    const pendientes: PresupuestoIntervencion[] = [];

    for (const p of items) {
      if (p.ultimaAccionRegistrada) {
        const accionDate = DateTime.fromISO(p.ultimaAccionRegistrada).setZone(ZONE).startOf("day");
        if (accionDate.equals(today) && p.tipoUltimaAccion && p.tipoUltimaAccion !== "Mensaje recibido") {
          completadosHoy.push(p);
          continue;
        }
      }
      pendientes.push(p);
    }

    // Group pending items into sections
    const secciones: SeccionIntervencion[] = INTENCION_SECTIONS.map((sec) => {
      const sectionItems = pendientes
        .filter((p) => {
          const intencion = p.intencionDetectada ?? "Sin clasificar";
          return sec.intenciones.includes(intencion);
        })
        .sort((a, b) => {
          const ua = URGENCIA_ORDER[a.urgenciaIntervencion ?? "NINGUNO"] ?? 4;
          const ub = URGENCIA_ORDER[b.urgenciaIntervencion ?? "NINGUNO"] ?? 4;
          if (ua !== ub) return ua - ub;
          // Then by fecha ultima respuesta (most recent first)
          const da = a.fechaUltimaRespuesta ?? "";
          const db = b.fechaUltimaRespuesta ?? "";
          return db.localeCompare(da);
        });

      return {
        id: sec.id,
        titulo: sec.titulo,
        color: sec.color,
        icono: sec.icono,
        hexAccent: sec.hexAccent,
        items: sectionItems,
      };
    }).filter((s) => s.items.length > 0);

    // Extract unique filter values
    const clinicas = [...new Set(items.map((p) => p.clinica).filter(Boolean) as string[])].sort();
    const doctores = [...new Set(items.map((p) => p.doctor).filter(Boolean) as string[])].sort();
    const tratamientos = [...new Set(items.flatMap((p) => p.treatments))].sort();

    return NextResponse.json({
      secciones,
      allItems: pendientes,
      totalPendientes: pendientes.length,
      completadasHoy: completadosHoy.length,
      casosCompletados: completadosHoy,
      clinicas,
      doctores,
      tratamientos,
    });
  } catch (err) {
    console.error("[intervencion] GET error:", err);
    return NextResponse.json({
      secciones: [],
      allItems: [],
      totalPendientes: 0,
      completadasHoy: 0,
      casosCompletados: [],
      clinicas: [],
      doctores: [],
      tratamientos: [],
      error: "Error al cargar cola de intervención",
    });
  }
}
