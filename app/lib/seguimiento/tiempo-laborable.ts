// app/lib/seguimiento/tiempo-laborable.ts
//
// EL RELOJ DE FUERA DE PLAZO (delta P1, 18-08). Dictado: «el reloj NO corre
// fuera del horario de la clínica: si corriera, "fuera de plazo" se llenaría
// cada noche y dejaría de significar nada. Arranca cuando la clínica abre.»
//
// Puro y sin red: el horario se INYECTA (hoy el default de la casa,
// HORARIO_DEFAULT; el de cada clínica llega con la pantalla del agente,
// fase D). Zona fija de la clínica (Europe/Madrid), como todo el producto.

import { DateTime } from "luxon";
import { HORARIO_DEFAULT, type HorarioLaboral } from "../automatizaciones/types";

const ZONE = "Europe/Madrid";
const DIAS: Array<keyof HorarioLaboral> = [
  "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo",
];
// Tope de barrido: pasado esto, el caso lleva TAN fuera de plazo que la cifra
// exacta ya no cambia ninguna decisión (y el bucle queda acotado).
const MAX_DIAS_BARRIDO = 60;

function tramoDelDia(d: DateTime, horario: HorarioLaboral): { abre: DateTime; cierra: DateTime } | null {
  const dia = horario[DIAS[d.weekday - 1]];
  if (!dia?.activo) return null;
  const [hA, mA] = dia.inicio.split(":").map(Number);
  const [hC, mC] = dia.fin.split(":").map(Number);
  const abre = d.set({ hour: hA, minute: mA, second: 0, millisecond: 0 });
  const cierra = d.set({ hour: hC, minute: mC, second: 0, millisecond: 0 });
  return cierra > abre ? { abre, cierra } : null;
}

/**
 * Minutos de horario laboral transcurridos entre dos instantes. `desde` fuera
 * de horario no cuenta hasta la próxima apertura; `hasta` de madrugada corta
 * en el último cierre. Si `hasta <= desde`, 0.
 */
/**
 * El PRÓXIMO día con horario activo después de `desdeISO` (YYYY-MM-DD).
 * Viernes → lunes con el horario default. Para la espera corta de «llamé y
 * no contesta» (MEJORAS 102): el caso vuelve a la cola cuando la clínica
 * vuelve a abrir, no un sábado.
 */
export function proximoDiaLaborable(
  desdeISO: string,
  horario: HorarioLaboral = HORARIO_DEFAULT,
): string {
  let dia = DateTime.fromISO(desdeISO, { zone: ZONE }).startOf("day");
  for (let i = 0; i < 14; i++) {
    dia = dia.plus({ days: 1 });
    if (horario[DIAS[dia.weekday - 1]]?.activo) return dia.toISODate()!;
  }
  // 14 días sin abrir = horario roto; mañana natural antes que no volver nunca.
  return DateTime.fromISO(desdeISO, { zone: ZONE }).plus({ days: 1 }).toISODate()!;
}

export function minutosLaborablesEntre(
  desde: Date,
  hasta: Date,
  horario: HorarioLaboral = HORARIO_DEFAULT,
): number {
  const ini = DateTime.fromJSDate(desde).setZone(ZONE);
  const fin = DateTime.fromJSDate(hasta).setZone(ZONE);
  if (!ini.isValid || !fin.isValid || fin <= ini) return 0;

  let minutos = 0;
  let dia = ini.startOf("day");
  for (let i = 0; i < MAX_DIAS_BARRIDO && dia < fin; i++, dia = dia.plus({ days: 1 })) {
    const tramo = tramoDelDia(dia, horario);
    if (!tramo) continue;
    const desdeTramo = ini > tramo.abre ? ini : tramo.abre;
    const hastaTramo = fin < tramo.cierra ? fin : tramo.cierra;
    if (hastaTramo > desdeTramo) minutos += hastaTramo.diff(desdeTramo, "minutes").minutes;
  }
  return Math.round(minutos);
}

/** El ÚLTIMO CIERRE de jornada anterior a `ahora`, en la zona de la clínica
 *  (Inicio, «desde ayer», dictado 31-08). Un martes a las 11 es el lunes a las
 *  20; un lunes a las 9 es el VIERNES a las 20 — el fin de semana entero, que
 *  es justo lo que nadie miró. No depende de quién mira ni de cuántas veces
 *  entra: la ventana es de la clínica, no del usuario. */
export function ultimoCierreDeJornada(ahora: Date, horario: HorarioLaboral = HORARIO_DEFAULT): Date {
  const t = DateTime.fromJSDate(ahora).setZone(ZONE);
  let dia = t.startOf("day");
  for (let i = 0; i < 14; i++, dia = dia.minus({ days: 1 })) {
    const tramo = tramoDelDia(dia, horario);
    if (!tramo) continue;
    if (tramo.cierra <= t) return tramo.cierra.toJSDate();
  }
  // Horario sin ningún día activo en dos semanas: no hay jornada que cerrar.
  // Se cae a «hace 24 h» y se dice en el log — nunca una ventana vacía.
  console.error("[tiempo-laborable] ultimoCierreDeJornada: sin día laborable en 14 días, usando 24 h");
  return t.minus({ hours: 24 }).toJSDate();
}
