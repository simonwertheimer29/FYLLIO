// app/lib/scheduler/repo/sillonesRepo.ts
//
// FASE 1 migración (dominio Agenda) — repositorio de la tabla Sillones.
// Único punto de acceso; en FASE 2 cambia su interior a Postgres.

import { base, TABLES } from "../../airtable";
import { usaPostgres } from "../../db/data-backend";

/** Volcado con fields explícitos (superficie diferida no-shows: map
 *  Sillón ID → Nombre; seeders dev: Nombre → recordId). */
export async function listSillonesCamposRaw(fields: string[]): Promise<readonly any[]> {
  if (usaPostgres("agenda")) {
    const pg = await import("./pg");
    return pg.listSillonesCamposRawPg(fields);
  }
  return base(TABLES.sillones as any).select({ fields }).all();
}

/** Records crudos por lote de IDs (vista semanal demo lee via rec.get()).
 *  firstPage por chunk de 40, como el helper que sustituye. */
export async function listSillonesPorIdsRaw(ids: string[]): Promise<any[]> {
  if (usaPostgres("agenda")) {
    const pg = await import("./pg");
    return pg.listSillonesPorIdsRawPg(ids);
  }
  if (!ids.length) return [];
  const uniq = [...new Set(ids)];
  const out: any[] = [];
  const chunkSize = 40;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const recs = await base(TABLES.sillones as any)
      .select({ filterByFormula: formula })
      .firstPage();
    out.push(...(recs as any[]));
  }
  return out;
}

/** SOLO DEV — alta cruda de sillón (seeder). */
export async function createSillonDev(fields: Record<string, unknown>): Promise<string> {
  const r = await (base(TABLES.sillones) as any).create(fields);
  return r.id;
}
