// app/lib/scheduler/repo/waitlistRepo.ts
import { base, TABLES } from "../../airtable";
import { usaPostgres } from "../../db/data-backend";

export type WaitlistEntry = {
  recordId: string;

  clinicRecordId?: string;
  patientRecordId?: string;
  treatmentRecordId?: string;
  preferredStaffRecordId?: string;

  diasPermitidos: string[]; // ["LUN","MIER","VIE"]
  rangoStart?: string; // Airtable ISO string
  rangoEnd?: string;

  estado?: string; // ACTIVE/OFFERED/...
  prioridad?: string; // Alta/Media/Baja
  urgencia?: string; // LOW/MED/HIGH
  permiteFueraRango?: boolean;

  offerHoldId?: string;
  offerExpiresAt?: string;
  offerCycle?: number;

  lastOfferedSlotKey?: string;
  lastOfferResult?: string;

  citaSeguraRecordId?: string;
  citaCerradaRecordId?: string;

  createdAt?: string;
};

const F = {
  clinic: "Clínica",
  patient: "Paciente",
  treatment: "Tratamiento",
  preferredStaff: "Profesional preferido",

  dias: "Dias_Permitidos",
  start: "Rango_Deseado_Start",
  end: "Rango_Deseado_End",

  estado: "Estado",
  prioridad: "Prioridad",
  urgencia: "Urgencia_Nivel",
  permiteFuera: "Permite_Fuera_Rango",

  offerHoldId: "Offer_Hold_Id",
  offerExpiresAt: "Offer_Expires_At",
  offerCycle: "Offer_Cycle",

  lastSlotKey: "Last_Offered_Slot_Key",
  lastResult: "Last_Offer_Result",

  citaSegura: "Cita_segura",
  citaCerrada: "Cita cerrada",

  createdAt: "Created_At",
  notas: "Notas",
};

function firstId(x: any): string | undefined {
  return Array.isArray(x) ? x[0] : undefined;
}
function str(x: any): string {
  return typeof x === "string" ? x : x ? String(x) : "";
}
function bool(x: any): boolean {
  return typeof x === "boolean" ? x : Boolean(x);
}
function num(x: any): number | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const s = str(x).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
function esc(s: string) {
  return String(s).replace(/'/g, "\\'");
}

/**
 * Lista waitlist ACTIVE por tratamiento (recordId Airtable).
 * (Opcional) filtra por clínica si la pasas.
 */
export async function listActiveWaitlistByTreatment(params: {
  treatmentRecordId: string;
  clinicRecordId?: string;
  maxRecords?: number;
}): Promise<WaitlistEntry[]> {
  const { treatmentRecordId, clinicRecordId, maxRecords = 200 } = params;
    return (await import("./waitlist-pg")).listActiveWaitlistByTreatmentPg({ treatmentRecordId, clinicRecordId, maxRecords });
  
}

export async function listWaitlist(params: {
  clinicRecordId?: string;
  preferredStaffRecordId?: string;
  estados?: string[]; // default ["ACTIVE","OFFERED"]
  maxRecords?: number;
}): Promise<WaitlistEntry[]> {
  const {
    clinicRecordId,
    preferredStaffRecordId,
    estados = ["ACTIVE", "OFFERED"],
    maxRecords = 200,
  } = params;
    return (await import("./waitlist-pg")).listWaitlistPg({ clinicRecordId, preferredStaffRecordId, estados, maxRecords });
  
}


export async function getOfferedEntryByPhone(params: {
  phoneE164: string;
}): Promise<WaitlistEntry | null> {
  // buscamos en Pacientes por Teléfono o Tutor teléfono, y luego la waitlist OFFERED linkeada a ese paciente.
  // Para MVP: hacemos 2 pasos.
  const phone = params.phoneE164;

  // FASE 1 migración: búsqueda del paciente via repo del dominio.
  const { findPacienteIdPorTelefonoOTutor } = await import("../../pacientes/pacientes");
  const patientId = await findPacienteIdPorTelefonoOTutor(phone);
  if (!patientId) return null;
    return (await import("./waitlist-pg")).getOfferedEntryByPatientIdPg(patientId);
  
}

export async function markWaitlistOffered(params: {
  waitlistRecordId: string;
  holdId: string;
  expiresAtIso: string; // Airtable ISO
  slotKey: string;
}) {
  return (await import("./waitlist-pg")).markWaitlistOfferedPg(params);
  
}

export async function markWaitlistActiveWithResult(params: {
  waitlistRecordId: string;
  result: "REJECTED" | "EXPIRED";
}) {
  return (await import("./waitlist-pg")).markWaitlistActiveWithResultPg(params);
  
}

export async function markWaitlistBooked(params: {
  waitlistRecordId: string;
  appointmentRecordId: string;
}) {
  return (await import("./waitlist-pg")).markWaitlistBookedPg(params);
  
}

/** Utilidad: obtener nombre/teléfono desde Paciente link (para mensajes) */
export async function getPatientContact(params: { patientRecordId: string }) {
  // FASE 1 migración: lectura via repo del dominio Pacientes.
  const { getPacienteContacto } = await import("../../pacientes/pacientes");
  return getPacienteContacto(params.patientRecordId);
}

/** Utilidad: leer tratamiento (duración/buffers/nombre) por recordId */
export async function getTreatmentMeta(params: { treatmentRecordId: string }) {
  const r = usaPostgres("agenda")
    ? (await (await import("./pg")).listTratamientosPorIdsRawPg([params.treatmentRecordId]))[0]
    : await base(TABLES.treatments).find(params.treatmentRecordId);
  const f: any = r?.fields || {};
  return {
    name: str(f["Categoria"]) || "Tratamiento",
    durationMin: typeof f["Duración"] === "number" ? f["Duración"] : Number(str(f["Duración"]) || 30),
    bufferBeforeMin: typeof f["Buffer antes"] === "number" ? f["Buffer antes"] : Number(str(f["Buffer antes"]) || 0),
    bufferAfterMin: typeof f["Buffer despues"] === "number" ? f["Buffer despues"] : Number(str(f["Buffer despues"]) || 0),
  };
}

export async function updateWaitlistEntry(params: {
  waitlistRecordId: string;
  patch: {
    estado?: string;
    ultimoContacto?: string;
  };
}) {
  const { waitlistRecordId, patch } = params;
    return (await import("./waitlist-pg")).updateWaitlistEntryPg(waitlistRecordId, patch);
  
}

export async function createWaitlistEntry(params: {
  clinicRecordId: string;
  patientRecordId: string;
  treatmentRecordId: string;
  preferredStaffRecordId?: string;

  diasPermitidos?: string[];        // default LUN..VIE
  rangoStartIso?: string;           // ISO
  rangoEndIso?: string;             // ISO
  prioridad?: "ALTA" | "MEDIA" | "BAJA";
  urgencia?: "LOW" | "MED" | "HIGH";
  permiteFueraRango?: boolean;
  notas?: string;
}) {
  return (await import("./waitlist-pg")).createWaitlistEntryPg(params);
  
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — acceso restante a la tabla Lista_de_espera.
// ─────────────────────────────────────────────────────────────────────

/** Cola de espera de una clínica (por NOMBRE de clínica, como el caller
 *  original), sin Aceptado/Expirado, orden Prioridad desc. Records crudos. */
export async function listWaitlistPorClinicaRaw(clinicSafe: string): Promise<readonly any[]> {
  return (await import("./waitlist-pg")).listWaitlistPorClinicaRawPg(clinicSafe);
  
}

/** Update simple de Estado (+ Último contacto opcional) de una entrada. */
export async function updateWaitlistEstado(
  id: string,
  estado: string,
  ultimoContacto?: string,
): Promise<{ id: string }> {
  return (await import("./waitlist-pg")).updateWaitlistEstadoPg(id, estado, ultimoContacto);
  
}

/** Alta con Estado/Prioridad/Urgencia explícitos y opcionales (formulario
 *  demo /api/db/waitlist) — a diferencia de createWaitlistEntry, aquí NO
 *  se aplican defaults: se escribe exactamente lo que llega. */
export async function createWaitlistEntradaFlexible(params: {
  clinicRecordId: string;
  patientRecordId: string;
  treatmentRecordId: string;
  preferredStaffRecordId?: string;
  diasPermitidos: string[];
  rangoStartIso?: string;
  rangoEndIso?: string;
  estado: string;
  prioridad?: string;
  urgencia?: string;
  permiteFueraRango: boolean;
  notas?: string;
}): Promise<{ id: string | undefined }> {
  return (await import("./waitlist-pg")).createWaitlistEntradaFlexiblePg(params);
  
}
