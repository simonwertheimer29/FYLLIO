// app/lib/automatizaciones/secuencias.ts
//
// FASE 1 migración (dominio Automatizaciones) — repositorio de la tabla
// Secuencias_Automaticas (subsistema "Operativo": cola de mensajes IA de
// presupuestos). Único punto de acceso; en FASE 2 cambia a Postgres.
// Los métodos *Raw devuelven records crudos (los callers mapean con sus
// propios recordToSecuencia); los que aceptan fórmula/fields crudos son
// passthrough documentado — se tipan al voltear el módulo.

import { base, TABLES } from "../airtable";
import { usaPostgres } from "../db/data-backend";

/** Cola filtrada (estado + fragmento opcional de clínica), más recientes
 *  primero. La fórmula la compone el caller con clinica-scope. */
export async function listSecuenciasFiltradasRaw(formula: string): Promise<readonly any[]> {
  if (usaPostgres("automatizaciones")) {
    const pg = await import("./pg");
    return pg.listSecuenciasFiltradasRawPg(formula);
  }
  return base(TABLES.secuenciasAutomaticas as any)
    .select({
      filterByFormula: formula,
      sort: [{ field: "creado_en", direction: "desc" }],
      maxRecords: 200,
    })
    .all();
}

/** Patch de una secuencia (enviar/descartar/editar). */
export async function patchSecuencia(
  id: string,
  updates: { estado?: string; mensajeGenerado?: string; actualizadoEn: string },
): Promise<void> {
  if (usaPostgres("automatizaciones")) {
    const pg = await import("./pg");
    return pg.patchSecuenciaPg(id, updates);
  }
  const fields: Record<string, unknown> = { actualizado_en: updates.actualizadoEn };
  if (updates.estado !== undefined) fields["estado"] = updates.estado;
  if (updates.mensajeGenerado !== undefined) fields["mensaje_generado"] = updates.mensajeGenerado;
  await (base(TABLES.secuenciasAutomaticas as any) as any).update(id, fields);
}

/** Record crudo (el PATCH enviar lo relee para el historial). */
export async function findSecuenciaRaw(id: string): Promise<any> {
  if (usaPostgres("automatizaciones")) {
    const pg = await import("./pg");
    return pg.findSecuenciaRawPg(id);
  }
  return base(TABLES.secuenciasAutomaticas as any).find(id);
}

/** presupuesto_id de todas las secuencias pendientes (dedup de procesar). */
export async function listPresupuestoIdsPendientes(): Promise<Set<string>> {
  if (usaPostgres("automatizaciones")) {
    const pg = await import("./pg");
    return pg.listPresupuestoIdsPendientesPg();
  }
  const recs = await base(TABLES.secuenciasAutomaticas as any)
    .select({
      filterByFormula: `{estado}="pendiente"`,
      fields: ["presupuesto_id"],
      maxRecords: 5000,
    })
    .all();
  return new Set(recs.map((r) => String((r.fields as any)["presupuesto_id"] ?? "")));
}

/** Alta de una secuencia (fields los compone procesar; passthrough FASE 1). */
export async function createSecuenciaRaw(fields: Record<string, unknown>): Promise<void> {
  if (usaPostgres("automatizaciones")) {
    const pg = await import("./pg");
    return pg.createSecuenciaRawPg(fields);
  }
  await base(TABLES.secuenciasAutomaticas as any).create([{ fields }] as any);
}

/** SOLO DEMO — ids de secuencias cuyos presupuesto_id están en la lista. */
export async function listSecuenciaIdsPorPresupuestos(presupuestoIds: string[]): Promise<string[]> {
  const formula = `OR(${presupuestoIds.map((id) => `{presupuesto_id}="${id}"`).join(",")})`;
  const recs = await base(TABLES.secuenciasAutomaticas as any)
    .select({ filterByFormula: formula, fields: [] })
    .all();
  return recs.map((r) => r.id);
}

/** SOLO DEMO — borra secuencias por id. */
export async function destroySecuencias(ids: string[]): Promise<void> {
  if (ids.length) await base(TABLES.secuenciasAutomaticas as any).destroy(ids);
}

/** SOLO DEMO — alta en lote (seed). */
export async function createSecuenciasRaw(fieldsList: Array<Record<string, unknown>>): Promise<void> {
  await base(TABLES.secuenciasAutomaticas as any).create(
    fieldsList.map((fields) => ({ fields })) as any,
  );
}
