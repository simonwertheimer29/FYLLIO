// app/lib/scheduler/repo/treatmentsRepo.ts
import { base, TABLES } from "../../airtable";
import { usaPostgres } from "../../db/data-backend";

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

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — acceso restante a la tabla Tratamientos.
// ─────────────────────────────────────────────────────────────────────

import { fetchAll } from "../../airtable";

/** PATCH de instrucciones pre-tratamiento (config del dropdown demo). */
export async function updateTratamientoInstrucciones(
  id: string,
  instrucciones: string,
): Promise<void> {
  const pg = await import("./pg");
  return pg.updateTratamientoInstruccionesPg(id, instrucciones);
  
}

/** Volcado crudo (dropdown demo lee Nombre/Duración/Instrucciones con
 *  varios alias de campo; dedup en el caller). */
export async function listTratamientosRaw(maxRecords = 100): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listTratamientosRawPg(maxRecords);
  
}

/** Nombre → Instrucciones_pre (recordatorios del cron daily). */
export async function listTratamientosInstrucciones(): Promise<
  Array<{ nombre: string; instruccionesPre: string }>
> {
  const pg = await import("./pg");
  return pg.listTratamientosInstruccionesPg();
  
}

/** Map recordId → fields para expandir linked records (fields fijos). */
export async function mapTratamientosPorIds(
  ids: string[],
  fields: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const pg = await import("./pg");
  return pg.mapTratamientosPorIdsPg(ids, fields);
  
}

/** Records crudos por lote de IDs, sin restricción de fields (la vista
 *  semanal demo lee via rec.get()). firstPage por chunk, como su helper. */
export async function listTratamientosPorIdsRaw(ids: string[]): Promise<any[]> {
  const pg = await import("./pg");
  return pg.listTratamientosPorIdsRawPg(ids);
  
}

/** id + Nombre de todos los tratamientos (seeders dev). */
export async function listTratamientosNombreRaw(): Promise<readonly any[]> {
  const pg = await import("./pg");
  return pg.listTratamientosNombreRawPg();
  
}
