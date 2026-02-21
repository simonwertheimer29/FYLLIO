// app/api/db/quotes/route.ts
// Presupuestos pipeline — fetches from Airtable "Presupuestos" table.
// Expands the "Paciente" linked record to get Nombre + Teléfono from Pacientes.
// Falls back to rich demo data if the table doesn't exist yet.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";

const ZONE = "Europe/Madrid";

export type QuoteStatus = "PRESENTADO" | "INTERESADO" | "CONFIRMADO" | "PERDIDO";

export type Quote = {
  id: string;
  patientName: string;
  patientPhone?: string;
  treatment: string;
  amount: number;
  status: QuoteStatus;
  presentedAt: string; // ISO date YYYY-MM-DD
  daysSince: number;
  notes?: string;
};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function daysBetween(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

async function fetchByRecordIds(
  tableName: any,
  ids: string[],
  fields: string[]
): Promise<Map<string, Record<string, unknown>>> {
  if (!ids.length) return new Map();
  const uniq = [...new Set(ids)];
  const map = new Map<string, Record<string, unknown>>();
  const chunkSize = 40;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const formula = chunk.length === 1
      ? `RECORD_ID()='${chunk[0]}'`
      : `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const recs = await base(tableName)
      .select({ filterByFormula: formula, fields })
      .all();
    for (const r of recs) map.set(r.id, r.fields);
  }
  return map;
}

// -------------------------------------------------------------------
// Demo data — shown when table doesn't exist or is empty
// -------------------------------------------------------------------

function buildDemoQuotes(): Quote[] {
  const today = DateTime.now().setZone(ZONE);
  const ago = (n: number) => today.minus({ days: n }).toISODate()!;

  return [
    { id: "q1",  patientName: "María García López",      patientPhone: "+34611100001", treatment: "Implante dental",       amount: 2800, status: "PRESENTADO",  presentedAt: ago(18), daysSince: 18, notes: "Duda sobre tiempo de recuperación" },
    { id: "q2",  patientName: "Carmen Sánchez Torres",   patientPhone: "+34611100003", treatment: "Ortodoncia invisible",  amount: 4200, status: "PRESENTADO",  presentedAt: ago(21), daysSince: 21 },
    { id: "q3",  patientName: "Isabel Rodríguez Pérez",  patientPhone: "+34611100005", treatment: "Blanqueamiento dental", amount:  380, status: "PRESENTADO",  presentedAt: ago(8),  daysSince: 8 },
    { id: "q4",  patientName: "Lucía Fernández Moreno",  patientPhone: "+34611100007", treatment: "Carillas de porcelana", amount: 3200, status: "PRESENTADO",  presentedAt: ago(14), daysSince: 14, notes: "Muy interesada, pendiente financiación" },
    { id: "q5",  patientName: "Ana Martín Álvarez",      patientPhone: "+34611100009", treatment: "Prótesis dental",       amount: 2400, status: "PRESENTADO",  presentedAt: ago(5),  daysSince: 5 },
    { id: "q6",  patientName: "Juan Martínez Ruiz",      patientPhone: "+34611100002", treatment: "Ortodoncia invisible",  amount: 3900, status: "INTERESADO",  presentedAt: ago(12), daysSince: 12, notes: "Pide pago en 3 cuotas" },
    { id: "q7",  patientName: "Antonio López Fernández", patientPhone: "+34611100004", treatment: "Implante dental",       amount: 2800, status: "INTERESADO",  presentedAt: ago(7),  daysSince: 7 },
    { id: "q8",  patientName: "Francisco González Díaz", patientPhone: "+34611100006", treatment: "Blanqueamiento dental", amount:  380, status: "INTERESADO",  presentedAt: ago(5),  daysSince: 5, notes: "Quiere hacerlo antes de su boda" },
    { id: "q9",  patientName: "Miguel Pérez Jiménez",    patientPhone: "+34611100008", treatment: "Ortodoncia invisible",  amount: 4500, status: "CONFIRMADO",  presentedAt: ago(30), daysSince: 30 },
    { id: "q10", patientName: "José Sánchez Romero",     patientPhone: "+34611100010", treatment: "Implante dental",       amount: 2800, status: "CONFIRMADO",  presentedAt: ago(45), daysSince: 45 },
    { id: "q11", patientName: "Marta López Gil",                                        treatment: "Carillas de porcelana", amount: 2400, status: "PERDIDO",     presentedAt: ago(60), daysSince: 60, notes: "Se fue con otra clínica por precio" },
    { id: "q12", patientName: "Carlos García Molina",                                   treatment: "Implante dental",       amount: 2800, status: "PERDIDO",     presentedAt: ago(35), daysSince: 35, notes: "Sin respuesta tras 3 seguimientos" },
  ];
}

// -------------------------------------------------------------------
// GET /api/db/quotes
// -------------------------------------------------------------------

export async function GET() {
  try {
    // 1. Fetch all quotes from Airtable
    const recs = await base("Presupuestos" as any)
      .select({
        fields: ["Paciente", "Tratamiento_nombre", "Importe", "Estado", "Fecha", "Notas"],
        maxRecords: 200,
        sort: [{ field: "Fecha", direction: "desc" }],
      })
      .all();

    if (recs.length === 0) {
      return NextResponse.json({ quotes: buildDemoQuotes(), isDemo: true });
    }

    // 2. Collect all unique patient record IDs
    const patientIds = [
      ...new Set(
        recs.flatMap((r) => ((r.fields as any)["Paciente"] as string[] | undefined) ?? [])
      ),
    ];

    // 3. Expand patient records to get Nombre + Teléfono
    const patientMap = await fetchByRecordIds(
      TABLES.patients as any,
      patientIds,
      ["Nombre", "Teléfono"]
    );

    // 4. Build output
    const quotes: Quote[] = recs.map((r) => {
      const f = r.fields as any;
      const patId: string | undefined = (f["Paciente"] as string[] | undefined)?.[0];
      const pat = patId ? patientMap.get(patId) : null;

      const presentedAt = String(f["Fecha"] ?? "").slice(0, 10) ||
        DateTime.now().setZone(ZONE).toISODate()!;

      const rawStatus = String(f["Estado"] ?? "PRESENTADO").toUpperCase();
      const status: QuoteStatus =
        ["PRESENTADO", "INTERESADO", "CONFIRMADO", "PERDIDO"].includes(rawStatus)
          ? (rawStatus as QuoteStatus)
          : "PRESENTADO";

      return {
        id: r.id,
        patientName: pat ? String(pat["Nombre"] ?? "Paciente") : "Paciente",
        patientPhone: pat && pat["Teléfono"] ? String(pat["Teléfono"]) : undefined,
        treatment: String(f["Tratamiento_nombre"] ?? "Tratamiento"),
        amount: Number(f["Importe"] ?? 0),
        status,
        presentedAt,
        daysSince: daysBetween(presentedAt),
        notes: f["Notas"] ? String(f["Notas"]) : undefined,
      };
    });

    return NextResponse.json({ quotes, isDemo: false });
  } catch {
    // Table doesn't exist or Airtable error — return demo data
    return NextResponse.json({ quotes: buildDemoQuotes(), isDemo: true });
  }
}

// -------------------------------------------------------------------
// PATCH /api/db/quotes   body: { id, status }
// -------------------------------------------------------------------

export async function PATCH(req: Request) {
  try {
    const { id, status }: { id: string; status: QuoteStatus } = await req.json();
    if (!id || !status) {
      return NextResponse.json({ error: "id and status required" }, { status: 400 });
    }
    await base("Presupuestos" as any).update(id, { Estado: status });
    return NextResponse.json({ ok: true });
  } catch {
    // Demo mode — just acknowledge
    return NextResponse.json({ ok: true, demo: true });
  }
}
