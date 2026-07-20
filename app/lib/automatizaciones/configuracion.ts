// app/lib/automatizaciones/configuracion.ts
//
// FASE 1 migración (dominio Automatizaciones) — repositorio de la tabla
// Configuracion_Automatizaciones (umbrales por clínica del subsistema de
// secuencias). Único punto de acceso; en FASE 2 cambia a Postgres.

import { base, TABLES } from "../airtable";

/** Config de una clínica (por nombre), o null. Record crudo. */
export async function findConfigPorClinicaRaw(clinica: string): Promise<any | null> {
  const recs = await base(TABLES.configuracionAutomatizaciones as any)
    .select({
      filterByFormula: `{clinica}="${clinica}"`,
      maxRecords: 1,
    })
    .firstPage();
  return recs?.[0] ?? null;
}

/** Todas las configs (fragmento opcional de clinica-scope), fields fijos
 *  de la vista de configuración. Records crudos. */
export async function listConfigsRaw(clinicaFormula?: string | null): Promise<readonly any[]> {
  return base(TABLES.configuracionAutomatizaciones as any)
    .select({
      fields: ["clinica", "activa", "dias_inactividad_alerta", "dias_portal_sin_respuesta", "dias_reactivacion", "modo_whatsapp"],
      ...(clinicaFormula ? { filterByFormula: clinicaFormula } : {}),
      maxRecords: 100,
    })
    .all();
}

/** Configs con los campos que consume el runner de procesar. */
export async function listConfigsProcesarRaw(): Promise<readonly any[]> {
  return base(TABLES.configuracionAutomatizaciones as any)
    .select({ fields: ["clinica", "activa", "dias_inactividad_alerta", "dias_portal_sin_respuesta", "dias_reactivacion"] })
    .all();
}

/** Update parcial (solo los campos que llegan; los compone el caller). */
export async function updateConfigRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  await base(TABLES.configuracionAutomatizaciones as any).update(id, fields as any);
}

/** Alta con defaults ya resueltos por el caller. */
export async function createConfigRaw(fields: Record<string, unknown>): Promise<void> {
  await base(TABLES.configuracionAutomatizaciones as any).create([{ fields }] as any);
}
