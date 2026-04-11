// app/api/no-shows/dev/seed/route.ts
// TEMPORAL — crea 35 citas de prueba en Airtable "Citas".
// Eliminar después de verificar que los datos reales funcionan.
// GET /api/no-shows/dev/seed
// GET /api/no-shows/dev/seed?delete=true  → elimina los registros creados

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { base, TABLES } from "../../../../lib/airtable";

const ZONE = "Europe/Madrid";

// ── Pacientes ficticios ─────────────────────────────────────────────────────
const PACIENTES = [
  { nombre: "María García López",     tel: "+34 612 345 678" },
  { nombre: "Carlos Martínez Ruiz",   tel: "+34 623 456 789" },
  { nombre: "Ana Sánchez Pérez",      tel: "+34 634 567 890" },
  { nombre: "Luis Fernández Torres",  tel: "+34 645 678 901" },
  { nombre: "Elena Rodríguez Gómez",  tel: "+34 656 789 012" },
  { nombre: "Jorge López Díaz",       tel: "+34 667 890 123" },
  { nombre: "Isabel Martín Jiménez",  tel: "+34 678 901 234" },
  { nombre: "Pablo González Moreno",  tel: "+34 689 012 345" },
  { nombre: "Carmen Álvarez Muñoz",   tel: "+34 690 123 456" },
  { nombre: "Javier Romero Navarro",  tel: "+34 601 234 567" },
  { nombre: "Lucía Castro Herrero",   tel: "+34 612 987 654" },
  { nombre: "Diego Blanco Vega",      tel: "+34 623 876 543" },
  { nombre: "Sofía Moreno Delgado",   tel: "+34 634 765 432" },
  { nombre: "Alejandro Ramos Ortiz",  tel: "+34 645 654 321" },
  { nombre: "Nuria Molina Serrano",   tel: "+34 656 543 210" },
];

const TRATAMIENTOS = [
  "Ortodoncia",
  "Implante dental",
  "Limpieza dental",
  "Revisión general",
  "Blanqueamiento",
  "Endodoncia",
  "Extracción",
  "Carillas de porcelana",
  "Periodoncia",
];

// ── Distribución de citas: [dayOffset desde lunes, hora inicio, duración min] ──
// Semana actual (offsets 0-4) + semana siguiente (offsets 7-11)
const SLOTS: [number, number, number, number][] = [
  // [dayOffset desde monday, horaInicio, minutos inicio, duracion]
  // Semana actual
  [0,  8,  0, 45], [0, 10, 0, 60], [0, 12,  0, 45], [0, 16,  0, 60],
  [1,  9,  0, 45], [1, 11, 0, 60], [1, 14,  0, 45], [1, 17,  0, 45],
  [2,  8, 30, 60], [2, 11, 30, 45], [2, 15, 0, 60],
  [3,  9, 30, 45], [3, 11, 0, 60], [3, 13, 30, 45], [3, 16, 30, 60],
  [4,  8,  0, 45], [4, 10, 30, 60], [4, 12, 30, 45],
  // Semana siguiente
  [7,  9,  0, 60], [7, 11, 30, 45], [7, 14, 30, 60],
  [8,  8, 30, 45], [8, 10,  0, 60], [8, 13,  0, 45], [8, 16,  0, 60],
  [9,  9, 30, 60], [9, 12,  0, 45], [9, 15, 30, 60],
  [10, 8,  0, 45], [10, 10, 30, 60], [10, 13, 30, 45], [10, 17, 0, 45],
  [11, 9,  0, 60], [11, 11, 0, 45],
  [11, 14,  0, 60],
];

function getMondayOfCurrentWeek(): DateTime {
  const now = DateTime.now().setZone(ZONE).startOf("day");
  const dow = now.weekday; // 1 = Monday … 7 = Sunday
  return now.minus({ days: dow - 1 });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // ── Modo borrado: ?delete=true ──────────────────────────────────────────
  if (searchParams.get("delete") === "true") {
    try {
      const key = "SEED_NOTAS_MARKER";
      // Buscar registros creados por este seed (tienen marker en Notas)
      const recs = await (base(TABLES.appointments as any)
        .select({ filterByFormula: `FIND("${key}", COALESCE({Notas},"")) > 0`, maxRecords: 200 })
        .all() as any);
      const ids: string[] = recs.map((r: any) => r.id);
      // Airtable borrar en lotes de 10
      for (let i = 0; i < ids.length; i += 10) {
        await (base(TABLES.appointments as any).destroy(ids.slice(i, i + 10) as any) as any);
      }
      return NextResponse.json({ ok: true, deleted: ids.length });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message }, { status: 500 });
    }
  }

  // ── Crear citas ─────────────────────────────────────────────────────────
  const monday = getMondayOfCurrentWeek();
  const created: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < SLOTS.length; i++) {
    const [dayOffset, h, m, dur] = SLOTS[i];
    const paciente = PACIENTES[i % PACIENTES.length];
    const tratamiento = TRATAMIENTOS[i % TRATAMIENTOS.length];

    const day = monday.plus({ days: dayOffset });
    const startDt = day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
    const endDt   = startDt.plus({ minutes: dur });

    // ~60% confirmadas
    const confirmada = i % 5 !== 0 && i % 5 !== 3;

    const notas = [
      `Tratamiento: ${tratamiento}`,
      `Tel: ${paciente.tel}`,
      "SEED_NOTAS_MARKER",
      confirmada ? "Confirmada" : "Pendiente confirmación",
    ].join(" | ");

    const fields: Record<string, unknown> = {
      "Nombre":      paciente.nombre,
      "Hora inicio": startDt.toUTC().toISO(),
      "Hora final":  endDt.toUTC().toISO(),
      "Notas":       notas,
    };

    try {
      const rec = await (base(TABLES.appointments as any).create(fields as any) as any);
      created.push(rec.id);
    } catch (e: any) {
      errors.push(`slot[${i}]: ${e?.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    created: created.length,
    errors,
    createdIds: created,
    monday: monday.toISODate(),
  }, { status: 201 });
}
