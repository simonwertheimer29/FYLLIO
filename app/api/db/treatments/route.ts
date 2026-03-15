// app/api/db/treatments/route.ts
// Returns the list of treatments (for dropdowns) and allows patching instructions.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";

export async function GET() {
  try {
    // No fields filter — Airtable may reject if field names have encoding differences
    const recs = await base(TABLES.treatments as any)
      .select({ maxRecords: 100 })
      .all();

    const mapped = recs.map((r) => ({
      id: r.id,
      name: String(r.get("Nombre") ?? ""),
      duration: Number(r.get("Duración") ?? r.get("Duracion") ?? r.get("Duration") ?? 0),
      instructions: String(r.get("Instrucciones_pre") ?? r.get("Instrucciones") ?? ""),
    }));

    // Deduplicate by name (case-insensitive) — keep first occurrence
    const seen = new Set<string>();
    const treatments = mapped.filter((t) => {
      const key = t.name.toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({ treatments });
  } catch (e: any) {
    console.error("[treatments] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}

// PATCH /api/db/treatments?id=recXXX  { instructions: "..." }
export async function PATCH(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const body = await req.json();
    const instructions = String(body.instructions ?? "").trim();

    await base(TABLES.treatments as any).update([
      { id, fields: { Instrucciones_pre: instructions } as any },
    ]);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[treatments PATCH] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
