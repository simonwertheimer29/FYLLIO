// app/lib/agenda/resumen.ts
//
// G2.2 — el RESUMEN plegado de la vista Lista: una línea por doctor y día,
// para escanear una semana de cinco doctores sin abrir nada. El resumen no
// repite el detalle — dice lo único que importa a esa escala: si trabaja,
// cuántas citas tiene y qué horas libres quedan (siempre «según Fyllio»:
// nivel 1, la advertencia viaja con el dato).
//
// MÓDULO PURO client-safe — lo testea qa:agenda.

import { deMin, type IntervaloMin } from "./disponibilidad";

/** 90 → "1 h 30 min" · 120 → "2 h" · 45 → "45 min". */
export function formatoDuracion(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** ["16:00","18:30"] → "16:00 y 18:30" · cuatro o más → "a, b, c y N más". */
function listaInicios(inicios: string[]): string {
  if (inicios.length <= 3) {
    if (inicios.length === 1) return inicios[0];
    return `${inicios.slice(0, -1).join(", ")} y ${inicios[inicios.length - 1]}`;
  }
  return `${inicios.slice(0, 3).join(", ")} y ${inicios.length - 3} más`;
}

/** La línea del recuadro plegado. `libres: null` = no afirmable (hay una
 *  cita sin duración). */
export function resumenDeAgendaDia(p: {
  trabaja: boolean;
  nCitas: number;
  libres: ReadonlyArray<IntervaloMin> | null;
}): string {
  if (!p.trabaja && p.nCitas === 0) return "no trabaja";
  const partes: string[] = [];
  partes.push(p.nCitas === 0 ? "sin citas" : p.nCitas === 1 ? "1 cita" : `${p.nCitas} citas`);
  if (!p.trabaja) {
    partes.push("fuera de su horario");
    return partes.join(" · ");
  }
  if (p.libres === null) {
    partes.push("huecos no afirmables (cita sin duración)");
  } else if (p.libres.length === 0) {
    partes.push("sin horas libres");
  } else {
    const total = p.libres.reduce((acc, l) => acc + (l.fin - l.inicio), 0);
    partes.push(`${formatoDuracion(total)} libres según Fyllio: ${listaInicios(p.libres.map((l) => deMin(l.inicio)))}`);
  }
  return partes.join(" · ");
}
