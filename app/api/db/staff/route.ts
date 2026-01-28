import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";

const FIELDS = {
  staffId: "Staff ID",
  name: "Nombre", // AJUSTA si tu campo se llama distinto: "Name", "Full name", etc.
  role: "Rol",    // opcional
};

export async function GET() {
  try {
    const recs = await base(TABLES.staff).select({ maxRecords: 200 }).firstPage();

    const staff = recs
      .map((r: any) => ({
        id: String(r.get(FIELDS.staffId) ?? ""),      // STF_001
        name: String(r.get(FIELDS.name) ?? "Staff"),  // Dr. García
        role: String(r.get(FIELDS.role) ?? ""),       // opcional
        recordId: r.id,                               // opcional (a veces útil)
      }))
      .filter((s) => !!s.id);

    return NextResponse.json({ staff });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to fetch staff" }, { status: 500 });
  }
}
