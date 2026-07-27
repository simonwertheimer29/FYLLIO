// app/lib/presupuestos/cola-envios-repo.ts
//
// FASE 1 migración — repositorio de la tabla Cola_Envios (passthrough).
// FASE 2 — delegación por flag a Postgres (dominio "cola-envios").

import { base, TABLES, fetchAll } from "../airtable";
import { usaPostgres } from "../db/data-backend";

export async function selectColaEnviosRaw(opts: {
  fields?: string[];
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<readonly any[]> {
  const pg = await import("./cola-envios-pg");
  return pg.selectColaEnviosRawPg(opts);
  
}

export async function selectColaEnviosFetchAllRaw(opts: {
  filterByFormula?: string;
}): Promise<any[]> {
  const pg = await import("./cola-envios-pg");
  return pg.selectColaEnviosFetchAllRawPg(opts);
  
}

export async function findColaEnvioRaw(id: string): Promise<any> {
  const pg = await import("./cola-envios-pg");
  return pg.findColaEnvioRawPg(id);
  
}

export async function updateColaEnvioRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./cola-envios-pg");
  return pg.updateColaEnvioRawPg(id, fields);
  
}

export async function createColaEnvioRaw(fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./cola-envios-pg");
  return pg.createColaEnvioRawPg(fields);
  
}
