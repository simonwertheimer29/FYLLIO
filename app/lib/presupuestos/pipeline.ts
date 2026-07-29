// Una sola definición de "presupuestos en el pipeline" (coherencia de kanban
// 2026-07-27), gemela de lib/leads/pipeline.
//
// Misma regla dura: el número de la cabecera debe cuadrar con las tarjetas que
// el usuario ve. Por eso se cuenta sobre el conjunto YA filtrado por el rango
// temporal, y se desglosa en vez de dar un total que no suma ninguna columna.
//
// Módulo PURO (sin datos ni Airtable/PG): lo consumen componentes cliente.

import type { Presupuesto, PresupuestoEstado } from "./types";

export const ESTADOS_PRESUPUESTO_ABIERTOS: PresupuestoEstado[] = [
  "PRESENTADO",
  "INTERESADO",
  "EN_DUDA",
  "EN_NEGOCIACION",
];

export function esPresupuestoAbierto(estado: PresupuestoEstado): boolean {
  return ESTADOS_PRESUPUESTO_ABIERTOS.includes(estado);
}

/**
 * Fecha del hito de cada caso, la que decide si entra en el rango temporal:
 * cierre para ACEPTADO (fecha_aceptado) y PERDIDO (derivada del historial),
 * presentación para las columnas activas. Sin fecha conocida el caso se
 * MUESTRA — nunca se esconde por falta de dato.
 */
export function fechaDeRango(p: Presupuesto): string | null {
  if (p.estado === "ACEPTADO") return p.fechaAceptado ?? null;
  if (p.estado === "PERDIDO") return p.fechaPerdida ?? null;
  return p.fechaPresupuesto ?? null;
}

export type PipelinePresupuestos = {
  abiertos: number;
  aceptados: number;
  perdidos: number;
  /** Suma en € de los abiertos: lo que está en juego ahora mismo. */
  importeAbierto: number;
  total: number;
};

export function contarPipelinePresupuestos(
  presupuestos: ReadonlyArray<Presupuesto>,
): PipelinePresupuestos {
  let abiertos = 0;
  let aceptados = 0;
  let perdidos = 0;
  let importeAbierto = 0;
  for (const p of presupuestos) {
    if (p.estado === "ACEPTADO") aceptados++;
    else if (p.estado === "PERDIDO") perdidos++;
    else if (esPresupuestoAbierto(p.estado)) {
      abiertos++;
      importeAbierto += p.amount ?? 0;
    }
  }
  return { abiertos, aceptados, perdidos, importeAbierto, total: presupuestos.length };
}

/** Texto de cabecera que cuadra con el tablero visible. */
export function textoPipelinePresupuestos(p: PipelinePresupuestos): string {
  const abiertos = `${p.abiertos} presupuesto${p.abiertos === 1 ? "" : "s"} abierto${
    p.abiertos === 1 ? "" : "s"
  }`;
  const partes = [
    p.importeAbierto > 0 ? `${abiertos} · ${p.importeAbierto.toLocaleString("es-ES")} €` : abiertos,
  ];
  if (p.aceptados > 0) partes.push(`${p.aceptados} aceptado${p.aceptados === 1 ? "" : "s"}`);
  if (p.perdidos > 0) partes.push(`${p.perdidos} perdido${p.perdidos === 1 ? "" : "s"}`);
  return partes.join(" · ");
}
