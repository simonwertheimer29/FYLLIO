// app/lib/presupuestos/probability.ts
// Calcula la probabilidad de cierre (0–100) para un presupuesto activo
// basándose en el histórico de ACEPTADOS + PERDIDOS de la misma clínica.

import type { Presupuesto } from "./types";

/**
 * @param p         Presupuesto activo (PRESENTADO | INTERESADO | EN_DUDA | EN_NEGOCIACION)
 * @param historico Array de presupuestos ACEPTADOS + PERDIDOS (todos los que haya en memoria)
 * @returns         Número 5–95, o null si no hay suficientes datos históricos
 */
export function calcularProbabilidad(
  p: Presupuesto,
  historico: Presupuesto[]
): number | null {
  if (!historico.length) return null;

  // 1. Buscar similares: mismo tratamiento principal + importe ±30% + misma clínica
  const tratPrincipal = (p.treatments[0] ?? "").toLowerCase().trim().slice(0, 6);

  const similares = historico.filter((h) => {
    if (p.clinica && h.clinica && p.clinica !== h.clinica) return false;
    if (tratPrincipal) {
      const hTrat = (h.treatments[0] ?? "").toLowerCase().trim().slice(0, 6);
      if (hTrat !== tratPrincipal) return false;
    }
    if (p.amount != null && h.amount != null && p.amount > 0) {
      const diff = Math.abs(p.amount - h.amount) / p.amount;
      if (diff > 0.3) return false;
    }
    return true;
  });

  // 2. Elegir pool: similares si hay ≥5, si no usar tasa global de la clínica
  const pool = similares.length >= 5
    ? similares
    : (p.clinica ? historico.filter((h) => h.clinica === p.clinica) : historico);

  if (pool.length < 3) return null; // datos insuficientes

  const tasaBase = pool.filter((h) => h.estado === "ACEPTADO").length / pool.length;

  // 3. Ajustes multiplicativos
  let factor = 1;

  // Motivo de duda
  const duda = (p.motivoDuda ?? "").toLowerCase();
  if (duda.includes("precio"))                              factor *= 0.75;
  else if (duda.includes("financiac") || duda.includes("financiacion")) factor *= 0.80;
  else if (duda.includes("miedo"))                          factor *= 0.85;

  // Historial de contactos
  if (p.contactCount >= 3) factor *= 0.90;
  else if (p.contactCount === 0) factor *= 1.10;

  // Antigüedad del presupuesto
  if (p.daysSince > 180) factor *= 0.70;

  // Canal de captación
  if (p.origenLead === "referido_paciente")  factor *= 1.15;
  else if (p.origenLead === "google_ads")    factor *= 0.90;

  // 4. Clamp 5–95
  return Math.max(5, Math.min(95, Math.round(tasaBase * 100 * factor)));
}
