// app/lib/presupuestos/urgency.ts
import type { Presupuesto } from "./types";

/**
 * Calcula la puntuación de urgencia (0–100).
 * Mayor puntuación = aparece más arriba en la columna Kanban.
 */
export function computeUrgencyScore(p: Presupuesto): number {
  if (p.estado === "ACEPTADO" || p.estado === "PERDIDO") return 0;
  const diasSinContacto = p.lastContactDaysAgo ?? p.daysSince;
  let score = 0;

  // Tiempo sin contacto (0-40): sube rápido al mes
  score += Math.min((diasSinContacto / 30) * 40, 40);

  // Importe alto = más dinero en riesgo (0-20)
  score += p.amount != null ? (p.amount > 3000 ? 20 : p.amount > 1000 ? 10 : 0) : 0;

  // Estado avanzado sin cierre = más riesgo (0-20)
  score += p.estado === "EN_NEGOCIACION" ? 20 : p.estado === "EN_DUDA" ? 15 : 0;

  // Nunca o poco contactado = oportunidad sin explorar (0-20)
  score += p.contactCount === 0 ? 20 : p.contactCount === 1 ? 10 : 0;

  return Math.min(Math.round(score), 100);
}

/**
 * Devuelve el color Tailwind para mostrar daysSince con urgencia visual.
 */
export function daysSinceColor(
  daysSince: number,
  estado: Presupuesto["estado"]
): string {
  if (estado === "ACEPTADO" || estado === "PERDIDO") {
    return "text-slate-400";
  }
  if (daysSince >= 21) return "text-rose-600 font-semibold";
  if (daysSince >= 14) return "text-amber-600 font-semibold";
  if (daysSince >= 7) return "text-amber-500";
  return "text-slate-500";
}
