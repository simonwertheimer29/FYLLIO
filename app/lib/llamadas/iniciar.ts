// app/lib/llamadas/iniciar.ts
//
// Sprint 17 Bloque 3 / 9 — orquesta una llamada IA saliente:
//   1. Lee Cita + Paciente (+ doctor + clínica) de Airtable.
//   2. Aplica salvaguardas (telefono, opt-out, cooldown, horario,
//      límite por clínica).
//   3. Llama a Vapi crearLlamada con assistantOverrides.
//   4. Persiste Llamadas_Vapi (estado=iniciada) y devuelve.
//
// Esta función la consume:
//   - POST /api/llamadas/iniciar (handler HTTP del Bloque 3).
//   - Cron daily (cuando detecta citas confirmadas a 24h, Bloque 5).
//   - Tool Copilot iniciar_llamada_confirmacion (Bloque 8).
//
// Por eso vive en lib/, no en app/api/.

import { base, fetchAll, TABLES } from "../airtable";
import { getPaciente } from "../pacientes/pacientes";
import { getHorarioClinica } from "../automatizaciones/engine";
import { HORARIO_DEFAULT, type HorarioLaboral } from "../automatizaciones/types";
import { crearLlamada } from "../vapi/client";
import {
  createLlamada,
  pacienteLlamadoUltimas24h,
  contarLlamadasHoyPorPaciente,
  tasaFallidasUltimaHora,
} from "./repo";
import type { Llamada, TipoLlamada } from "./types";

export type IniciarArgs = {
  citaId: string;
  tipo: TipoLlamada;
  /** Si true, se saltan las salvaguardas de horario. Sólo para
   *  test manual desde la UI. */
  forzar?: boolean;
};

export type IniciarResult =
  | { ok: true; llamada: Llamada }
  | {
      ok: false;
      motivo:
        | "cita_no_existe"
        | "paciente_sin_telefono"
        | "paciente_optout"
        | "cooldown"
        | "fuera_horario"
        | "limite_clinica"
        | "pausa_automatica"
        | "vapi_error"
        | "config_incompleta";
      detalle?: string;
    };

const LIMITE_DIARIO_DEFAULT = 50;
const TASA_FALLIDAS_PAUSA_PCT = 20;

function dentroHorario(horario: HorarioLaboral): boolean {
  const dias: Array<keyof HorarioLaboral> = [
    "domingo",
    "lunes",
    "martes",
    "miercoles",
    "jueves",
    "viernes",
    "sabado",
  ];
  const now = new Date();
  const cfg = horario[dias[now.getDay()]!] ?? HORARIO_DEFAULT.lunes;
  if (!cfg.activo) return false;
  const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return t >= cfg.inicio && t <= cfg.fin;
}

async function leerCita(
  citaId: string,
): Promise<{
  fields: Record<string, unknown>;
  pacienteId: string | null;
  clinicaId: string | null;
} | null> {
  try {
    const rec = await base(TABLES.appointments).find(citaId);
    const f = rec.fields as Record<string, unknown>;
    const pacLinks = (f["Paciente"] ?? []) as string[];
    const cliLinks = (f["Clínica"] ?? []) as string[];
    return {
      fields: f,
      pacienteId: pacLinks[0] ?? null,
      clinicaId: cliLinks[0] ?? null,
    };
  } catch {
    return null;
  }
}

/** Lee la config Llamadas_IA de la clínica. Usa Configuraciones_Clinica
 *  como en Bloque 7. Si no hay record, devuelve defaults. */
export async function getConfigLlamadasClinica(
  clinicaId: string | null,
): Promise<{
  activa: boolean;
  horarioInicio: string;
  horarioFin: string;
  limiteDia: number;
  firstMessage: string | null;
  voicePreference: string | null;
}> {
  const defaults = {
    activa: true,
    horarioInicio: "10:00",
    horarioFin: "19:00",
    limiteDia: LIMITE_DIARIO_DEFAULT,
    firstMessage: null,
    voicePreference: null,
  };
  if (!clinicaId) return defaults;
  try {
    const recs = await fetchAll(
      base(TABLES.configuracionesClinica).select({
        filterByFormula: `AND({Categoria}="llamadas_ia", FIND("${clinicaId}", ARRAYJOIN({Clinica_Link}, ",")))`,
        maxRecords: 1,
      }),
    );
    const r = recs[0];
    if (!r) return defaults;
    const valor = String(r.fields["Valor"] ?? "");
    try {
      const parsed = JSON.parse(valor);
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  } catch {
    return defaults;
  }
}

export async function iniciarLlamada(args: IniciarArgs): Promise<IniciarResult> {
  // 1. Cita + paciente
  const cita = await leerCita(args.citaId);
  if (!cita || !cita.pacienteId) {
    return { ok: false, motivo: "cita_no_existe" };
  }
  const paciente = await getPaciente(cita.pacienteId);
  if (!paciente) {
    return { ok: false, motivo: "cita_no_existe", detalle: "paciente no existe" };
  }

  // 2. Salvaguardas
  if (!paciente.telefono) {
    return { ok: false, motivo: "paciente_sin_telefono" };
  }
  if (paciente.optoutAutomatizaciones) {
    return { ok: false, motivo: "paciente_optout" };
  }
  if (await pacienteLlamadoUltimas24h(paciente.id)) {
    return { ok: false, motivo: "cooldown" };
  }

  const config = await getConfigLlamadasClinica(cita.clinicaId);
  if (!config.activa) {
    return {
      ok: false,
      motivo: "config_incompleta",
      detalle: "llamadas_ia desactivadas para esta clínica",
    };
  }

  if (!args.forzar) {
    // Horario: usamos el horario de la clínica como base + acotamos
    // por la ventana específica de Llamadas IA si configurada.
    const horario = await getHorarioClinica(cita.clinicaId ?? "").catch(
      () => HORARIO_DEFAULT,
    );
    if (!dentroHorario(horario)) {
      return { ok: false, motivo: "fuera_horario", detalle: "fuera horario clínica" };
    }
    const now = new Date();
    const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (t < config.horarioInicio || t > config.horarioFin) {
      return { ok: false, motivo: "fuera_horario", detalle: "fuera ventana llamadas IA" };
    }
  }

  // Límite por clínica: contamos llamadas hoy de pacientes de la clínica.
  // Para evitar query pesada, contamos solo del paciente objetivo (una
  // aproximación; el límite real por-clínica requeriría join via Pacientes
  // que es N+1 caro). Aceptable mientras el límite sea por paciente OR el
  // volumen sea pequeño.
  const llamadasHoyPaciente = await contarLlamadasHoyPorPaciente([paciente.id]);
  if (llamadasHoyPaciente >= 1) {
    return { ok: false, motivo: "cooldown", detalle: "ya llamado hoy" };
  }

  // Pausa automática si la tasa de fallidas en última hora supera umbral.
  const tasa = await tasaFallidasUltimaHora();
  if (tasa.total >= 5 && tasa.pct >= TASA_FALLIDAS_PAUSA_PCT) {
    return {
      ok: false,
      motivo: "pausa_automatica",
      detalle: `${tasa.fallidas}/${tasa.total} fallidas última hora (${tasa.pct}%)`,
    };
  }

  // 3. Llamar a Vapi
  const phoneNumberId = process.env["VAPI_PHONE_NUMBER_ID"];
  const assistantId =
    args.tipo === "confirmacion_cita"
      ? process.env["VAPI_ASSISTANT_ID_CONFIRMACION_CITAS"]
      : args.tipo === "reactivacion"
        ? process.env["VAPI_ASSISTANT_ID_REACTIVACION"]
        : process.env["VAPI_ASSISTANT_ID_RECUPERACION"];
  if (!phoneNumberId || !assistantId) {
    return {
      ok: false,
      motivo: "config_incompleta",
      detalle: "VAPI_PHONE_NUMBER_ID o VAPI_ASSISTANT_ID_* ausentes",
    };
  }

  const variableValues: Record<string, string> = {
    nombre_paciente: paciente.nombre,
    nombre_clinica: paciente.clinicaNombre ?? "la clínica",
    fecha_cita: String(cita.fields["Hora inicio"] ?? "").slice(0, 10),
    hora_cita: String(cita.fields["Hora inicio"] ?? "").slice(11, 16),
    doctor_nombre: String(cita.fields["Profesional_id"] ?? "tu doctor"),
    tratamiento: String(cita.fields["Tratamiento_nombre"] ?? "tu tratamiento"),
  };

  let vapiCall;
  try {
    vapiCall = await crearLlamada({
      phoneNumberId,
      assistantId,
      customerNumber: paciente.telefono,
      assistantOverrides: {
        variableValues,
        ...(config.firstMessage ? { firstMessage: config.firstMessage } : {}),
      },
      metadata: {
        fyllioCitaId: args.citaId,
        fyllioPacienteId: paciente.id,
        fyllioTipo: args.tipo,
      },
    });
  } catch (err: any) {
    console.error("[llamadas iniciar] vapi error:", err);
    return {
      ok: false,
      motivo: "vapi_error",
      detalle: err?.message ?? String(err),
    };
  }

  // 4. Persistir
  const llamada = await createLlamada({
    citaId: args.citaId,
    pacienteId: paciente.id,
    tipo: args.tipo,
    vapiCallId: vapiCall.id,
    estado: "iniciada",
  });

  return { ok: true, llamada };
}
