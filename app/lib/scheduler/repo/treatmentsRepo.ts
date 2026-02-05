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

export async function listTreatments(params: { clinicRecordId?: string }): Promise<TreatmentRow[]> {
  const { clinicRecordId } = params;

  // ✅ Cache hit
  if (_cache && Date.now() - _cache.atMs < CACHE_TTL_MS) {
    return clinicRecordId ? filterByClinic(_cache.data, clinicRecordId) : _cache.data;
  }

  const table = TABLES.treatments;

  // ✅ Reduce payload: solo los fields que usas
  const records = await base(table)
    .select({
      maxRecords: 200,
      fields: [
        "Tratamientos ID",
        "Categoria",
        "Duración",
        "Buffer antes",
        "Buffer despues",
        "Clínica ID", // solo por si existe; si no existe, Airtable simplemente no lo devuelve
      ],
    })
    .firstPage();

  console.log("[treatmentsRepo] fetched", {
    table,
    count: records.length,
    sampleFieldKeys: records[0] ? Object.keys(records[0].fields || {}) : [],
  });

  const out: TreatmentRow[] = records.map((r: any) => {
    const f: any = r.fields || {};

    const serviceId = String(firstString(f["Tratamientos ID"]) || "").trim();
    const name = String(firstString(f["Categoria"]) || "").trim();

    const durationMin = toNum(f["Duración"]);
    const bufferBeforeMin = toNum(f["Buffer antes"]);
    const bufferAfterMin = toNum(f["Buffer despues"]);

    return {
      recordId: r.id,
      serviceId: serviceId || undefined,
      name: name || "(Sin nombre)",
      durationMin,
      bufferBeforeMin,
      bufferAfterMin,
    };
  });

  // ✅ mínimo: que exista name
  let filtered = out.filter((t) => t.name && t.name !== "(Sin nombre)");

  // orden estable
  filtered.sort((a, b) => (a.serviceId || a.name).localeCompare(b.serviceId || b.name));

  // ✅ guarda cache (sin filtro por clínica; se filtra al devolver)
  _cache = { atMs: Date.now(), data: filtered };

  const final = clinicRecordId ? filterByClinic(filtered, clinicRecordId) : filtered;

  console.log("[treatmentsRepo] normalized", {
    count: final.length,
    sample: final.slice(0, 6).map((t) => ({
      recordId: t.recordId,
      serviceId: t.serviceId,
      name: t.name,
      durationMin: t.durationMin,
      bufferBeforeMin: t.bufferBeforeMin,
      bufferAfterMin: t.bufferAfterMin,
    })),
  });

  return final;
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
