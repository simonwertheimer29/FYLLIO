// app/api/presupuestos/maxima/route.ts
// GET — devuelve TODOS los presupuestos (último año) para Vista Máxima

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { DateTime } from "luxon";
import { computeUrgencyScore } from "../../../lib/presupuestos/urgency";
import type {
  UserSession,
  PresupuestoMaxima,
  MaximaResponse,
  EstadoVisual,
  IntencionDetectada,
  UrgenciaIntervencion,
  FaseSeguimiento,
  TipoUltimaAccionIntervencion,
  PresupuestoEstado,
  UrgenciaBidireccional,
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

// -------------------------------------------------------------------
// EstadoVisual — computa el estado visual para la tabla Máxima
// -------------------------------------------------------------------

function computeEstadoVisual(p: {
  estado: PresupuestoEstado;
  urgenciaIntervencion?: UrgenciaIntervencion;
  intencionDetectada?: IntencionDetectada;
  contactCount: number;
  ultimaRespuestaPaciente?: string;
}): EstadoVisual {
  if (p.estado === "ACEPTADO") return "Cerrado ganado";
  if (p.estado === "PERDIDO") return "Cerrado perdido";

  // Acepta sin pagar: urgencia activa + intención de aceptación
  if (
    p.urgenciaIntervencion &&
    p.urgenciaIntervencion !== "NINGUNO" &&
    p.intencionDetectada &&
    (p.intencionDetectada === "Acepta sin condiciones" ||
     p.intencionDetectada === "Acepta pero pregunta pago")
  ) {
    return "Acepta sin pagar";
  }

  // Necesita intervención: urgencia activa
  if (p.urgenciaIntervencion && p.urgenciaIntervencion !== "NINGUNO") {
    return "Necesita intervención";
  }

  // Sin contacto
  if (p.contactCount === 0) return "Inicial";

  // Primer contacto
  if (p.contactCount === 1) return "Primer contacto";

  // Segundo contacto+ sin respuesta del paciente
  if (p.contactCount >= 2 && !p.ultimaRespuestaPaciente) {
    return "Segundo contacto";
  }

  return "Primer contacto";
}

// -------------------------------------------------------------------
// Texto descriptivo de última acción
// -------------------------------------------------------------------

const TIPO_ACCION_LABEL: Record<string, string> = {
  "WhatsApp enviado": "WA enviado",
  "Llamada realizada": "Llamada",
  "Mensaje recibido": "Resp. paciente",
  "Sin respuesta tras llamada": "Sin resp. llamada",
};

function computeUltimaAccionTexto(p: {
  tipoUltimaAccion?: TipoUltimaAccionIntervencion;
  ultimaAccionRegistrada?: string;
  contactCount: number;
  ultimaRespuestaPaciente?: string;
  fechaUltimaRespuesta?: string;
}): string {
  if (p.tipoUltimaAccion && p.ultimaAccionRegistrada) {
    const label = TIPO_ACCION_LABEL[p.tipoUltimaAccion] ?? p.tipoUltimaAccion;
    const dias = daysSince(p.ultimaAccionRegistrada);
    if (dias === 0) return `${label} hoy`;
    if (dias === 1) return `${label} ayer`;
    return `${label} hace ${dias}d`;
  }
  if (p.ultimaRespuestaPaciente && p.fechaUltimaRespuesta) {
    const dias = daysSince(p.fechaUltimaRespuesta);
    if (dias === 0) return "Paciente respondió hoy";
    if (dias === 1) return "Paciente respondió ayer";
    return `Paciente respondió hace ${dias}d`;
  }
  if (p.contactCount > 0) return `Contactado (${p.contactCount}x)`;
  return "Sin actividad";
}

// -------------------------------------------------------------------
// Texto descriptivo de próxima acción sugerida
// -------------------------------------------------------------------

function computeProximaAccionTexto(estadoVisual: EstadoVisual): string | undefined {
  switch (estadoVisual) {
    case "Inicial":
      return "Enviar primer mensaje";
    case "Primer contacto":
      return "Segundo seguimiento";
    case "Segundo contacto":
      return "Llamar para seguimiento";
    case "Necesita intervención":
      return "Intervención urgente";
    case "Acepta sin pagar":
      return "Gestionar pago";
    case "Con cita sin pagar":
      return "Confirmar pago pre-cita";
    case "Tratamiento iniciado":
      return "Verificar evolución";
    case "Cerrado ganado":
    case "Cerrado perdido":
      return undefined;
  }
}

// -------------------------------------------------------------------
// Urgencia bidireccional (replicada del endpoint intervencion)
// -------------------------------------------------------------------

const INTENCION_SCORE: Record<string, number> = {
  "Acepta sin condiciones": 40,
  "Acepta pero pregunta pago": 40,
  "Pide oferta/descuento": 25,
  "Tiene duda sobre tratamiento": 20,
  "Sin clasificar": 15,
  "Quiere pensarlo": 10,
  "Rechaza": 5,
};

const INTENCIONES_CIERRE: Array<string | undefined> = [
  "Acepta sin condiciones",
  "Acepta pero pregunta pago",
];

function computeUrgenciaBidireccional(p: {
  intencionDetectada?: IntencionDetectada;
  fechaUltimaRespuesta?: string;
  ultimaAccionRegistrada?: string;
  amount?: number;
  estado: PresupuestoEstado;
}): UrgenciaBidireccional {
  const scoreIntencion = INTENCION_SCORE[p.intencionDetectada ?? "Sin clasificar"] ?? 15;
  const esCierre = INTENCIONES_CIERRE.includes(p.intencionDetectada);

  let scoreRespClinica = 0;
  let minutosDesdeRespuesta = Infinity;
  if (p.fechaUltimaRespuesta) {
    const respuestaMs = new Date(p.fechaUltimaRespuesta).getTime();
    const accionMs = p.ultimaAccionRegistrada
      ? new Date(p.ultimaAccionRegistrada).getTime()
      : 0;
    if (accionMs < respuestaMs) {
      minutosDesdeRespuesta = (Date.now() - respuestaMs) / (1000 * 60);
      const horasSinRespuesta = minutosDesdeRespuesta / 60;
      if (horasSinRespuesta > 48) scoreRespClinica = 30;
      else if (horasSinRespuesta > 24) scoreRespClinica = 25;
      else if (horasSinRespuesta > 12) scoreRespClinica = 20;
      else if (horasSinRespuesta > 6) scoreRespClinica = 15;
      else if (horasSinRespuesta > 2) scoreRespClinica = 10;
      else scoreRespClinica = 5;
    }
  }

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
  let scoreCierre = Math.min(importeScore + estadoScore, 30);
  if (esCierre) scoreCierre = Math.max(scoreCierre, 15);

  const bonusReciente = esCierre && minutosDesdeRespuesta < 30 ? 10 : 0;

  return {
    scoreFinal: scoreIntencion + scoreRespClinica + scoreCierre + bonusReciente,
    scoreIntencion,
    scoreRespClinica,
    scoreCierre,
  };
}

// -------------------------------------------------------------------
// GET /api/presupuestos/maxima
// -------------------------------------------------------------------

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({
      presupuestos: [],
      totales: { total: 0, importeTotal: 0, porEstadoVisual: {} },
      doctoresUnicos: [],
      tratamientosUnicos: [],
      clinicasUnicas: [],
    });
  }

  try {
    // Fetch TODOS los presupuestos del último año (sin filtrar por estado)
    const filterFormula = `IS_AFTER({Fecha}, DATEADD(TODAY(), -12, 'months'))`;

    const query = base(TABLES.presupuestos as any).select({
      fields: [
        // Campos base (kanban)
        "Paciente_nombre", "Teléfono", "Tratamiento_nombre",
        "Importe", "Estado", "Fecha", "Notas",
        "Paciente_Telefono", "Doctor", "Doctor_Especialidad",
        "TipoPaciente", "TipoVisita", "FechaAlta", "Clinica",
        "ContactCount", "CreadoPor", "OrigenLead", "MotivoDuda", "OfertaActiva",
        "MotivoPerdida", "MotivoPerdidaTexto",
        // Campos de intervención
        "Ultima_respuesta_paciente", "Fecha_ultima_respuesta",
        "Intencion_detectada", "Urgencia_intervencion",
        "Accion_sugerida", "Mensaje_sugerido",
        "Fase_seguimiento", "Ultima_accion_registrada", "Tipo_ultima_accion",
      ],
      filterByFormula: filterFormula,
      sort: [{ field: "Fecha", direction: "desc" }],
    });

    const recs = await fetchAll(query);

    // Map records → PresupuestoMaxima
    let items: PresupuestoMaxima[] = recs.map((r) => {
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

      let diasDesdeUltimoContacto: number | undefined;
      if (fechaUltimaRespuesta) {
        diasDesdeUltimoContacto = daysSince(fechaUltimaRespuesta);
      } else if (ultimaAccionRegistrada) {
        diasDesdeUltimoContacto = daysSince(ultimaAccionRegistrada);
      }

      const contactCount = Number(f["ContactCount"] ?? 0);

      const estadoVisual = computeEstadoVisual({
        estado,
        urgenciaIntervencion,
        intencionDetectada,
        contactCount,
        ultimaRespuestaPaciente,
      });

      const p: PresupuestoMaxima = {
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
        contactCount,
        createdBy: f["CreadoPor"] ? String(f["CreadoPor"]) : undefined,
        origenLead: f["OrigenLead"] || undefined,
        motivoDuda: f["MotivoDuda"] || undefined,
        motivoPerdida: f["MotivoPerdida"] || undefined,
        motivoPerdidaTexto: f["MotivoPerdidaTexto"]
          ? String(f["MotivoPerdidaTexto"])
          : undefined,
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
        // Maxima-specific
        estadoVisual,
        ultimaAccionTexto: computeUltimaAccionTexto({ tipoUltimaAccion, ultimaAccionRegistrada, contactCount, ultimaRespuestaPaciente, fechaUltimaRespuesta }),
        proximaAccionTexto: computeProximaAccionTexto(estadoVisual),
      };

      p.urgencyScore = computeUrgencyScore(p);
      p.urgenciaBidireccional = computeUrgenciaBidireccional(p);
      return p;
    });

    // Filter by clinic for encargada_ventas
    const url = new URL(req.url);
    const clinicaFilter = url.searchParams.get("clinica") || "";
    if (session.rol === "encargada_ventas" && session.clinica) {
      items = items.filter((p) => p.clinica === session.clinica);
    } else if (clinicaFilter) {
      items = items.filter((p) => p.clinica === clinicaFilter);
    }

    // Sort: urgencyScore DESC, then fecha DESC
    items.sort((a, b) => {
      if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
      return b.fechaPresupuesto.localeCompare(a.fechaPresupuesto);
    });

    // Compute totals
    const porEstadoVisual: Record<string, number> = {};
    let importeTotal = 0;
    for (const p of items) {
      porEstadoVisual[p.estadoVisual] = (porEstadoVisual[p.estadoVisual] ?? 0) + 1;
      if (p.amount != null) importeTotal += p.amount;
    }

    // Extract unique filter values
    const clinicasUnicas = [...new Set(items.map((p) => p.clinica).filter(Boolean) as string[])].sort();
    const doctoresUnicos = [...new Set(items.map((p) => p.doctor).filter(Boolean) as string[])].sort();
    const tratamientosUnicos = [...new Set(items.flatMap((p) => p.treatments))].sort();

    const response: MaximaResponse = {
      presupuestos: items,
      totales: {
        total: items.length,
        importeTotal,
        porEstadoVisual,
      },
      doctoresUnicos,
      tratamientosUnicos,
      clinicasUnicas,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[maxima] GET error:", err);
    return NextResponse.json({
      presupuestos: [],
      totales: { total: 0, importeTotal: 0, porEstadoVisual: {} },
      doctoresUnicos: [],
      tratamientosUnicos: [],
      clinicasUnicas: [],
      error: "Error al cargar vista máxima",
    });
  }
}
