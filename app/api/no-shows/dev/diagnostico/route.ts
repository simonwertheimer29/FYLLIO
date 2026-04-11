// app/api/no-shows/dev/diagnostico/route.ts
// TEMPORAL — diagnóstico de campos Airtable en producción.
// GET /api/no-shows/dev/diagnostico
// Borrar después de resolver los bugs.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../../lib/airtable";

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

export async function GET() {
  try {
    const [citasRecs, staffRecs, clinicaRecs, sillonRecs] = await Promise.all([
      base(TABLES.appointments as any).select({ maxRecords: 3 }).all(),
      base("Staff" as any).select({ fields: ["Staff ID", "Nombre", "Clínica_id", "Rol"] }).all(),
      base("Clínicas" as any).select({ fields: ["Clínica ID", "Nombre"] }).all(),
      base("Sillones" as any).select({ fields: ["Sillón ID", "Nombre"] }).all(),
    ]);

    // Construir mapas tal como lo hacen hoy/riesgo/agenda
    const staffMap   = new Map(staffRecs.map((r: any) => [firstString(r.fields["Staff ID"]),   firstString(r.fields["Nombre"])]));
    const clinicaMap = new Map(clinicaRecs.map((r: any) => [firstString(r.fields["Clínica ID"]), firstString(r.fields["Nombre"])]));
    const sillonMap  = new Map(sillonRecs.map((r: any) => [firstString(r.fields["Sillón ID"]),  firstString(r.fields["Nombre"])]));

    return NextResponse.json({
      // ── Totales reales desde Airtable ──
      staffCount:    staffRecs.length,
      clinicasCount: clinicaRecs.length,
      sillonesCount: sillonRecs.length,

      // ── Mapas resueltos ──
      staffMap:   Object.fromEntries(staffMap),
      clinicaMap: Object.fromEntries(clinicaMap),
      sillonMap:  Object.fromEntries(sillonMap),

      // ── Staff con campos raw (para ver qué devuelve Airtable) ──
      staffRaw: staffRecs.map((r: any) => ({ id: r.id, fields: r.fields })),

      // ── Primeras 3 citas con TODOS sus campos ──
      primerasCitas: citasRecs.map((r: any) => ({
        id: r.id,
        fields: r.fields,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
