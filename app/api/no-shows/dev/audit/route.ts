// app/api/no-shows/dev/audit/route.ts
// TEMPORAL — cuenta registros en cada tabla. Borrar después.
// GET /api/no-shows/dev/audit

import { NextResponse } from "next/server";
import { base } from "../../../../lib/airtable";

const TABLAS = ["Clínicas", "Staff", "Sillones", "Pacientes", "Citas", "Acciones"] as const;

export async function GET() {
  if (process.env.ENABLE_DEV_ENDPOINTS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const results: Record<string, number | string> = {};
  for (const tabla of TABLAS) {
    try {
      const recs = await (base(tabla as any).select({ fields: [] }).all() as any);
      results[tabla] = recs.length;
    } catch (e: any) {
      results[tabla] = `ERROR: ${e?.message ?? "desconocido"}`;
    }
  }
  return NextResponse.json(results);
}
