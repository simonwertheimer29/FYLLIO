// app/api/leads/plantillas/route.ts
//
// Sprint 10 D — devuelve las plantillas WA activas para leads. Globales
// (no filtra por clínica en este sprint).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { base, TABLES, fetchAll } from "../../../lib/airtable";

export const dynamic = "force-dynamic";

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

export const GET = withAuth(async () => {
  try {
    const recs = await fetchAll(
      base(TABLES.plantillasLead as any).select({
        filterByFormula: "{Activa}=TRUE()",
        sort: [{ field: "Tipo", direction: "asc" }],
      }),
    );
    const plantillas: PlantillaLead[] = recs.map((r) => {
      const f = r.fields as any;
      return {
        id: r.id,
        nombre: String(f["Nombre"] ?? ""),
        tipo: (f["Tipo"] ?? "Primer_Contacto") as PlantillaLead["tipo"],
        contenido: String(f["Contenido"] ?? ""),
      };
    });
    return NextResponse.json({ plantillas });
  } catch (err) {
    console.error("[leads/plantillas]", err instanceof Error ? err.message : err);
    return NextResponse.json({ plantillas: [] });
  }
});
