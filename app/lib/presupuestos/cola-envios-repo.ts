// app/lib/presupuestos/cola-envios-repo.ts
//
// FASE 1 migración — repositorio de la tabla Cola_Envios (passthrough).

import { base, TABLES, fetchAll } from "../airtable";

export async function selectColaEnviosRaw(opts: {
  fields?: string[];
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<readonly any[]> {
  return base(TABLES.colaEnvios as any).select(opts as any).all();
}

export async function selectColaEnviosFetchAllRaw(opts: {
  filterByFormula?: string;
}): Promise<any[]> {
  return fetchAll(base(TABLES.colaEnvios as any).select(opts as any));
}

export async function findColaEnvioRaw(id: string): Promise<any> {
  return base(TABLES.colaEnvios as any).find(id);
}

export async function updateColaEnvioRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  await (base(TABLES.colaEnvios as any) as any).update(id, fields);
}

export async function createColaEnvioRaw(fields: Record<string, unknown>): Promise<void> {
  await (base(TABLES.colaEnvios as any).create as any)(fields);
}
