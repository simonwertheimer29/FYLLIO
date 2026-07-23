// app/api/presupuestos/intervencion/route.ts
// GET — devuelve la cola de intervención del día. P3 unificación (2026-07-23):
// TODOS los casos viajan en allItems con su item.conversacion; las pestañas
// (Actuar ahora / Esperando respuesta) clasifican en cliente con esa única
// verdad. Se eliminó el split "completados hoy" (segunda representación del
// viejo criterio de espera) y las "secciones" por intención (payload muerto).

import { NextResponse } from "next/server";
import { selectPresupuestosRaw, updatePresupuestoRaw } from "../../../lib/presupuestos/repo";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { DateTime } from "luxon";
import { computeUrgencyScore } from "../../../lib/presupuestos/urgency";
import { generarMensajeSugerido } from "../../../lib/presupuestos/intervencion";
import type {
  PresupuestoIntervencion,
  IntencionDetectada,
  UrgenciaIntervencion,
  UrgenciaBidireccional,
  FaseSeguimiento,
  TipoUltimaAccionIntervencion,
  PresupuestoEstado,
} from "../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { nombresClinicasPermitidas, permiteClinica } from "../../../lib/presupuestos/clinica-scope";
import { ultimosMensajesPorConversacion } from "../../../lib/presupuestos/mensajeria";
import {
  estadoConversacion,
  UMBRAL_REACTIVACION_MS,
} from "../../../lib/presupuestos/estado-conversacion";

export const dynamic = "force-dynamic";

// Acciones registradas que cuentan como toque SALIENTE de la clínica
// (complemento del hilo para llamadas y aperturas de chat sin texto).
const TIPOS_ACCION_SALIENTE = new Set<string>([
  "WhatsApp enviado",
  "Llamada realizada",
  "Sin respuesta tras llamada",
]);

const ZONE = "Europe/Madrid";

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

// -------------------------------------------------------------------
// Urgencia bidireccional (3 ejes)
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

function computeUrgenciaBidireccional(p: PresupuestoIntervencion): UrgenciaBidireccional {
  // Eje 1 — Intención del paciente (0-40)
  const scoreIntencion = INTENCION_SCORE[p.intencionDetectada ?? "Sin clasificar"] ?? 15;
  const esCierre = INTENCIONES_CIERRE.includes(p.intencionDetectada);

  // Eje 2 — Tiempo de respuesta de la clínica (0-30)
  let scoreRespClinica = 0;
  let minutosDesdeRespuesta = Infinity;
  if (p.fechaUltimaRespuesta) {
    const respuestaMs = new Date(p.fechaUltimaRespuesta).getTime();
    const accionMs = p.ultimaAccionRegistrada
      ? new Date(p.ultimaAccionRegistrada).getTime()
      : 0;
    // Solo cuenta si la clínica no ha respondido después de la última respuesta del paciente
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
  let scoreCierre = Math.min(importeScore + estadoScore, 30);
  if (esCierre) scoreCierre = Math.max(scoreCierre, 15);

  // Bonus: mensaje de cierre recibido hace <30 min → +10 (empuja a "Actuar ahora")
  const bonusReciente = esCierre && minutosDesdeRespuesta < 30 ? 10 : 0;

  return {
    scoreFinal: scoreIntencion + scoreRespClinica + scoreCierre + bonusReciente,
    scoreIntencion,
    scoreRespClinica,
    scoreCierre,
  };
}

// -------------------------------------------------------------------
// GET /api/presupuestos/intervencion
// -------------------------------------------------------------------

export const GET = withPresupuestosAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const clinicaFilter = url.searchParams.get("clinica") || "";

  // Check env vars
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({
      allItems: [],
      clinicas: [],
      doctores: [],
      tratamientos: [],
      isDemo: true,
    });
  }

  try {
    // Fetch presupuestos activos (no cerrados) que tengan respuesta, urgencia,
    // o estén "esperando respuesta" (envié y aún no contesta) — este último para
    // que un caso al que mandé WhatsApp no desaparezca de la cola.
    const filterFormula = `AND(
      {Estado}!='ACEPTADO',
      {Estado}!='PERDIDO',
      OR(
        {Ultima_respuesta_paciente}!='',
        AND({Urgencia_intervencion}!='', {Urgencia_intervencion}!='NINGUNO'),
        {Fase_seguimiento}='Esperando respuesta'
      )
    )`.replace(/\n\s*/g, "");

    const recsPromise = selectPresupuestosRaw({
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

    // El HILO (mensajes_whatsapp) es la fuente primaria del estado de cada
    // conversación (estadoConversacion); los timestamps persistidos del
    // presupuesto quedan como complemento (llamadas, datos pre-hilo).
    const [recs, ultimos] = await Promise.all([recsPromise, ultimosMensajesPorConversacion()]);

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

      // UNA clasificación para todas las pantallas: último mensaje del hilo,
      // complementado con la respuesta/acción registradas (llamadas y datos
      // previos al hilo). El cliente ya no recalcula su propio criterio.
      const hilo = ultimos.porPresupuesto.get(r.id);
      const accionSaliente =
        ultimaAccionRegistrada && tipoUltimaAccion && TIPOS_ACCION_SALIENTE.has(tipoUltimaAccion)
          ? ultimaAccionRegistrada
          : null;
      const entranteComplemento =
        !hilo?.entranteAt || (fechaUltimaRespuesta && fechaUltimaRespuesta > hilo.entranteAt)
          ? (fechaUltimaRespuesta ?? null)
          : null;
      p.conversacion = estadoConversacion(
        {
          ultimoEntranteAt: entranteComplemento ?? hilo?.entranteAt ?? null,
          ultimoSalienteAt: hilo?.salienteAt ?? null,
          ultimaAccionSalienteAt: accionSaliente,
        },
        UMBRAL_REACTIVACION_MS.presupuesto,
      );
      return p;
    });

    // Sprint B Fase 4 — aislamiento por clínica: restringir SIEMPRE a las
    // clínicas permitidas (IDs de la sesión); dentro de eso, el filtro elegido.
    const permitidas = await nombresClinicasPermitidas(session);
    if (permitidas) {
      items = items.filter((p) => permiteClinica(permitidas, p.clinica ?? ""));
    }
    if (clinicaFilter) {
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
          updatePresupuestoRaw(p.id, { Mensaje_sugerido: msg })
            .catch(() => {});
        }
      });
      await Promise.all(generaciones);
    }

    // Orden por prioridad (score bidireccional): la pestaña decide el resto.
    items.sort(
      (a, b) => (b.urgenciaBidireccional?.scoreFinal ?? 0) - (a.urgenciaBidireccional?.scoreFinal ?? 0),
    );

    // Extract unique filter values
    const clinicas = [...new Set(items.map((p) => p.clinica).filter(Boolean) as string[])].sort();
    const doctores = [...new Set(items.map((p) => p.doctor).filter(Boolean) as string[])].sort();
    const tratamientos = [...new Set(items.flatMap((p) => p.treatments))].sort();

    return NextResponse.json({
      allItems: items,
      clinicas,
      doctores,
      tratamientos,
    });
  } catch (err) {
    console.error("[intervencion] GET error:", err);
    return NextResponse.json({
      allItems: [],
      clinicas: [],
      doctores: [],
      tratamientos: [],
      error: "Error al cargar cola de intervención",
    });
  }
});
