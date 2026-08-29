// app/lib/agenda/resumen.ts
//
// G2.2/G2.5 — el RESUMEN plegado de la vista Lista. Revisión dictada (30-08):
// lo esencial y nada más — nombre, número de citas, horas libres. Las horas
// CONCRETAS van al desplegar, no al resumen; y el dato que importa (horas
// libres) tiene que DESTACAR sobre el resto, así que el resumen devuelve
// partes con su énfasis, no una frase plana que pesa toda igual.
//
// MÓDULO PURO client-safe — lo testea qa:agenda.

import type { IntervaloMin } from "./disponibilidad";

/** 90 → "1 h 30 min" · 120 → "2 h" · 45 → "45 min". */
export function formatoDuracion(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export type ResumenAgendaDia = {
  /** Solo cuando no hay nada que resumir: el recuadro entero es esta nota. */
  nota: "no trabaja" | null;
  /** "3 citas" · "sin citas" — contexto, peso normal. */
  citas: string;
  /** Citas fuera del horario del doctor se DICEN, no se esconden. */
  fueraDeHorario: boolean;
  /** EL dato: cuánto queda libre. null = no trabaja (no hay huecos posibles). */
  libres: {
    texto: string;
    /** destacado = hay hueco (lo que se busca al escanear) · apagado = sin
     *  huecos · aviso = no afirmable (cita sin duración). */
    enfasis: "destacado" | "apagado" | "aviso";
  } | null;
};

export function resumenDeAgendaDia(p: {
  trabaja: boolean;
  nCitas: number;
  libres: ReadonlyArray<IntervaloMin> | null;
}): ResumenAgendaDia {
  const citas = p.nCitas === 0 ? "sin citas" : p.nCitas === 1 ? "1 cita" : `${p.nCitas} citas`;
  if (!p.trabaja) {
    if (p.nCitas === 0) return { nota: "no trabaja", citas, fueraDeHorario: false, libres: null };
    return { nota: null, citas, fueraDeHorario: true, libres: null };
  }
  if (p.libres === null) {
    return { nota: null, citas, fueraDeHorario: false, libres: { texto: "huecos no afirmables", enfasis: "aviso" } };
  }
  if (p.libres.length === 0) {
    return { nota: null, citas, fueraDeHorario: false, libres: { texto: "sin horas libres", enfasis: "apagado" } };
  }
  const total = p.libres.reduce((acc, l) => acc + (l.fin - l.inicio), 0);
  return { nota: null, citas, fueraDeHorario: false, libres: { texto: `${formatoDuracion(total)} libres`, enfasis: "destacado" } };
}
