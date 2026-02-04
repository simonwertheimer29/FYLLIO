// app/lib/scheduler/repo/airtableRepo.ts
import type { Appointment } from "../../types";
import { base, TABLES } from "../../airtable";
import { DateTime } from "luxon";

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

export async function getPatientRecordIdByPhone(phoneE164: string) {
  // ✅ según tu captura el campo se llama "Teléfono"
  return findRecordIdByField(TABLES.patients, "Teléfono", phoneE164);
}

export async function createPatient(params: {
  name: string;
  phoneE164: string;
  clinicRecordId?: string;
}): Promise<{ recordId: string }> {
  const { name, phoneE164, clinicRecordId } = params;

  // ✅ nombres de campos según tu captura
  const fields: any = {
    "Nombre": name,
    "Teléfono": phoneE164,
  };

  // "Clínica" existe en tu tabla Pacientes (link)
  if (clinicRecordId) fields["Clínica"] = [clinicRecordId];

  // opcional pero recomendado (si quieres que quede bien desde el MVP):
  // si "Canal preferido" es single select, puedes setearlo:
  // fields["Canal preferido"] = "WhatsApp";
  // si "Consentimiento Whatsapp" es checkbox:
  // fields["Consentimiento Whatsapp"] = true;

  const created = await base(TABLES.patients).create([{ fields }]);
  const rec = created?.[0];
  if (!rec?.id) throw new Error("Airtable: no se pudo crear paciente (sin id).");

  return { recordId: rec.id };
}

export async function upsertPatientByPhone(params: {
  name: string;
  phoneE164: string;
  clinicRecordId?: string;
}): Promise<{ recordId: string; created: boolean }> {
  const { name, phoneE164, clinicRecordId } = params;

  const existing = await getPatientRecordIdByPhone(phoneE164);
  if (existing) return { recordId: existing, created: false };

  const created = await createPatient({ name, phoneE164, clinicRecordId });
  return { recordId: created.recordId, created: true };
}


export async function getSillonRecordIdBySillonId(sillonId: string) {
  return findRecordIdByField(TABLES.sillones, "Sillón ID", sillonId);
}


function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}


const ZONE = "Europe/Madrid";



function toLocalNaiveIso(x: unknown): string {
  // Airtable suele devolver ISO en UTC con Z. Lo convertimos a hora local Madrid
  if (typeof x !== "string" || !x) return "";

  const dt = DateTime.fromISO(x, { setZone: true }).setZone(ZONE);
  if (!dt.isValid) return "";

  // devolvemos sin offset y sin ms: "YYYY-MM-DDTHH:mm:ss"
  return dt.toFormat("yyyy-MM-dd'T'HH:mm:ss");
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

    const start = toLocalNaiveIso(f["Hora inicio"]);
const end = toLocalNaiveIso(f["Hora final"]);

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

  staffRecordId?: string;   // link "Profesional"
  sillonRecordId?: string;  // link "Sillón"

  // ✅ NUEVO
  treatmentRecordId?: string; // link "Tratamiento"
  patientRecordId?: string; // link "Paciente"

}): Promise<{ recordId: string }> {
  const { name, startIso, endIso, clinicRecordId, notes, staffRecordId, sillonRecordId, treatmentRecordId,patientRecordId, } = params;

  const fields: any = {
    "Nombre": name,
    "Hora inicio": startIso,
    "Hora final": endIso,
  };

  if (notes) fields["Notas"] = notes;
  if (clinicRecordId) fields["Clínica"] = [clinicRecordId];

  if (staffRecordId) fields["Profesional"] = [staffRecordId];
  if (sillonRecordId) fields["Sillón"] = [sillonRecordId];

  // ✅ esto arregla tu problema
  if (treatmentRecordId) fields["Tratamiento"] = [treatmentRecordId];
  if (patientRecordId) fields["Paciente"] = [patientRecordId];


  const created = await base(TABLES.appointments).create([{ fields }]);
  const rec = created?.[0];
  if (!rec?.id) throw new Error("Airtable: no se pudo crear la cita (sin id).");

  return { recordId: rec.id };
}
