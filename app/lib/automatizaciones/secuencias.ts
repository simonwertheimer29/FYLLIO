// app/lib/automatizaciones/secuencias.ts
//
// FASE 1 migración (dominio Automatizaciones) — repositorio de la tabla
// Secuencias_Automaticas (subsistema "Operativo": cola de mensajes IA de
// presupuestos). Único punto de acceso; en FASE 2 cambia a Postgres.
// Los métodos *Raw devuelven records crudos (los callers mapean con sus
// propios recordToSecuencia); los que aceptan fórmula/fields crudos son
// passthrough documentado — se tipan al voltear el módulo.


/** Cola filtrada (estado + fragmento opcional de clínica), más recientes
 *  primero. La fórmula la compone el caller con clinica-scope. */
export async function listSecuenciasFiltradasRaw(formula: string): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listSecuenciasFiltradasRawPg(formula);
  
}

/** Patch de una secuencia (enviar/descartar/editar). */
export async function patchSecuencia(
  id: string,
  updates: { estado?: string; mensajeGenerado?: string; actualizadoEn: string },
): Promise<void> {
  const pg = await import("./pg");
  return pg.patchSecuenciaPg(id, updates);
  
}

/** Record crudo (el PATCH enviar lo relee para el historial). */
export async function findSecuenciaRaw(id: string): Promise<any> {
  const pg = await import("./pg");
  return pg.findSecuenciaRawPg(id);
  
}

/** presupuesto_id de todas las secuencias pendientes (dedup de procesar). */
export async function listPresupuestoIdsPendientes(): Promise<Set<string>> {
  const pg = await import("./pg");
  return pg.listPresupuestoIdsPendientesPg();
  
}

/** Alta de una secuencia (fields los compone procesar; passthrough FASE 1). */
export async function createSecuenciaRaw(fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./pg");
  return pg.createSecuenciaRawPg(fields);
  
}

async function db() {
  const { runWithClienteDb } = await import("../db/context");
  const { requireCliente } = await import("../cliente-contexto");
  return { runWithClienteDb, cliente: requireCliente("secuencias") };
}

/** SOLO DEMO — ids de secuencias cuyos presupuesto_id están en la lista. */
export async function listSecuenciaIdsPorPresupuestos(presupuestoIds: string[]): Promise<string[]> {
  if (!presupuestoIds.length) return [];
  const { runWithClienteDb, cliente } = await db();
  const rows = await runWithClienteDb(cliente, (trx) =>
    trx.selectFrom("secuencias_automaticas").select("id").where("presupuesto_id", "in", presupuestoIds).execute());
  return rows.map((r: any) => r.id);
}

/** SOLO DEMO — borra secuencias por id. */
export async function destroySecuencias(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { runWithClienteDb, cliente } = await db();
  await runWithClienteDb(cliente, (trx) =>
    trx.deleteFrom("secuencias_automaticas").where("id", "in", ids).execute());
}

/** SOLO DEMO — alta en lote (seed). */
export async function createSecuenciasRaw(fieldsList: Array<Record<string, unknown>>): Promise<void> {
  for (const fields of fieldsList) await createSecuenciaRaw(fields);
}
