// app/lib/leads/intenciones.ts
//
// Qué significa cada intención de LEAD, en un solo sitio. Gemelo de
// `presupuestos/intenciones` y por el mismo motivo (censo del 2026-08-06): el
// significado estaba repartido en un `Set` y tres `===` sueltos, y añadir una
// categoría al enum no rompía nada — solo dejaba de aplicar, en silencio.
//
// El enum de leads es DISTINTO del de presupuestos a propósito (Sprint 10): las
// preguntas de un lead no son las de alguien que ya tiene presupuesto.
//
// Las dos garantías, iguales que en el gemelo:
//   · `Record<LeadIntencion, …>` exhaustivo → añadir un valor rompe la
//     compilación aquí y obliga a decidir qué significa.
//   · lectura por `deDiccionario` → el valor viene de la base, así que un valor
//     desconocido devuelve el fallback Y avisa una vez, en vez de degradar mudo.

import type { LeadIntencion } from "./leads";
import { deDiccionario } from "../diccionario";

/**
 * ¿El lead está CALIENTE? — mostró interés y merece que se le retome ya.
 * Lo consumen el orden de la cola de Seguimiento y el panel de acción del lead.
 */
export const ES_CALIENTE: Record<LeadIntencion, boolean> = {
  Interesado: true,
  "Pide cita": true,
  "Pregunta precio": true,
  "Pide más info": false,
  "No interesado": false,
  "Sin clasificar": false,
};

/**
 * ¿Está pidiendo cita? Dispara la recomendación de agendar, que es una acción
 * concreta y no una prioridad: por eso va aparte de `ES_CALIENTE`.
 */
export const PIDE_CITA: Record<LeadIntencion, boolean> = {
  "Pide cita": true,
  Interesado: false,
  "Pregunta precio": false,
  "Pide más info": false,
  "No interesado": false,
  "Sin clasificar": false,
};

export function esLeadCaliente(intencion: string | null | undefined): boolean {
  return deDiccionario(ES_CALIENTE, intencion, false, "leads.intencion_detectada (caliente)");
}

export function leadPideCita(intencion: string | null | undefined): boolean {
  return deDiccionario(PIDE_CITA, intencion, false, "leads.intencion_detectada (pide cita)");
}
