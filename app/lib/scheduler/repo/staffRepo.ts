// app/lib/scheduler/repo/staffRepo.ts
import { base, TABLES } from "../../airtable";

export type StaffRow = {
  recordId: string;      // recXXXX
  staffId: string;        // STF_001
  name: string;           // "Mateo López"
  activo: boolean;
  horarioLaboral?: string; // "08:30-19:00"
  almuerzoInicio?: any;    // puede ser date o string según Airtable
  almuerzoFin?: any;
  treatments?: string[];   // si lo tienes como multi-select o lookup
  rol?: string;
};

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function firstBool(x: unknown): boolean {
  if (typeof x === "boolean") return x;
  return Boolean(x);
}

export async function listStaff(): Promise<StaffRow[]> {
  const records = await base(TABLES.staff).select({ maxRecords: 200 }).all();

  return records.map((r: any) => {
    const f: any = r.fields;

    const staffId = String(f["Staff ID"] ?? "").trim();
    const name = String(f["Nombre"] ?? "").trim();
    const activo = firstBool(f["Activo"]);
    const rol = String(f["Rol"] ?? "").trim();

    // opcional: treatments (depende cómo lo tengas)
    const treatments =
      Array.isArray(f["Tratamientos"]) ? f["Tratamientos"].map(String) :
      Array.isArray(f["treatments"]) ? f["treatments"].map(String) :
      undefined;

    return {
      recordId: r.id,
      staffId,
      name,
      activo,
      rol,
      horarioLaboral: String(f["Horario laboral"] ?? "").trim() || undefined,
      almuerzoInicio: f["Almuerzo_inicio"],
      almuerzoFin: f["Almuerzo_fin"],
      treatments,
    };
  }).filter(s => !!s.staffId);
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — acceso restante a la tabla Staff.
// ─────────────────────────────────────────────────────────────────────

import { fetchAll } from "../../airtable";

/** Map recordId → Nombre para resolver doctores por lote de IDs. */
export async function mapStaffNombrePorIds(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const formula = `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
  const recs = await fetchAll(
    base(TABLES.staff as any).select({ filterByFormula: formula, fields: ["Nombre"] }),
  );
  for (const r of recs) map.set(r.id, String((r.fields as any)?.["Nombre"] ?? ""));
  return map;
}

/** Record crudo de un staff por su Staff ID (agenda demo lee Nombre,
 *  Horario laboral y Almuerzo via rec.get()). null si no existe. */
export async function findStaffPorStaffIdRaw(staffId: string): Promise<any | null> {
  const safe = String(staffId).replace(/'/g, "\\'");
  const recs = await base(TABLES.staff)
    .select({ maxRecords: 1, filterByFormula: `{Staff ID}='${safe}'` })
    .firstPage();
  return recs?.[0] ?? null;
}

/** Campo Horario de un staff por record id (validación de nueva cita). */
export async function getStaffHorarioPorRecordId(staffRecordId: string): Promise<any | null> {
  const recs = await base(TABLES.staff)
    .select({
      filterByFormula: `RECORD_ID()='${staffRecordId}'`,
      fields: ["Horario"],
      maxRecords: 1,
    })
    .all();
  return recs?.[0] ?? null;
}

/** Primera página del staff (lista demo /api/db/staff). */
export async function listStaffFirstPageRaw(maxRecords = 200): Promise<readonly any[]> {
  return base(TABLES.staff).select({ maxRecords }).firstPage();
}

/** Nombre de un staff por record id (plantillas). Lanza si no existe. */
export async function getStaffNombrePorId(staffId: string): Promise<string> {
  const rec = await base(TABLES.staff).find(staffId);
  return String((rec.fields as any)?.["Nombre"] ?? "");
}

/** Record crudo por id (motor no-shows enriquece el histórico). */
export async function findStaffRaw(recId: string): Promise<any> {
  return base(TABLES.staff).find(recId);
}

/** Volcado con fields explícitos (superficie diferida no-shows: mapas
 *  Staff ID / Nombre / Clínica / Rol). Se re-tipa al migrar ese módulo. */
export async function listStaffCamposRaw(fields: string[]): Promise<readonly any[]> {
  return base(TABLES.staff).select({ fields }).all();
}

/** SOLO DEV — alta cruda de staff (seeder). */
export async function createStaffDev(fields: Record<string, unknown>): Promise<string> {
  const r = await (base(TABLES.staff) as any).create(fields);
  return r.id;
}
