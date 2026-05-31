// app/lib/no-shows/acciones.ts
// Sprint 18 Bloque 5 — orquestación de acciones del motor de no-shows.
//
// Acciones manuales (botones de las cards) + aplicación automática por nivel de
// riesgo (gated por config Motor_NoShows). Respeta salvaguardas:
//   - Optout_Automatizaciones del paciente (no se le manda nada).
//   - Cooldown 1 plantilla extra / 24h por paciente (Vercel KV).
//   - iniciarLlamada() aplica internamente sus propias salvaguardas
//     (opt-out, cooldown 1×/día, horario, límite clínica, pausa).
//
// NOTA DE DISEÑO: la aplicación automática (aplicarAccionesAutomaticasNoShow)
// existe como librería pero NO está cableada al cron daily en este sprint, para
// no duplicar mensajería con los recordatorios/confirmaciones existentes. Las
// acciones manuales desde la UI sí están activas. Ver docs/motor-no-shows.md.

import { kv } from "@vercel/kv";
import { getAppointmentByRecordId } from "@/lib/scheduler/repo/airtableRepo";
import { getPaciente } from "@/lib/pacientes/pacientes";
import { renderizarPlantilla, listPlantillas } from "@/lib/plantillas/plantillas";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { iniciarLlamada } from "@/lib/llamadas/iniciar";
import { base, TABLES } from "@/lib/airtable";
import { emitirEventoFireAndForget } from "@/lib/eventos/emitter";
import { getMotorConfig } from "@/lib/no-shows/config";
import type { RiesgoNivel } from "@/lib/supabase/client";

export const PLANTILLA_ALTO_RIESGO = "recordatorio_personalizado_alto_riesgo";
export const PLANTILLA_EXTRA_2H = "recordatorio_extra_2h_antes";

const COOLDOWN_PLANTILLA_EXTRA_SEG = 24 * 60 * 60; // 1 plantilla extra / 24h
const CONTACTADO_TTL_SEG = 14 * 24 * 60 * 60; // marca "contactado" 14 días

export type AccionNoShowTipo =
  | "programar_llamada_ia"
  | "enviar_plantilla_recordatorio"
  | "marcar_contactado"
  | "considerar_overbooking";

export type AplicarAccionResult = {
  ok: boolean;
  motivo?: string;
  detalle?: string;
};

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function resolveClinicaId(fields: Record<string, unknown>): string {
  return (
    firstString(fields["Clínica_id"]) ||
    firstString(fields["Clínica ID"]) ||
    firstString(fields["Clínica"]) ||
    process.env.DEMO_CLINIC_ID ||
    process.env.DEMO_CLINIC_RECORD_ID ||
    ""
  );
}

type CitaCtx = {
  pacienteId: string | null;
  phone: string;
  clinicaId: string;
  treatment: string;
};

async function getCitaCtx(citaId: string): Promise<CitaCtx | null> {
  try {
    const cita = await getAppointmentByRecordId(citaId);
    const f = (cita.fields ?? {}) as Record<string, unknown>;
    return {
      pacienteId: cita.patientRecordId ?? null,
      phone:
        firstString(f["Paciente_teléfono"]) || firstString(f["Paciente_tutor_teléfono"]) || "",
      clinicaId: resolveClinicaId(f),
      treatment: cita.treatmentName || "",
    };
  } catch {
    return null;
  }
}

// ─── Cooldown plantilla extra (KV) ─────────────────────────────────────

async function puedeEnviarPlantillaExtra(pacienteId: string): Promise<boolean> {
  try {
    const hit = await kv.get(`noshow:plantilla-extra:${pacienteId}`);
    return !hit;
  } catch {
    return true; // no bloquear por fallo de infra
  }
}

async function marcarPlantillaExtraEnviada(pacienteId: string): Promise<void> {
  try {
    await kv.set(`noshow:plantilla-extra:${pacienteId}`, Date.now(), {
      ex: COOLDOWN_PLANTILLA_EXTRA_SEG,
    });
  } catch {
    /* best-effort */
  }
}

// ─── Acción: enviar plantilla ──────────────────────────────────────────

async function enviarPlantilla(args: {
  ctx: CitaCtx;
  plantillaNombre: string;
  respetarCooldownExtra: boolean;
}): Promise<AplicarAccionResult> {
  const { ctx, plantillaNombre, respetarCooldownExtra } = args;
  if (!ctx.pacienteId) return { ok: false, motivo: "sin_paciente" };
  if (!ctx.phone) return { ok: false, motivo: "paciente_sin_telefono" };

  const paciente = await getPaciente(ctx.pacienteId);
  if (paciente?.optoutAutomatizaciones) return { ok: false, motivo: "paciente_optout" };

  if (respetarCooldownExtra) {
    const puede = await puedeEnviarPlantillaExtra(ctx.pacienteId);
    if (!puede) return { ok: false, motivo: "cooldown_plantilla_extra" };
  }

  // Buscar la plantilla por nombre (global o de la clínica).
  const plantillas = await listPlantillas();
  const plantilla =
    plantillas.find((p) => p.nombre === plantillaNombre && p.clinicaId === ctx.clinicaId && p.activa) ||
    plantillas.find((p) => p.nombre === plantillaNombre && p.clinicaId === null && p.activa) ||
    plantillas.find((p) => p.nombre === plantillaNombre && p.activa);
  if (!plantilla) return { ok: false, motivo: "plantilla_no_encontrada", detalle: plantillaNombre };

  const { texto } = await renderizarPlantilla({
    plantillaId: plantilla.id,
    pacienteId: ctx.pacienteId,
  });
  const to = ctx.phone.startsWith("whatsapp:") ? ctx.phone : `whatsapp:${ctx.phone}`;
  await sendWhatsAppMessage(to, texto);

  if (respetarCooldownExtra) await marcarPlantillaExtraEnviada(ctx.pacienteId);

  emitirEventoFireAndForget({
    tipo: "mensaje_enviado",
    clinica: ctx.clinicaId,
    paciente: ctx.pacienteId,
    contexto: { canal: "whatsapp", plantilla: plantillaNombre, origen: "motor_no_shows" },
  });

  return { ok: true, detalle: plantillaNombre };
}

// ─── Acción: alerta overbooking ────────────────────────────────────────

async function alertaOverbooking(ctx: CitaCtx, citaId: string): Promise<AplicarAccionResult> {
  try {
    await base(TABLES.alertasEnviadas).create(
      [
        {
          fields: {
            Resumen: `[overbooking] cita riesgo alto ${citaId.slice(-6)}`,
            Tipo: "overbooking",
            Mensaje: `Cita de riesgo alto (${ctx.treatment || "tratamiento"}). Considerá overbooking / reagendar el hueco.`,
            Urgencia: "media",
            Created_At: new Date().toISOString(),
          },
        },
      ],
      { typecast: true },
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: "alerta_error", detalle: String(e) };
  }
}

// ─── Acción: marcar contactado (KV flag leído por la API del motor) ─────

async function marcarContactado(ctx: CitaCtx, citaId: string): Promise<AplicarAccionResult> {
  try {
    await kv.set(`noshow:contactado:${citaId}`, Date.now(), { ex: CONTACTADO_TTL_SEG });
  } catch {
    /* best-effort */
  }
  emitirEventoFireAndForget({
    tipo: "accion_cerrada",
    clinica: ctx.clinicaId,
    paciente: ctx.pacienteId,
    contexto: { cita_id: citaId, accion: "marcar_contactado", origen: "motor_no_shows" },
  });
  return { ok: true };
}

/** True si la cita fue marcada como contactada (para la UI). Nunca lanza. */
export async function estaContactado(citaId: string): Promise<boolean> {
  try {
    return Boolean(await kv.get(`noshow:contactado:${citaId}`));
  } catch {
    return false;
  }
}

// ─── Entry point manual (botones de las cards) ─────────────────────────

export async function aplicarAccionNoShow(args: {
  citaId: string;
  accion: AccionNoShowTipo;
  manual?: boolean;
  plantillaNombre?: string;
}): Promise<AplicarAccionResult> {
  const ctx = await getCitaCtx(args.citaId);
  if (!ctx) return { ok: false, motivo: "cita_no_existe" };

  switch (args.accion) {
    case "programar_llamada_ia": {
      const r = await iniciarLlamada({
        citaId: args.citaId,
        tipo: "confirmacion_cita",
        manual: args.manual ?? true,
      });
      if (r.ok) {
        emitirEventoFireAndForget({
          tipo: "llamada_iniciada",
          clinica: ctx.clinicaId,
          paciente: ctx.pacienteId,
          contexto: { cita_id: args.citaId, origen: "motor_no_shows" },
        });
        return { ok: true };
      }
      return { ok: false, motivo: r.motivo, detalle: r.detalle };
    }
    case "enviar_plantilla_recordatorio":
      return enviarPlantilla({
        ctx,
        plantillaNombre: args.plantillaNombre ?? PLANTILLA_ALTO_RIESGO,
        // Manual: respeta el cooldown de plantilla extra igual (evita spam).
        respetarCooldownExtra: true,
      });
    case "considerar_overbooking":
      return alertaOverbooking(ctx, args.citaId);
    case "marcar_contactado":
      return marcarContactado(ctx, args.citaId);
    default:
      return { ok: false, motivo: "accion_no_soportada" };
  }
}

// ─── Aplicación automática por nivel (gated por config) ────────────────
// Disponible para cablear al cron cuando el equipo lo decida. Ver nota arriba.

export async function aplicarAccionesAutomaticasNoShow(args: {
  citaId: string;
  nivel: RiesgoNivel;
  clinicaId: string | null;
}): Promise<{ ejecutadas: string[]; saltadas: Array<{ accion: string; motivo: string }> }> {
  const ejecutadas: string[] = [];
  const saltadas: Array<{ accion: string; motivo: string }> = [];
  const cfg = await getMotorConfig(args.clinicaId);

  if (!cfg.activarPrediccion) {
    return { ejecutadas, saltadas: [{ accion: "todas", motivo: "prediccion_desactivada" }] };
  }

  const ctx = await getCitaCtx(args.citaId);
  if (!ctx) return { ejecutadas, saltadas: [{ accion: "todas", motivo: "cita_no_existe" }] };

  if (args.nivel === "alto") {
    if (cfg.llamadaIaAuto) {
      const r = await iniciarLlamada({ citaId: args.citaId, tipo: "confirmacion_cita", manual: false });
      if (r.ok) {
        ejecutadas.push("programar_llamada_ia");
        emitirEventoFireAndForget({
          tipo: "llamada_iniciada",
          clinica: ctx.clinicaId,
          paciente: ctx.pacienteId,
          contexto: { cita_id: args.citaId, origen: "motor_no_shows_auto" },
        });
      } else {
        saltadas.push({ accion: "programar_llamada_ia", motivo: r.motivo });
      }
    } else {
      saltadas.push({ accion: "programar_llamada_ia", motivo: "toggle_off" });
    }

    if (cfg.plantillasExtraAuto) {
      const r = await enviarPlantilla({ ctx, plantillaNombre: PLANTILLA_ALTO_RIESGO, respetarCooldownExtra: true });
      if (r.ok) ejecutadas.push("enviar_plantilla_personalizada");
      else saltadas.push({ accion: "enviar_plantilla_personalizada", motivo: r.motivo ?? "error" });
    } else {
      saltadas.push({ accion: "enviar_plantilla_personalizada", motivo: "toggle_off" });
    }

    const a = await alertaOverbooking(ctx, args.citaId);
    if (a.ok) ejecutadas.push("alerta_overbooking");
    else saltadas.push({ accion: "alerta_overbooking", motivo: a.motivo ?? "error" });
  } else if (args.nivel === "medio") {
    if (cfg.plantillasExtraAuto) {
      const r = await enviarPlantilla({ ctx, plantillaNombre: PLANTILLA_EXTRA_2H, respetarCooldownExtra: true });
      if (r.ok) ejecutadas.push("enviar_recordatorio_extra");
      else saltadas.push({ accion: "enviar_recordatorio_extra", motivo: r.motivo ?? "error" });
    } else {
      saltadas.push({ accion: "enviar_recordatorio_extra", motivo: "toggle_off" });
    }
  }
  // nivel bajo: recordatorio estándar (lo cubre el cron daily existente).

  return { ejecutadas, saltadas };
}
