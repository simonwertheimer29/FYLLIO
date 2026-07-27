// app/lib/presupuestos/contactos.ts
//
// FASE 1 migración (dominio Presupuestos) — repositorio de la tabla
// Contactos_Presupuesto. Passthrough (ver nota en repo.ts).

import { base, TABLES } from "../airtable";
import { usaPostgres } from "../db/data-backend";

/** Histórico de contactos de un presupuesto, más recientes primero. */
export async function listContactosDePresupuestoRaw(presupuestoId: string): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listContactosDePresupuestoRawPg(presupuestoId);
  
}

/** Contactos con tono IA usado (estadística de tonos). */
export async function listContactosConTonoRaw(): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listContactosConTonoRawPg();
  
}

/** Alta de un contacto (fields los compone el caller). */
export async function createContactoRaw(fields: Record<string, unknown>): Promise<void> {
  const pg = await import("./pg");
  return pg.createContactoRawPg(fields);
  
}

/** Alta que devuelve el record creado (la ruta de contactos lo usa). */
export async function createContactoConRecordRaw(fields: Record<string, unknown>): Promise<any> {
  const pg = await import("./pg");
  return pg.createContactoConRecordRawPg(fields);
  
}
