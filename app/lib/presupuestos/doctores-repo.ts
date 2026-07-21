// app/lib/presupuestos/doctores-repo.ts
//
// FASE 1 migración (dominio Presupuestos) — repositorio de la tabla
// Doctores_Presupuestos (solo lectura; sin escrituras en toda la app).

import { base, TABLES } from "../airtable";
import { usaPostgres } from "../db/data-backend";

/** Doctores del módulo presupuestos (la fórmula la compone el caller). */
export async function listDoctoresPresupuestosRaw(filterByFormula: string): Promise<readonly any[]> {
  if (usaPostgres("presupuestos")) {
    const pg = await import("./pg");
    return pg.listDoctoresPresupuestosRawPg(filterByFormula);
  }
  return base(TABLES.doctoresPresupuestos as any)
    .select({
      filterByFormula,
      fields: ["Nombre", "Especialidad", "Clinica", "Activo"],
      sort: [{ field: "Nombre", direction: "asc" }],
      maxRecords: 100,
    })
    .all();
}
