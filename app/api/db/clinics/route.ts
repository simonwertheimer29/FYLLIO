// app/api/db/clinics/route.ts
// Lists clinics available in the Airtable base.
// Used by ClinicSelector for multi-clinic navigation.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";

export async function GET() {
  try {
    const recs = await base(TABLES.clinics as any)
      .select({ fields: ["Clínica ID", "Nombre"], maxRecords: 50 })
      .all();

    const clinics = recs.map((r) => ({
      id: String(r.get("Clínica ID") ?? r.id),
      recordId: r.id,
      name: String(r.get("Nombre") ?? "Clínica sin nombre"),
    }));

    return NextResponse.json({ clinics });
  } catch (e: any) {
    console.error("[clinics] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
