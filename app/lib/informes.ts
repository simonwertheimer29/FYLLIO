// app/lib/informes.ts
//
// FASE 1 migración — repositorio de la tabla Informes_Guardados
// (informes semanales IA + no-show). Passthrough.

import { base, TABLES } from "./airtable";
import { usaPostgres } from "./db/data-backend";

export async function selectInformesRaw(opts: {
  fields?: string[];
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<readonly any[]> {
  const pg = await import("./informes-pg");
  return pg.selectInformesRawPg(opts);
  
}

export async function updateInformeRaw(id: string, fields: Record<string, unknown>): Promise<any> {
  const pg = await import("./informes-pg");
  return pg.updateInformeRawPg(id, fields);
  
}

export async function createInformeRaw(fields: Record<string, unknown>): Promise<any> {
  const pg = await import("./informes-pg");
  return pg.createInformeRawPg(fields);
  
}
