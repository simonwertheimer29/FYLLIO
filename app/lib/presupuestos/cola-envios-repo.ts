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
  if (usaPostgres("cola-envios")) {
    const pg = await import("./cola-envios-pg");
    return pg.selectColaEnviosRawPg(opts);
  }
  return base(TABLES.colaEnvios as any).select(opts as any).all();
}

export async function selectColaEnviosFetchAllRaw(opts: {
  filterByFormula?: string;
}): Promise<any[]> {
  if (usaPostgres("cola-envios")) {
    const pg = await import("./cola-envios-pg");
    return pg.selectColaEnviosFetchAllRawPg(opts);
  }
  return fetchAll(base(TABLES.colaEnvios as any).select(opts as any));
}

export async function findColaEnvioRaw(id: string): Promise<any> {
  if (usaPostgres("cola-envios")) {
    const pg = await import("./cola-envios-pg");
    return pg.findColaEnvioRawPg(id);
  }
  return base(TABLES.colaEnvios as any).find(id);
}

export async function updateColaEnvioRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  if (usaPostgres("cola-envios")) {
    const pg = await import("./cola-envios-pg");
    return pg.updateColaEnvioRawPg(id, fields);
  }
  await (base(TABLES.colaEnvios as any) as any).update(id, fields);
}

export async function createColaEnvioRaw(fields: Record<string, unknown>): Promise<void> {
  if (usaPostgres("cola-envios")) {
    const pg = await import("./cola-envios-pg");
    return pg.createColaEnvioRawPg(fields);
  }
  await (base(TABLES.colaEnvios as any).create as any)(fields);
}
