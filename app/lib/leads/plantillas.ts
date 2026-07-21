// app/lib/leads/plantillas.ts
//
// FASE 1 migración (dominio piloto Leads) — repositorio de Plantillas_Lead.
// Único punto de acceso a la tabla; Airtable vive solo aquí. En FASE 2 este
// archivo cambia su interior a Postgres sin tocar a los callers.

import { base, TABLES, fetchAll } from "../airtable";
import { usaPostgres } from "../db/data-backend";

export type PlantillaLead = {
  id: string;
  nombre: string;
  tipo:
    | "Primer_Contacto"
    | "Recordatorio_Cita"
    | "Reactivacion_NoAsistio"
    | "Seguimiento_SinRespuesta";
  contenido: string;
};

/** Plantillas WA activas para leads, ordenadas por tipo. Globales (sin
 *  filtro por clínica — decisión Sprint 10 D). */
export async function listPlantillasLeadActivas(): Promise<PlantillaLead[]> {
  if (usaPostgres("leads")) {
    const pg = await import("./pg");
    return pg.listPlantillasLeadActivasPg();
  }
  const recs = await fetchAll(
    base(TABLES.plantillasLead as any).select({
      filterByFormula: "{Activa}=TRUE()",
      sort: [{ field: "Tipo", direction: "asc" }],
    }),
  );
  return recs.map((r) => {
    const f = r.fields as any;
    return {
      id: r.id,
      nombre: String(f["Nombre"] ?? ""),
      tipo: (f["Tipo"] ?? "Primer_Contacto") as PlantillaLead["tipo"],
      contenido: String(f["Contenido"] ?? ""),
    };
  });
}
