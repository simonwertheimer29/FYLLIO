// Bloque 3 — validación del cambio de estado de un presupuesto (2026-07-23).
//
// Una sola definición de las reglas que ya aplicaba el kanban por UI:
//   - PERDIDO exige motivo (el modal siempre lo aporta; la API ahora lo
//     EXIGE también, fail-closed: la tabla corrige, no esquiva el flujo).
//   - El editor solo ofrece estados distintos del actual.
// Módulo PURO: lo consumen la ruta kanban y el editor de la tabla de
// Pacientes, y lo verifica el QA.

import type { PresupuestoEstado } from "./types";

export const ESTADOS_PRESUPUESTO: PresupuestoEstado[] = [
  "PRESENTADO",
  "INTERESADO",
  "EN_DUDA",
  "EN_NEGOCIACION",
  "ACEPTADO",
  "PERDIDO",
];

/** Estados alcanzables desde el actual (mismas reglas que el kanban:
 *  cualquier otro estado; ACEPTADO/PERDIDO pasan por su modal). */
export function estadosAlcanzables(actual: PresupuestoEstado): PresupuestoEstado[] {
  return ESTADOS_PRESUPUESTO.filter((e) => e !== actual);
}

/** null = válido; string = motivo del rechazo (error honesto para la API/UI). */
export function validarCambioEstado(args: {
  actual?: PresupuestoEstado | null;
  nuevo: string;
  motivoPerdida?: string | null;
}): string | null {
  if (!ESTADOS_PRESUPUESTO.includes(args.nuevo as PresupuestoEstado)) {
    return `Estado desconocido: ${args.nuevo}`;
  }
  if (args.actual && args.nuevo === args.actual) {
    return "El presupuesto ya está en ese estado";
  }
  if (args.nuevo === "PERDIDO" && !args.motivoPerdida) {
    return "Marcar Perdido requiere motivo (usa el modal de motivo de pérdida)";
  }
  return null;
}
