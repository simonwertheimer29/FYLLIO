// app/lib/presupuestos/objetivos.ts
//
// FASE 1 migración (dominio Presupuestos) — repositorio de la tabla
// Objetivos_Mensuales (único write-path de objetivos de la app).

import { base, TABLES } from "../airtable";
import { usaPostgres } from "../db/data-backend";

/** Objetivos filtrados (la fórmula la compone el caller con su scope). */
export async function listObjetivosRaw(filterByFormula: string): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listObjetivosRawPg(filterByFormula);
  
}

/** Objetivo de una clínica+mes (upsert del POST). null si no existe. */
export async function findObjetivoRaw(clinica: string, mes: string): Promise<any | null> {
  const pg = await import("./pg");
  return pg.findObjetivoRawPg(clinica, mes);
  
}

export async function updateObjetivoRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./pg");
  return pg.updateObjetivoRawPg(id, fields);
  
}

export async function createObjetivoRaw(fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./pg");
  return pg.createObjetivoRawPg(fields);
  
}
