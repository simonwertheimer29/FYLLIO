// app/lib/automatizaciones/configuracion.ts
//
// FASE 1 migración (dominio Automatizaciones) — repositorio de la tabla
// Configuracion_Automatizaciones (umbrales por clínica del subsistema de
// secuencias). Único punto de acceso; en FASE 2 cambia a Postgres.

import { base, TABLES } from "../airtable";
import { usaPostgres } from "../db/data-backend";

/** Config de una clínica (por nombre), o null. Record crudo. */
export async function findConfigPorClinicaRaw(clinica: string): Promise<any | null> {
  const pg = await import("./pg");
  return pg.findConfigPorClinicaRawPg(clinica);
  
}

/** Todas las configs (fragmento opcional de clinica-scope), fields fijos
 *  de la vista de configuración. Records crudos. */
export async function listConfigsRaw(clinicaFormula?: string | null): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listConfigsRawPg(clinicaFormula);
  
}

/** Configs con los campos que consume el runner de procesar. */
export async function listConfigsProcesarRaw(): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listConfigsProcesarRawPg();
  
}

/** Update parcial (solo los campos que llegan; los compone el caller). */
export async function updateConfigRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./pg");
  return pg.updateConfigRawPg(id, fields);
  
}

/** Alta con defaults ya resueltos por el caller. */
export async function createConfigRaw(fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./pg");
  return pg.createConfigRawPg(fields);
  
}
