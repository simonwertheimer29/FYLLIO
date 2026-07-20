// app/lib/presupuestos/doctores-repo.ts
//
// FASE 1 migración (dominio Presupuestos) — repositorio de la tabla
// Doctores_Presupuestos (solo lectura; sin escrituras en toda la app).

import { base, TABLES } from "../airtable";

/** Doctores del módulo presupuestos (la fórmula la compone el caller). */
export async function listDoctoresPresupuestosRaw(filterByFormula: string): Promise<readonly any[]> {
  return base(TABLES.doctoresPresupuestos as any)
    .select({
      filterByFormula,
      fields: ["Nombre", "Especialidad", "Clinica", "Activo"],
      sort: [{ field: "Nombre", direction: "asc" }],
      maxRecords: 100,
    })
    .all();
}
