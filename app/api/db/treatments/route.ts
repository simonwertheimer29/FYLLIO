// app/api/db/treatments/route.ts
// Returns the list of treatments (for dropdowns) and allows patching instructions.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";

export async function GET() {
  try {
    const recs = await base(TABLES.treatments as any)
      .select({ fields: ["Nombre", "Duración", "Instrucciones_pre"], maxRecords: 100 })
      .all();

    return NextResponse.json({
      treatments: recs.map((r) => ({
        id: r.id,
        name: String(r.get("Nombre") ?? ""),
        duration: Number(r.get("Duración") ?? 0),
        instructions: String(r.get("Instrucciones_pre") ?? ""),
      })),
    });
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
