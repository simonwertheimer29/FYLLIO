// app/lib/presupuestos/urgency.ts
import type { Presupuesto } from "./types";

/**
 * Calcula la puntuación de urgencia (0–100).
 * Mayor puntuación = aparece más arriba en la columna Kanban.
 */
export function computeUrgencyScore(p: Presupuesto): number {
  let score = 0;

  // Días sin respuesta desde fechaPresupuesto (0-40)
  score += Math.min(p.daysSince * 2, 40);

  // Días desde el último contacto (0-30)
  score += Math.min((p.lastContactDaysAgo ?? 999) * 1.5, 30);

  // Importe alto impulsa urgencia (0-20)
  score += Math.min(((p.amount ?? 0) / 5000) * 20, 20);

  // Más intentos de contacto sin resultado = más urgente (0-10)
  score += Math.min(p.contactCount * 2, 10);

  return Math.round(score);
}

/**
 * Devuelve el color Tailwind para mostrar daysSince con urgencia visual.
 */
export function daysSinceColor(
  daysSince: number,
  estado: Presupuesto["estado"]
): string {
  if (estado === "RECHAZADO" || estado === "FINALIZADO" || estado === "BOCA_SANA") {
    return "text-slate-400";
  }
  if (daysSince >= 21) return "text-rose-600 font-semibold";
  if (daysSince >= 14) return "text-amber-600 font-semibold";
  if (daysSince >= 7) return "text-amber-500";
  return "text-slate-500";
}
