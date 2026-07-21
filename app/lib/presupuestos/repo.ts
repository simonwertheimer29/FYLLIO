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
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.selectPresupuestosRawPg(opts);
  }
  const select: Record<string, unknown> = {};
  if (opts.fields) select.fields = opts.fields;
  if (opts.filterByFormula) select.filterByFormula = opts.filterByFormula;
  if (opts.sort) select.sort = opts.sort;
  if (opts.maxRecords !== undefined) select.maxRecords = opts.maxRecords;
  if (opts.pageSize !== undefined) select.pageSize = opts.pageSize;
  return fetchAll(base(TABLES.presupuestos as any).select(select as any));
}

/** Un presupuesto por RECORD_ID() (campos opcionales). null si no existe. */
export async function getPresupuestoPorIdRaw(
  id: string,
  fields?: string[],
): Promise<any | null> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.getPresupuestoPorIdRawPg(id, fields);
  }
  const recs = await base(TABLES.presupuestos as any)
    .select({
      filterByFormula: `RECORD_ID()='${id}'`,
      ...(fields ? { fields } : {}),
      maxRecords: 1,
    })
    .all();
  return recs?.[0] ?? null;
}

/** Record crudo via find (lanza si no existe). */
export async function findPresupuestoRaw(id: string): Promise<any> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.findPresupuestoRawPg(id);
  }
  return base(TABLES.presupuestos as any).find(id);
}

/** Update passthrough (fields los compone el caller, como siempre). */
export async function updatePresupuestoRaw(
  id: string,
  fields: Record<string, unknown>,
  opts: { typecast?: boolean } = {},
): Promise<void> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.updatePresupuestoRawPg(id, fields, opts);
  }
  if (opts.typecast) {
    await (base(TABLES.presupuestos as any) as any).update(id, fields, { typecast: true });
  } else {
    await (base(TABLES.presupuestos as any) as any).update(id, fields);
  }
}

/** Create passthrough de un presupuesto. Devuelve el record crudo. */
export async function createPresupuestoRaw(fields: Record<string, unknown>): Promise<any> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.createPresupuestoRawPg(fields);
  }
  return (await (base(TABLES.presupuestos) as any).create([{ fields }]))[0];
}

/** Create en lote (import CSV; el caller trocea en lotes de 10). */
export async function createPresupuestosBatchRaw(
  batch: Array<{ fields: Record<string, unknown> }>,
): Promise<any[]> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.createPresupuestosBatchRawPg(batch);
  }
  return (await (base(TABLES.presupuestos as any) as any).create(batch)) as any[];
}

/** SOLO DEV — muestra de fields de Usuarios_Presupuestos (introspección). */
export async function sampleUsuariosPresupuestosFieldsDev(n: number): Promise<any[]> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.sampleUsuariosPresupuestosFieldsDevPg(n);
  }
  return (await (base(TABLES.usuariosPresupuestos as any).select({ maxRecords: n }).firstPage() as any)) as any[];
}
