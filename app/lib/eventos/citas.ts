// app/lib/eventos/citas.ts
// Sprint 18 Bloque 2 — puente entre el ciclo de vida de las Citas y el emitter.
//
// Resuelve el contexto (SIN PII: solo IDs + tipo de tratamiento) desde el
// registro de la cita y emite el evento comportamental correspondiente.
// Para asistió / no-show además dispara el cierre de loop del predictor.

import { getAppointmentByRecordId } from "@/lib/scheduler/repo/airtableRepo";
import { emitirEventoFireAndForget } from "@/lib/eventos/emitter";
import type { TipoEvento } from "@/lib/supabase/client";

export type CitaLifecycle =
  | "creada"
  | "confirmada"
  | "cancelada"
  | "asistio"
  | "no_show";

const TIPO_POR_LIFECYCLE: Record<CitaLifecycle, TipoEvento> = {
  creada: "cita_creada",
  confirmada: "cita_confirmada",
  cancelada: "cita_cancelada",
  asistio: "cita_asistio",
  no_show: "cita_no_show",
};

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

/** clinica_id estable (no PII) desde los campos de la cita, con fallback a env. */
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

/**
 * Emite el evento de ciclo de vida de una cita (fire-and-forget). Resuelve el
 * contexto leyendo la cita; si la lectura falla, descarta en silencio (nunca
 * bloquea ni rompe el flujo principal que la disparó).
 */
export async function emitirEventoCitaLifecycle(
  lifecycle: CitaLifecycle,
  appointmentRecordId: string,
): Promise<void> {
  try {
    const cita = await getAppointmentByRecordId(appointmentRecordId);
    const f = (cita.fields ?? {}) as Record<string, unknown>;
    const clinica = resolveClinicaId(f);
    const paciente = cita.patientRecordId ?? null;
    const tipo = TIPO_POR_LIFECYCLE[lifecycle];

    // Contexto SIN PII: solo IDs y metadata categórica.
    const contexto: Record<string, unknown> = {
      cita_id: appointmentRecordId,
      tratamiento: cita.treatmentName || null,
      fecha_hora_inicio: cita.start || null,
      profesional_id: cita.staffId || null,
      origen: firstString(f["Origen"]) || null,
      estado: firstString(f["Estado"]) || null,
    };

    const resultadoFinal =
      lifecycle === "asistio" ? "asistio" : lifecycle === "no_show" ? "no_show" : null;

    emitirEventoFireAndForget({
      tipo,
      clinica,
      paciente,
      contexto,
      resultadoFinal,
    });

    // Cierre de loop del predictor: actualiza factores_no_show.resultado_real
    // y prediccion_correcta. Import dinámico para evitar acoplar el repo al
    // predictor en tiempo de carga.
    if (lifecycle === "asistio" || lifecycle === "no_show") {
      import("@/lib/no-shows/predictor")
        .then((m) => m.cerrarLoopNoShow(appointmentRecordId, lifecycle === "asistio" ? "asistio" : "no_show"))
        .catch(() => {
          /* swallow: el cierre de loop es best-effort */
        });
    }
  } catch {
    /* swallow: emisión de eventos nunca debe propagar */
  }
}
