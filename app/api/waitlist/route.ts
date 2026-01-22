// app/api/waitlist/route.ts
import { NextResponse } from "next/server";
import { base, TABLES } from "../../lib/airtable";


export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clinicRecordId = searchParams.get("clinicRecordId");

  if (!clinicRecordId) {
    return NextResponse.json({ error: "clinicRecordId required" }, { status: 400 });
  }

  const records = await base(TABLES.waitlist)
    .select({
     filterByFormula: `
AND(
  {Clínica} = '${clinicRecordId}',
  {Estado} != 'Aceptado',
  {Estado} != 'Expirado'
)
`.trim(),


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
    paciente: r.get("Paciente"),      // Airtable devuelve arrays para links
    tratamiento: r.get("Tratamiento"),
    profesional: r.get("Profesional preferido"),
  }));

  return NextResponse.json({ data });
}
