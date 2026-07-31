// Cohortes de Seguimiento (rediseño "Actuar hoy" → "Seguimiento", 2026-07-25).
//
// CAPA DE PRESENTACIÓN sobre el motor existente — no persiste nada y no
// redefine ningún criterio: consume estadoConversacion (la clasificación
// única de conversaciones) y la precedencia ya establecida
// cerrado > cita > conversación. Un caso cerrado (Convertido/No Interesado,
// ACEPTADO/PERDIDO) no llega aquí: el caller filtra activos ANTES.
//
// Invariante central: todo caso ACTIVO cae en EXACTAMENTE UNA cohorte.
// Se cumple por construcción (switch exhaustivo sobre EstadoConversacion,
// que es total) y se vigila en scripts/qa-cohortes.mts contra el seed.
//
// Módulo PURO y client-safe: lo consumen la UI de Seguimiento y el QA.

import type { EstadoConversacion } from "../presupuestos/estado-conversacion";
import {
  UMBRAL_REACTIVACION_DIAS,
  diasDeClinicaEntre,
} from "../presupuestos/estado-conversacion";

// "rezagados" se muestra en UI como "Sin respuesta" (renombre 2026-07-26);
// el id interno no cambia para no tocar QA ni enlaces.
export type CohorteLead = "citados" | "nuevos" | "en_conversacion" | "rezagados";
export type CohortePresupuesto = "nuevos" | "en_conversacion" | "rezagados";

/**
 * Umbral de urgencia dentro de "Nuevos": un lead sin primer contacto que lleva
 * estos DÍAS DE CLÍNICA sube con señal visible. Es EL MISMO umbral de
 * reactivación de leads — la justificación del motor ("un lead se enfría
 * rápido") aplica con más razón al que nadie ha tocado nunca.
 *
 * Se llamaba `NUEVO_URGENTE_MS` y era el umbral en milisegundos. Al pasar el
 * umbral a días (2026-07-31) el nombre viejo habría seguido COMPILANDO y
 * significando "2 milisegundos": todos los leads urgentes, para siempre, sin
 * un solo error. Por eso cambia el nombre y el tipo del parámetro.
 */
export const NUEVO_URGENTE_DIAS = UMBRAL_REACTIVACION_DIAS.lead;

/** Un lead sin primer contacto que ya superó el umbral. Vivía suelto dentro de
 *  SeguimientoView; sube aquí porque el tablero de Leads pinta la misma señal
 *  y dos copias del mismo umbral acaban divergiendo. */
export const esNuevoUrgente = (createdAt: string, ahora: Date) => {
  const alta = new Date(createdAt);
  if (!Number.isFinite(alta.getTime())) return false;
  return diasDeClinicaEntre(alta, ahora) >= NUEVO_URGENTE_DIAS;
};

/**
 * Cohorte de un lead ACTIVO. Precedencia (la del motor, intacta):
 *   1. cita hoy o futura → citados (el trabajo es confirmar/recordar; con
 *      cita por delante no se espera respuesta ni se reactiva).
 *   2. resto → por estadoConversacion:
 *      sin_conversacion → nuevos · pendiente_responder / en_espera_paciente
 *      → en_conversacion · reactivable → rezagados.
 */
export function cohorteLead(args: {
  /** fecha_cita en ISO fecha (YYYY-MM-DD) o null. */
  fechaCita: string | null;
  /** Hoy en ISO fecha — lo pasa el caller para que QA y UI usen el mismo instante. */
  hoy: string;
  conversacion: EstadoConversacion;
}): CohorteLead {
  if (args.fechaCita && args.fechaCita >= args.hoy) return "citados";
  switch (args.conversacion) {
    case "sin_conversacion":
      return "nuevos";
    case "pendiente_responder":
    case "en_espera_paciente":
      return "en_conversacion";
    case "reactivable":
      return "rezagados";
  }
}

/**
 * Cohorte de un presupuesto ABIERTO (ni ACEPTADO ni PERDIDO). Sin dimensión
 * de cita: mapeo directo del estado de conversación (el de
 * conversacionDePresupuesto, umbral 72 h).
 */
export function cohortePresupuesto(conversacion: EstadoConversacion): CohortePresupuesto {
  switch (conversacion) {
    case "sin_conversacion":
      return "nuevos";
    case "pendiente_responder":
    case "en_espera_paciente":
      return "en_conversacion";
    case "reactivable":
      return "rezagados";
  }
}
