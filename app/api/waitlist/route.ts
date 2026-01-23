// app/api/waitlist/route.ts
import { NextResponse } from "next/server";
import { base, TABLES } from "../../lib/airtable";

function escapeAirtableString(s: string) {
  // Airtable formulas use single quotes for strings; escape single quotes by doubling
  return s.replace(/'/g, "''");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clinicRecordId = searchParams.get("clinicRecordId");

    if (!clinicRecordId) {
      return NextResponse.json({ error: "clinicRecordId required" }, { status: 400 });
    }

    const clinicSafe = escapeAirtableString(clinicRecordId);

    const filterByFormula = `
AND(
  {Clínica} = '${clinicSafe}',
  {Estado} != 'Aceptado',
  {Estado} != 'Expirado'
)
`.trim();

    const records = await base(TABLES.waitlist)
      .select({
        filterByFormula,
        sort: [{ field: "Prioridad", direction: "desc" }],
        maxRecords: 200,
      })
      .all();

    const data = records.map((r) => ({
      id: r.id,
      waitingId: r.get("Waiting ID"),
      estado: r.get("Estado"),
      prioridad: r.get("Prioridad"),
      preferencia: r.get("Preferencia de horario"),
      rango: r.get("Rango deseado"),
      ultimoContacto: r.get("Último contacto"),
      notas: r.get("Notas / Contexto"),

      // links (arrays de record ids)
      paciente: r.get("Paciente"),
      tratamiento: r.get("Tratamiento"),
      profesional: r.get("Profesional preferido"),
    }));

    return NextResponse.json({ data });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to load waitlist" },
      { status: 500 }
    );
  }
}
