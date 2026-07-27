// app/lib/scheduler/repo/sillonesRepo.ts
//
// FASE 1 migración (dominio Agenda) — repositorio de la tabla Sillones.
// Único punto de acceso; en FASE 2 cambia su interior a Postgres.

import { base, TABLES } from "../../airtable";
import { usaPostgres } from "../../db/data-backend";

/** Volcado con fields explícitos (superficie diferida no-shows: map
 *  Sillón ID → Nombre; seeders dev: Nombre → recordId). */
export async function listSillonesCamposRaw(fields: string[]): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listSillonesCamposRawPg(fields);
  
}

/** Records crudos por lote de IDs (vista semanal demo lee via rec.get()).
 *  firstPage por chunk de 40, como el helper que sustituye. */
export async function listSillonesPorIdsRaw(ids: string[]): Promise<any[]> {
  const pg = await import("./pg");
  return pg.listSillonesPorIdsRawPg(ids);
  
}

/** SOLO DEV — alta cruda de sillón (seeder). */
export async function createSillonDev(fields: Record<string, unknown>): Promise<string> {
  const r = await (base(TABLES.sillones) as any).create(fields);
  return r.id;
}
