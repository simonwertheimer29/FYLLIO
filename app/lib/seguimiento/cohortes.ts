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
//
// "quiebre" y "agotado" entran en 2026-08-05 (fase 1 de PLAN-AGENTE) como
// PRECEDENCIAS, no como valores nuevos del switch — ver la nota de `cohorteLead`.
export type CohorteLead = "quiebre" | "agotado" | "citados" | "nuevos" | "en_conversacion" | "rezagados";
export type CohortePresupuesto = "quiebre" | "agotado" | "nuevos" | "en_conversacion" | "rezagados";

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
 * POR QUÉ EL QUIEBRE ES UNA PRECEDENCIA Y NO UN CASO MÁS DEL SWITCH
 * (fase 1 de PLAN-AGENTE, 2026-08-05).
 *
 * La invariante «todo activo cae en exactamente una cohorte» se sostiene sobre
 * un `switch` EXHAUSTIVO de `EstadoConversacion`, que es un tipo total de cuatro
 * valores. El quiebre NO es uno de esos valores: es ortogonal — un caso quebrado
 * es *además* `pendiente_responder`, porque el paciente acaba de escribir algo.
 * Añadirlo como quinto `case` no compilaría, y forzarlo rompería la totalidad
 * que vigila `qa:cohortes`.
 *
 * Entra por encima, que es el mecanismo que este módulo YA usa con «citados»:
 * una guarda antes del switch. El switch queda intacto y sigue siendo la rama
 * por defecto, así que la partición se mantiene por construcción:
 *   · en dos sitios, imposible → la función es total y las guardas están ordenadas;
 *   · en ninguno, imposible    → el switch sigue cubriendo los cuatro estados.
 *
 * El caso quebrado CONSERVA su estado de conversación; la tarjeta pinta los dos.
 */
type Automatizacion = {
  /** `estadoAutomatizacion(...)` de `lib/automatizacion/estado`. El caller lo
   *  calcula una vez y lo pasa: aquí no se deriva nada dos veces. */
  estado?: "esperando" | "quebrado" | "en_manos_de_alguien" | "agotado" | "manual" | "cerrado";
};

/**
 * Cohorte de un lead ACTIVO. Precedencia (la del motor, ampliada por arriba):
 *   0. quebrado → quiebre · agotado → agotado   ← fase 1, exige criterio humano
 *   1. cita hoy o futura → citados (el trabajo es confirmar/recordar; con
 *      cita por delante no se espera respuesta ni se reactiva).
 *   2. resto → por estadoConversacion:
 *      sin_conversacion → nuevos · pendiente_responder / en_espera_paciente
 *      → en_conversacion · reactivable → rezagados.
 *
 * OJO CON LOS LEADS: `quiebre` no se produce hoy. `clasificarRespuesta` solo
 * corre para presupuestos —el webhook guarda los mensajes de leads sin
 * clasificarlos—, así que un lead nunca tiene `intencion_detectada` y nunca
 * quiebra. No está roto: esa mitad no se construyó, y va en la fase 2. Está
 * declarado en PLAN-AGENTE §fase 1, recorte 4. `agotado` sí funciona en leads,
 * porque sale de `whatsapp_enviados`, que sí se mantiene.
 */
export function cohorteLead(args: {
  /** fecha_cita en ISO fecha (YYYY-MM-DD) o null. */
  fechaCita: string | null;
  /** Hoy en ISO fecha — lo pasa el caller para que QA y UI usen el mismo instante. */
  hoy: string;
  conversacion: EstadoConversacion;
  automatizacion?: Automatizacion;
}): CohorteLead {
  if (args.automatizacion?.estado === "quebrado") return "quiebre";
  if (args.automatizacion?.estado === "agotado") return "agotado";
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
 * conversacionDePresupuesto, umbral 3 días), con las mismas dos precedencias.
 */
export function cohortePresupuesto(
  conversacion: EstadoConversacion,
  automatizacion?: Automatizacion,
): CohortePresupuesto {
  if (automatizacion?.estado === "quebrado") return "quiebre";
  if (automatizacion?.estado === "agotado") return "agotado";
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

/** Orden de la cola: lo que exige criterio primero. Lo usan la vista y el QA,
 *  para que «la primera cohorte» sea la misma en los dos sitios. */
export const ORDEN_COHORTE_LEAD: readonly CohorteLead[] = [
  "quiebre", "agotado", "citados", "nuevos", "en_conversacion", "rezagados",
];
export const ORDEN_COHORTE_PRESUPUESTO: readonly CohortePresupuesto[] = [
  "quiebre", "agotado", "nuevos", "en_conversacion", "rezagados",
];
