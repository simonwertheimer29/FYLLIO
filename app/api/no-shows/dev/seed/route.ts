// app/api/no-shows/dev/seed/route.ts
// TEMPORAL — crea 40 citas de prueba en Airtable "Citas".
// Eliminar después de confirmar que los datos reales funcionan.
// GET /api/no-shows/dev/seed
// GET /api/no-shows/dev/seed?delete=true  → elimina los registros creados

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { base, TABLES } from "../../../../lib/airtable";

const ZONE = "Europe/Madrid";
const MARKER = "SEED_2026_MARKER";

// ── Pacientes ficticios ───────────────────────────────────────────────────────
const PACIENTES = [
  "Carmen Rodríguez", "Javier López",   "María Sánchez",   "Roberto García",
  "Ana Torres",        "David Martín",   "Elena Flores",    "Pablo Díaz",
  "Isabel Fernández",  "Miguel Herrera", "Sofía Navarro",   "Felipe Castro",
  "Cristina Vega",     "Tomás Guerrero", "Marta Jiménez",   "Valeria Romero",
  "Andrés Peña",       "Hugo Sánchez",   "Natalia Cano",    "Carlos Iglesias",
  "Laura Molina",      "Marcos Reyes",   "Patricia Vidal",  "Sergio Moreno",
];

// ── Tratamientos: [record_id_airtable, duracion_min] ─────────────────────────
// IDs confirmados en la base "Tratamientos"
const TREATMENTS: [string, number][] = [
  ["recFUqYID0nTRjXzS", 60],  // Ortodoncia
  ["rec5uvToPog3Eqkib", 60],  // Blanqueamiento
  ["rec3TNFSaoKvfEX8D", 45],  // Limpieza dental
  ["reccCmM5rwhmMYEfT", 45],  // Empaste
];

// ── Profesionales y sillones (linked record IDs confirmados) ──────────────────
const PROFESIONALES = [
  { recId: "reckmPv1LeIt5zwFk", sillonRecId: "recSqRMYnW5UHd8pa" }, // STF_001 / CHR_001
  { recId: "recz57wPC69oJVe4e", sillonRecId: "recGwDuDixNS3N1Jh" }, // STF_002 / CHR_002
  { recId: "reci2RJOygH4ymaUe", sillonRecId: "recKdd9KJMLil1A7f" }, // STF_003 / CHR_003
];

const CLINICA_REC_ID = "recYsHCvvOP3vkQiZ"; // CLINIC_001

// ── Slots por día: [hora, minuto, prof_idx, treat_idx] ───────────────────────
// STF_001/CHR_001 → 09:00 (60min) y 16:00 (60min) — sin solapamiento
// STF_002/CHR_002 → 10:30 (45min)
// STF_003/CHR_003 → 12:00 (45min)
const DAY_SLOTS: [number, number, number, number][] = [
  [9,  0,  0, 0],  // 09:00 STF_001/CHR_001 → Ortodoncia 60min
  [10, 30, 1, 3],  // 10:30 STF_002/CHR_002 → Empaste 45min
  [12, 0,  2, 2],  // 12:00 STF_003/CHR_003 → Limpieza dental 45min
  [16, 0,  0, 1],  // 16:00 STF_001/CHR_001 → Blanqueamiento 60min
];

// ── 10 días: lun 14 – vie 18 abr + lun 21 – vie 25 abr 2026 ─────────────────
const ALL_DATES = [
  "2026-04-14","2026-04-15","2026-04-16","2026-04-17","2026-04-18",
  "2026-04-21","2026-04-22","2026-04-23","2026-04-24","2026-04-25",
];

// ── Estado por índice global de cita ─────────────────────────────────────────
// Semana 1 (idx 0–19): 40% Confirmado (8), 50% Agendado (10), 10% Cancelado (2)
// Semana 2 (idx 20–39): 20% Confirmado (4), 80% Agendado (16)
function getEstado(idx: number): string {
  if (idx < 20) {
    if ([0, 1, 4, 5, 8, 9, 12, 13].includes(idx)) return "Confirmado";
    if ([3, 7].includes(idx)) return "Cancelado";
    return "Agendado";
  }
  if ([20, 24, 28, 32].includes(idx)) return "Confirmado";
  return "Agendado";
}

export async function GET(req: Request) {
  if (process.env.ENABLE_DEV_ENDPOINTS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { searchParams } = new URL(req.url);

  // ── Modo borrado: ?delete=true ────────────────────────────────────────────
  if (searchParams.get("delete") === "true") {
    try {
      const recs = await (base(TABLES.appointments as any)
        .select({ filterByFormula: `FIND("${MARKER}", COALESCE({Notas},"")) > 0`, maxRecords: 200 })
        .all() as any);
      const ids: string[] = recs.map((r: any) => r.id);
      for (let i = 0; i < ids.length; i += 10) {
        await (base(TABLES.appointments as any).destroy(ids.slice(i, i + 10) as any) as any);
      }
      return NextResponse.json({ ok: true, deleted: ids.length });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message }, { status: 500 });
    }
  }

  // ── Crear 40 citas ────────────────────────────────────────────────────────
  const created: string[] = [];
  const errors: string[] = [];

  let idx = 0;
  for (const dateStr of ALL_DATES) {
    for (const [h, m, profIdx, treatIdx] of DAY_SLOTS) {
      const [treatRecId, durMin] = TREATMENTS[treatIdx];
      const prof   = PROFESIONALES[profIdx];
      const nombre = PACIENTES[idx % PACIENTES.length];
      const estado = getEstado(idx);

      const startDt = DateTime.fromObject(
        {
          year:  parseInt(dateStr.slice(0, 4)),
          month: parseInt(dateStr.slice(5, 7)),
          day:   parseInt(dateStr.slice(8, 10)),
          hour: h, minute: m, second: 0,
        },
        { zone: ZONE },
      );
      const endDt = startDt.plus({ minutes: durMin });

      const fields: Record<string, unknown> = {
        "Nombre":     nombre,
        "Hora inicio": startDt.toUTC().toISO(),
        "Hora final":  endDt.toUTC().toISO(),
        "Estado":      estado,
        "Profesional": [prof.recId],
        "Sillón":      [prof.sillonRecId],
        "Clínica":     [CLINICA_REC_ID],
        "Tratamiento": [treatRecId],
        "Notas":       MARKER,
      };

      try {
        const rec = await (base(TABLES.appointments as any).create(fields as any) as any);
        created.push(rec.id);
      } catch (e: any) {
        errors.push(`[${dateStr} ${h}:${String(m).padStart(2, "0")} profIdx=${profIdx}]: ${e?.message}`);
      }
      idx++;
    }
  }

  return NextResponse.json({
    ok: true,
    created: created.length,
    errors,
    createdIds: created,
  }, { status: 201 });
}
