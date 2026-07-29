// UNA composición del estado de conversación de un presupuesto (Bloque 2
// dashboard, 2026-07-23). Antes vivía inline en la ruta de la cola de
// intervención; el dashboard la necesita también, y la regla es que ambos
// sean literalmente la MISMA función — cero cálculo paralelo.
//
// Fuente primaria: el HILO (últimos entrante/saliente). Complementos:
//   - Fecha_ultima_respuesta persistida si es más nueva que el entrante del
//     hilo (datos pre-hilo / clasificación IA).
//   - La última ACCIÓN saliente registrada (llamada, apertura de chat) —
//     sin ella, la clasificación regañaría justo después de una llamada.
// Módulo puro (sin datos): los callers traen los campos y el hilo.

import {
  estadoConversacion,
  UMBRAL_REACTIVACION_MS,
  type ConversacionClasificada,
} from "./estado-conversacion";

export const TIPOS_ACCION_SALIENTE = new Set([
  "WhatsApp enviado",
  "Llamada realizada",
  "Sin respuesta tras llamada",
]);

export function conversacionDePresupuesto(
  campos: {
    fechaUltimaRespuesta?: string | null;
    ultimaAccionRegistrada?: string | null;
    tipoUltimaAccion?: string | null;
  },
  hilo?: { entranteAt?: string | null; salienteAt?: string | null },
): ConversacionClasificada {
  const fur = campos.fechaUltimaRespuesta || null;
  const accionSaliente =
    campos.ultimaAccionRegistrada &&
    campos.tipoUltimaAccion &&
    TIPOS_ACCION_SALIENTE.has(campos.tipoUltimaAccion)
      ? campos.ultimaAccionRegistrada
      : null;
  const entranteComplemento =
    !hilo?.entranteAt || (fur && fur > hilo.entranteAt) ? fur : null;
  return estadoConversacion(
    {
      ultimoEntranteAt: entranteComplemento ?? hilo?.entranteAt ?? null,
      ultimoSalienteAt: hilo?.salienteAt ?? null,
      ultimaAccionSalienteAt: accionSaliente,
    },
    UMBRAL_REACTIVACION_MS.presupuesto,
  );
}
