// app/lib/presupuestos/objetivos.ts
//
// FASE 1 migración (dominio Presupuestos) — repositorio de la tabla
// Objetivos_Mensuales (único write-path de objetivos de la app).

import { base, TABLES } from "../airtable";
import { usaPostgres } from "../db/data-backend";

/** Objetivos filtrados (la fórmula la compone el caller con su scope). */
export async function listObjetivosRaw(filterByFormula: string): Promise<readonly any[]> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.listObjetivosRawPg(filterByFormula);
  }
  return base(TABLES.objetivosMensuales as any)
    .select({ filterByFormula, fields: ["clinica", "mes", "objetivo_aceptados"] })
    .all();
}

/** Objetivo de una clínica+mes (upsert del POST). null si no existe. */
export async function findObjetivoRaw(clinica: string, mes: string): Promise<any | null> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.findObjetivoRawPg(clinica, mes);
  }
  const recs = await base(TABLES.objetivosMensuales as any)
    .select({
      filterByFormula: `AND({clinica}="${clinica}",{mes}="${mes}")`,
      maxRecords: 1,
    })
    .firstPage();
  return recs?.[0] ?? null;
}

export async function updateObjetivoRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.updateObjetivoRawPg(id, fields);
  }
  await (base(TABLES.objetivosMensuales as any) as any).update(id, fields);
}

export async function createObjetivoRaw(fields: Record<string, unknown>): Promise<void> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.createObjetivoRawPg(fields);
  }
  await base(TABLES.objetivosMensuales as any).create([{ fields }] as any);
}
