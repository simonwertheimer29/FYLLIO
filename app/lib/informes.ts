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
  if (usaPostgres("informes")) {
    const pg = await import("./informes-pg");
    return pg.selectInformesRawPg(opts);
  }
  return base(TABLES.informesGuardados as any).select(opts as any).all();
}

export async function updateInformeRaw(id: string, fields: Record<string, unknown>): Promise<any> {
  if (usaPostgres("informes")) {
    const pg = await import("./informes-pg");
    return pg.updateInformeRawPg(id, fields);
  }
  return (base(TABLES.informesGuardados as any) as any).update(id, fields);
}

export async function createInformeRaw(fields: Record<string, unknown>): Promise<any> {
  if (usaPostgres("informes")) {
    const pg = await import("./informes-pg");
    return pg.createInformeRawPg(fields);
  }
  return (base(TABLES.informesGuardados as any) as any).create([{ fields }]);
}
