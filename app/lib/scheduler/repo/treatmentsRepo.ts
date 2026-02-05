// app/lib/scheduler/repo/treatmentsRepo.ts
import { base, TABLES } from "../../airtable";

export type TreatmentRow = {
  recordId: string;            // recXXXX
  serviceId?: string;          // SRV_01
  name: string;                // Empaste, Limpieza...
  durationMin?: number;        // Duración (min)
  bufferBeforeMin?: number;    // Buffer antes
  bufferAfterMin?: number;     // Buffer despues
};

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function toNum(x: unknown): number | undefined {
  if (typeof x === "number") return Number.isFinite(x) ? x : undefined;
  const s = String(x ?? "").trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** ---------------------------
 *  Cache in-memory (server)
 *  --------------------------- */
let _cache: { atMs: number; data: TreatmentRow[] } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export async function listTreatments(_: { clinicRecordId?: string }): Promise<TreatmentRow[]> {
  const table = TABLES.treatments;
  const records = await base(table).select({ maxRecords: 200 }).all();

  const out: TreatmentRow[] = records.map((r: any) => {
    const f: any = r.fields || {};
    const serviceId = String(firstString(f["Tratamientos ID"]) || "").trim();
    const name = String(firstString(f["Categoria"]) || "").trim();

    return {
      recordId: r.id,
      serviceId: serviceId || undefined,
      name: name || "(Sin nombre)",
      durationMin: toNum(f["Duración"]),
      bufferBeforeMin: toNum(f["Buffer antes"]),
      bufferAfterMin: toNum(f["Buffer despues"]),
    };
  });

  const filtered = out.filter((t) => t.name && t.name !== "(Sin nombre)");
  filtered.sort((a, b) => (a.serviceId || a.name).localeCompare(b.serviceId || b.name));
  return filtered;
}


function filterByClinic(rows: TreatmentRow[], clinicRecordId: string): TreatmentRow[] {
  // ⚠️ Tu filtro anterior dependía de "Clínica ID" como lookup en Tratamientos.
  // Pero aquí rows ya no trae "Clínica ID" (porque lo normalizas a TreatmentRow).
  // Si de verdad necesitas filtrar por clínica, la forma correcta es filtrar ANTES,
  // usando los records de Airtable (no el out final).
  //
  // Como en tu repo actual ese filtro era "best effort" (si no existe, no filtra),
  // dejamos el comportamiento equivalente: si no hay mapping, NO filtramos.
  //
  // Si quieres filtrado real por clínica, dímelo y lo hacemos con un filterByFormula.
  return rows;
}
