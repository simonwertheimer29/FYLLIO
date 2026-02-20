// app/api/db/treatments/route.ts
// Returns the list of treatments for use in dropdowns.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";

export async function GET() {
  try {
    const recs = await base(TABLES.treatments as any)
      .select({ fields: ["Nombre", "Duración"], maxRecords: 100 })
      .all();

    return NextResponse.json({
      treatments: recs.map((r) => ({
        id: r.id,
        name: String(r.get("Nombre") ?? ""),
        duration: Number(r.get("Duración") ?? 0),
      })),
    });
  } catch (e: any) {
    console.error("[treatments] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
