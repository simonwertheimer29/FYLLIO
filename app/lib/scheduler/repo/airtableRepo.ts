// app/lib/scheduler/repo/airtableRepo.ts
import type { Appointment } from "../../types";
import { base, TABLES } from "../../airtable";

/**
 * Helpers simples para leer fields de Airtable sin rompernos.
 */

async function findRecordIdByField(tableName: any, fieldName: string, value: string): Promise<string | null> {
  const safe = String(value).replace(/'/g, "\\'");
  const formula = `{${fieldName}}='${safe}'`;
  const recs = await base(tableName).select({ maxRecords: 1, filterByFormula: formula }).firstPage();
  return recs?.[0]?.id ?? null;
}

export async function getStaffRecordIdByStaffId(staffId: string) {
  return findRecordIdByField(TABLES.staff, "Staff ID", staffId);
}

export async function getSillonRecordIdBySillonId(sillonId: string) {
  return findRecordIdByField(TABLES.sillones, "Sillón ID", sillonId);
}


function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function toIso(x: unknown): string {
  if (typeof x === "string") return x;
  if (x instanceof Date) return x.toISOString();
  return "";
}


function normalizeChairIdFromSillonId(sillonId: string): number | undefined {
  // Convierte "CHR_01" -> 1, "CHR_02" -> 2
  // Si viene vacío o formato raro -> undefined
  const m = String(sillonId || "").match(/(\d+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Lista citas de un día (YYYY-MM-DD) usando tu tabla "Citas".
 * Usa lookups:
 *  - Paciente_nombre
 *  - Tratamiento_nombre
 *  - Sillon_id
 *  - Profesional_id
 *
 * Campos base:
 *  - Hora inicio
 *  - Hora final
 */
export async function listAppointmentsByDay(params: {
  dayIso: string;        // "2026-01-27"
  clinicId?: string;     // opcional "CLINIC_001"
  onlyActive?: boolean;  // opcional filtra por Estado
}): Promise<Appointment[]> {
  const { dayIso, clinicId, onlyActive = false } = params;

  // Traemos citas (MVP: sin fórmula compleja, filtramos en JS)
  const records = await base(TABLES.appointments)
    .select({ maxRecords: 1000 })
    .all();

  const out: Appointment[] = [];

  for (const r of records) {
    const f: any = r.fields;

    const start = toIso(f["Hora inicio"]);
    const end = toIso(f["Hora final"]);
    if (!start || !end) continue;
    if (!start.startsWith(dayIso)) continue;

    // (Opcional) filtra por clínica si lo pasas
    if (clinicId) {
      // "Clínica" es link (record ids). Si creaste también lookup Clínica ID, mejor.
      // Aquí hacemos un filtro simple si tienes lookup "Clínica ID" en Citas.
      const clinicIdLookup = firstString(f["Clínica ID"]);
      if (clinicIdLookup && clinicIdLookup !== clinicId) continue;
      // si no existe lookup, no filtramos (para no romper)
    }

    // (Opcional) filtra por estado
    if (onlyActive) {
      const estado = firstString(f["Estado"]).toUpperCase();
      // ajusta esta lista a tus valores reales si quieres
      const isCancelled = ["CANCELADA", "CANCELLED", "NO_SHOW"].includes(estado);
      if (isCancelled) continue;
    }

    const patientName = firstString(f["Paciente_nombre"]) || firstString(f["Nombre"]) || "Paciente";
    const type = firstString(f["Tratamiento_nombre"]) || "Tratamiento";

    const sillonId = firstString(f["Sillon_id"]);
    const chairId = normalizeChairIdFromSillonId(sillonId) ?? undefined;

    const providerId = firstString(f["Profesional_id"]) || undefined;

    out.push({
      id: r.id,                 // ✅ string (recordId Airtable)
      patientName,
      start,
      end,
      type,
      chairId,
      providerId,
    });
  }

  out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return out;
}

/**
 * Crea una cita nueva en Airtable.
 * OJO: para crear links (Paciente/Tratamiento/Profesional/Sillón) necesitas RECORD IDs,
 * no los textos. Para el MVP podemos crear una cita "simple" con Nombre + horas.
 */
export async function createAppointment(params: {
  name: string;
  startIso: string;
  endIso: string;
  clinicRecordId?: string;
  notes?: string;

  // ✅ NUEVO
  staffRecordId?: string;   // link "Profesional"
  sillonRecordId?: string;  // link "Sillón"
}): Promise<{ recordId: string }> {
  const { name, startIso, endIso, clinicRecordId, notes, staffRecordId, sillonRecordId } = params;

  const fields: any = {
    "Nombre": name,
    "Hora inicio": startIso,
    "Hora final": endIso,
  };

  if (notes) fields["Notas"] = notes;
  if (clinicRecordId) fields["Clínica"] = [clinicRecordId];

  // ✅ links para que la agenda lo detecte
  if (staffRecordId) fields["Profesional"] = [staffRecordId];
  if (sillonRecordId) fields["Sillón"] = [sillonRecordId];

  const created = await base(TABLES.appointments).create([{ fields }]);
  const rec = created?.[0];
  if (!rec?.id) throw new Error("Airtable: no se pudo crear la cita (sin id).");

  return { recordId: rec.id };
}
