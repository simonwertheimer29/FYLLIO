// app/lib/presupuestos/repo.ts
//
// FASE 1 migración (dominio Presupuestos) — repositorio de la tabla
// Presupuestos. ÚNICO punto de acceso a la tabla; en FASE 2 cambia su
// interior a Postgres sin tocar callers.
//
// Convención de este dominio (módulo del piloto — paridad con lupa):
// passthrough máximo. Los callers siguen componiendo sus fields/fórmulas
// exactamente como siempre; este repo solo posee el acceso. El tipado de
// entradas/salidas se hace al voltear el módulo en FASE 2, verificado
// contra los goldens de paridad (cola de intervención + KPIs).

import { base, TABLES, fetchAll } from "../airtable";
import { usaPostgres } from "../db/data-backend";

export type SelectPresupuestosOpts = {
  fields?: string[];
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
  pageSize?: number;
};

/** Dataset de presupuestos (kanban, KPIs, intervención, máxima, informes,
 *  export, búsquedas). Paginación completa siempre. Records crudos. */
export async function selectPresupuestosRaw(opts: SelectPresupuestosOpts = {}): Promise<any[]> {
  const pg = await import("./pg");
  return pg.selectPresupuestosRawPg(opts);
  
}

/** Un presupuesto por RECORD_ID() (campos opcionales). null si no existe. */
export async function getPresupuestoPorIdRaw(
  id: string,
  fields?: string[],
): Promise<any | null> {
  const pg = await import("./pg");
  return pg.getPresupuestoPorIdRawPg(id, fields);
  
}

/** Record crudo via find (lanza si no existe). */
export async function findPresupuestoRaw(id: string): Promise<any> {
  const pg = await import("./pg");
  return pg.findPresupuestoRawPg(id);
  
}

/** Update passthrough (fields los compone el caller, como siempre). */
export async function updatePresupuestoRaw(
  id: string,
  fields: Record<string, unknown>,
  opts: { typecast?: boolean } = {},
): Promise<void> {
  const pg = await import("./pg");
  return pg.updatePresupuestoRawPg(id, fields, opts);
  
}

/** Create passthrough de un presupuesto. Devuelve el record crudo. */
export async function createPresupuestoRaw(fields: Record<string, unknown>): Promise<any> {
  const pg = await import("./pg");
  return pg.createPresupuestoRawPg(fields);
  
}

/** Create en lote (import CSV; el caller trocea en lotes de 10). */
export async function createPresupuestosBatchRaw(
  batch: Array<{ fields: Record<string, unknown> }>,
): Promise<any[]> {
  const pg = await import("./pg");
  return pg.createPresupuestosBatchRawPg(batch);
  
}

/** SOLO DEV — muestra de fields de Usuarios_Presupuestos (introspección). */
export async function sampleUsuariosPresupuestosFieldsDev(n: number): Promise<any[]> {
  const pg = await import("./pg");
  return pg.sampleUsuariosPresupuestosFieldsDevPg(n);
  
}
