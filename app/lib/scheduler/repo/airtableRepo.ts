// app/lib/scheduler/repo/airtableRepo.ts
import type { Appointment } from "../../types";
import { base, TABLES } from "../../airtable";
import { DateTime } from "luxon";

/**
 * Helpers simples para leer fields de Airtable sin rompernos.
 */

/**
 * Sprint 18 — emite el evento comportamental del ciclo de vida de una cita
 * fire-and-forget. NUNCA bloquea ni propaga errores al flujo principal.
 * Import dinámico (path relativo, sin alias) para no acoplar el repo a Supabase
 * en tiempo de carga y para que funcione tanto en Next como en tsx/scripts.
 */
function fireCitaEvento(
  lifecycle: "creada" | "confirmada" | "cancelada" | "asistio" | "no_show",
  appointmentRecordId: string,
): void {
  import("../../eventos/citas")
    .then((m) => m.emitirEventoCitaLifecycle(lifecycle, appointmentRecordId))
    .catch(() => {
      /* swallow */
    });
}

/**
 * Sprint 18 — re-evalúa el riesgo de no-show de una cita fire-and-forget
 * (al crear y al reagendar). Nunca bloquea ni propaga errores.
 */
function fireEvaluarRiesgo(appointmentRecordId: string): void {
  import("../../no-shows/predictor")
    .then((m) => m.evaluarRiesgoNoShow(appointmentRecordId))
    .catch(() => {
      /* swallow */
    });
}

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
  // FASE 1 migración: via repo del dominio Pacientes.
  const { findPacienteIdPorTelefono } = await import("../../pacientes/pacientes");
  return findPacienteIdPorTelefono(phoneE164);
}

export async function getPatientByPhone(
  phoneE164: string
): Promise<{ recordId: string; name: string } | null> {
  // FASE 1 migración: via repo del dominio Pacientes.
  const { getPacientePorTelefono } = await import("../../pacientes/pacientes");
  return getPacientePorTelefono(phoneE164);
}

/** Marks a patient as opted-out from WhatsApp messages (requires "Opt_Out" checkbox field in Pacientes table). */
export async function markPatientOptOut(phoneE164: string): Promise<void> {
  // FASE 1 migración: via repo del dominio Pacientes (campo Opt_Out del
  // scheduler; el follow-up del doble opt-out está anotado en el repo).
  const { marcarOptOutPorTelefono } = await import("../../pacientes/pacientes");
  await marcarOptOutPorTelefono(phoneE164);
}

/** Returns true if the patient has opted out of WhatsApp messages. */
export async function isPatientOptedOut(phoneE164: string): Promise<boolean> {
  // FASE 1 migración: via repo del dominio Pacientes.
  const { isOptOutPorTelefono } = await import("../../pacientes/pacientes");
  return isOptOutPorTelefono(phoneE164);
}

export async function createPatient(params: {
  name: string;
  phoneE164: string;
  clinicRecordId?: string;
}): Promise<{ recordId: string }> {
  // FASE 1 migración: alta via repo del dominio Pacientes (campos exactos
  // del MVP del scheduler).
  const { createPacienteBasico } = await import("../../pacientes/pacientes");
  return createPacienteBasico({
    nombre: params.name,
    telefono: params.phoneE164,
    clinicaId: params.clinicRecordId,
  });
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

export async function getPatientRecordIdByNameAndTutorPhone(params: {
  name: string;
  tutorPhoneE164: string;
  clinicRecordId?: string;
}): Promise<string | null> {
  // FASE 1 migración: búsqueda via repo del dominio Pacientes.
  const { findPacienteIdPorNombreYTutor } = await import("../../pacientes/pacientes");
  return findPacienteIdPorNombreYTutor({
    nombre: params.name,
    tutorTelefono: params.tutorPhoneE164,
    clinicaId: params.clinicRecordId,
  });
}

export async function createPatientWithoutPhone(params: {
  name: string;
  tutorPhoneE164: string;
  clinicRecordId?: string;
}): Promise<{ recordId: string }> {
  // FASE 1 migración: alta via repo del dominio Pacientes.
  const { createPacienteSinTelefono } = await import("../../pacientes/pacientes");
  return createPacienteSinTelefono({
    nombre: params.name,
    tutorTelefono: params.tutorPhoneE164,
    clinicaId: params.clinicRecordId,
  });
}

export async function upsertPatientWithoutPhone(params: {
  name: string;
  tutorPhoneE164: string;
  clinicRecordId?: string;
}): Promise<{ recordId: string; created: boolean }> {
  const { name, tutorPhoneE164, clinicRecordId } = params;

  const existing = await getPatientRecordIdByNameAndTutorPhone({
    name,
    tutorPhoneE164,
    clinicRecordId,
  });

  if (existing) return { recordId: existing, created: false };

  const created = await createPatientWithoutPhone({ name, tutorPhoneE164, clinicRecordId });
  return { recordId: created.recordId, created: true };
}



export async function getSillonRecordIdBySillonId(sillonId: string) {
  return findRecordIdByField(TABLES.sillones, "Sillón ID", sillonId);
}

export async function getAppointmentByRecordId(appointmentRecordId: string) {
  const r = await base(TABLES.appointments).find(appointmentRecordId);
  const f: any = r.fields;

  // LINKS (en Airtable vienen como array de recordIds)
  const patientRecordId = Array.isArray(f["Paciente"]) ? f["Paciente"][0] : undefined;
  const treatmentRecordId = Array.isArray(f["Tratamiento"]) ? f["Tratamiento"][0] : undefined;
  const staffRecordId = Array.isArray(f["Profesional"]) ? f["Profesional"][0] : undefined;
  const sillonRecordId = Array.isArray(f["Sillón"]) ? f["Sillón"][0] : undefined;

  // Lookups si los tienes (en tu screenshot sí hay *_nombre y *_id)
  const patientName = firstString(f["Paciente_nombre"]) || firstString(f["Nombre"]) || "";
  const treatmentName = firstString(f["Tratamiento_nombre"]) || "";
  const staffId = firstString(f["Profesional_id"]) || "";

  // duración
  const start = toLocalNaiveIso(f["Hora inicio"]);
  const end = toLocalNaiveIso(f["Hora final"]);
  const durMin =
    start && end
      ? Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))
      : undefined;

  return {
    recordId: r.id,
    patientRecordId,
    patientName,
    treatmentRecordId,
    treatmentName,
    staffRecordId,
    staffId,
    sillonRecordId,
    durationMin: durMin,
    start,
    end,
    fields: f,
  };
}


function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

const FIELD_PATIENT_PHONE = "Paciente_teléfono";
const FIELD_TUTOR_PHONE = "Paciente_tutor_teléfono";
// (y tu campo de inicio, por ejemplo)
const FIELD_START = "Hora inicio"; // ajusta si en tu base se llama distinto
const FIELD_STATUS = "Estado"; // si existe, opcional

function esc(s: string) {
  return String(s).replace(/'/g, "\\'");
}

export async function findNextAppointmentByContactPhone(params: {
  phoneE164: string;
  clinicId?: string;
}) {
  const { phoneE164 } = params;

  // Busca próximas citas asociadas al número (paciente o tutor)
  const formula = `OR({${FIELD_PATIENT_PHONE}}='${esc(phoneE164)}',{${FIELD_TUTOR_PHONE}}='${esc(phoneE164)}')`;

  const records = await base(TABLES.appointments)
    .select({
      maxRecords: 5,
      filterByFormula: formula,
      sort: [{ field: FIELD_START, direction: "asc" }],
    })
    .all();

  // aquí puedes filtrar por "futuras" si tienes el campo start como datetime real.
  // Si no, devuelve la primera.
  const r = records[0];
  if (!r) return null;

  return {
    recordId: r.id,
    fields: r.fields,
  };
}


export async function cancelAppointment(params: {
  appointmentRecordId: string;
  origin?: string;
}) {
  await base(TABLES.appointments).update([
    {
      id: params.appointmentRecordId,
      fields: {
        Estado: "Cancelado",
        ...(params.origin ? { Origen: params.origin } : {}),
      },
    },
  ]);
  fireCitaEvento("cancelada", params.appointmentRecordId);
}

export async function completeAppointment(params: {
  appointmentRecordId: string;
}) {
  await base(TABLES.appointments).update([
    {
      id: params.appointmentRecordId,
      fields: { Estado: "Completado" },
    },
  ]);
  fireCitaEvento("asistio", params.appointmentRecordId);
}

export async function markNoShow(params: {
  appointmentRecordId: string;
  existingNotes?: string;
}) {
  const notes = [params.existingNotes, "[NO_SHOW]"].filter(Boolean).join(" | ");
  await base(TABLES.appointments).update([
    {
      id: params.appointmentRecordId,
      fields: { Estado: "Cancelado", Notas: notes },
    },
  ]);
  fireCitaEvento("no_show", params.appointmentRecordId);
}

export async function confirmAppointment(params: {
  appointmentRecordId: string;
}) {
  await base(TABLES.appointments).update([
    {
      id: params.appointmentRecordId,
      fields: { Estado: "Confirmada" },
    },
  ]);
  fireCitaEvento("confirmada", params.appointmentRecordId);
}

export async function updateAppointment(params: {
  appointmentRecordId: string;
  startIso?: string;
  endIso?: string;
  staffRecordId?: string;
  treatmentRecordId?: string;
  notes?: string;
}) {
  const { appointmentRecordId, startIso, endIso, staffRecordId, treatmentRecordId, notes } = params;
  const fields: any = {};
  if (startIso) fields["Hora inicio"] = startIso;
  if (endIso) fields["Hora final"] = endIso;
  if (staffRecordId) fields["Profesional"] = [staffRecordId];
  if (treatmentRecordId) fields["Tratamiento"] = [treatmentRecordId];
  if (notes !== undefined) fields["Notas"] = notes;

  if (!Object.keys(fields).length) return;
  await base(TABLES.appointments).update([{ id: appointmentRecordId, fields }]);
  // Reagendar (cambio de fecha/hora) → re-evaluar riesgo de no-show.
  if (startIso) fireEvaluarRiesgo(appointmentRecordId);
}




function toLocalNaiveIso(x: unknown): string {
  // Airtable devuelve ISO en UTC con Z. Lo convertimos a UTC naive para ser
  // consistente con los slots generados por availability.ts (también naive UTC).
  if (typeof x !== "string" || !x) return "";

  const dt = DateTime.fromISO(x, { setZone: true }).toUTC();
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
  const estado = firstString(f["Estado"]).trim().toUpperCase();

  const isCancelled = [
    "CANCELADO",
    "CANCELADA",
    "CANCELLED",
    "CANCELED",
    "NO_SHOW",
    "NO SHOW",
    "NOSHOW",
  ].includes(estado);

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
      patientPhone: firstString(f["Paciente_teléfono"]) || firstString(f["Paciente_tutor_teléfono"]) || undefined,
    });
  }

  out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return out;
}

/**
 * Lists appointments in a full week (Mon→Sun) returning estado and origen for aggregation.
 * Makes a single Airtable fetch for efficiency.
 */
export async function listAppointmentsByWeek(params: {
  mondayIso: string; // "YYYY-MM-DD" (Monday)
  clinicId?: string;
}): Promise<Array<{ start: string; estado: string; origen: string; notas: string }>> {
  const { mondayIso, clinicId } = params;
  const monday = DateTime.fromISO(mondayIso, { zone: "utc" });
  const sunday = monday.plus({ days: 6 });
  const sundayIso = sunday.toISODate()!;

  const records = await base(TABLES.appointments)
    .select({ maxRecords: 2000 })
    .all();

  const out: Array<{ start: string; estado: string; origen: string; notas: string }> = [];

  for (const r of records) {
    const f: any = r.fields;
    const start = toLocalNaiveIso(f["Hora inicio"]);
    if (!start) continue;

    const dayIso = start.slice(0, 10);
    if (dayIso < mondayIso || dayIso > sundayIso) continue;

    if (clinicId) {
      const clinicIdLookup = firstString(f["Clínica ID"]);
      if (clinicIdLookup && clinicIdLookup !== clinicId) continue;
    }

    out.push({
      start,
      estado: firstString(f["Estado"]).trim().toUpperCase(),
      origen: firstString(f["Origen"]).trim(),
      notas: firstString(f["Notas"]),
    });
  }

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
const { name, startIso, endIso, clinicRecordId, notes, staffRecordId, sillonRecordId, treatmentRecordId, patientRecordId } = params;

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

  fireCitaEvento("creada", rec.id);
  fireEvaluarRiesgo(rec.id);
  return { recordId: rec.id };
}
