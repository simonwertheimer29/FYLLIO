// app/lib/pacientes/pacientes.ts
// Sprint 8 Bloque C — repositorio de Pacientes central.

export type PacienteTratamiento =
  | "Implantología"
  | "Ortodoncia"
  | "Ortodoncia Invisible"
  | "Periodoncia"
  | "Endodoncia"
  | "Blanqueamiento"
  | "Corona cerámica"
  | "Empaste"
  | "Limpieza"
  | "Revisión"
  | "Otro";

export type PacienteAceptado = "Si" | "No" | "Pendiente";

export type PacienteCanal =
  | "Facebook"
  | "Instagram"
  | "Google Ads"
  | "Google Orgánico"
  | "Landing Page"
  | "Visita directa"
  | "Referido"
  | "WhatsApp"
  | "Otro";

export type Paciente = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  tratamientos: PacienteTratamiento[];
  doctorLinkId: string | null;
  doctorNombre?: string;
  fechaCita: string | null;
  // MEJORAS 28 paso 2 (2026-07-27) — presupuestoTotal/aceptado/pagado/pendiente
  // salieron del tipo y del esquema: eran copias que había que sincronizar. La
  // verdad se deriva de presupuestos + pagos (lib/finanzas-paciente).
  financiado: number | null;
  notas: string | null;
  canalOrigen: PacienteCanal | null;
  clinicaId: string | null;
  clinicaNombre?: string;
  leadOrigenId: string | null;
  activo: boolean;
  optoutAutomatizaciones: boolean;
  createdAt: string;
};

function toPaciente(rec: any): Paciente {
  const f = rec.fields ?? {};
  const clinicaLinks = (f["Clínica"] ?? []) as string[];
  const doctorLinks = (f["Doctor_Link"] ?? []) as string[];
  const leadLinks = (f["Lead_Origen"] ?? []) as string[];
  return {
    id: rec.id,
    nombre: String(f["Nombre"] ?? ""),
    telefono: f["Teléfono"] ? String(f["Teléfono"]) : null,
    email: f["Email"] ? String(f["Email"]) : null,
    tratamientos: (f["Tratamientos"] ?? []) as PacienteTratamiento[],
    doctorLinkId: doctorLinks[0] ?? null,
    fechaCita: f["Fecha_Cita"] ? String(f["Fecha_Cita"]) : null,
    financiado: typeof f["Financiado"] === "number" ? f["Financiado"] : null,
    notas: f["Notas"] ? String(f["Notas"]) : null,
    canalOrigen: f["Canal_Origen"] ? (String(f["Canal_Origen"]) as PacienteCanal) : null,
    clinicaId: clinicaLinks[0] ?? null,
    leadOrigenId: leadLinks[0] ?? null,
    activo: Boolean(f["Activo"] ?? true),
    optoutAutomatizaciones: Boolean(f["Optout_Automatizaciones"] ?? false),
    createdAt: String(
      f["CreatedAt"] ?? rec._rawJson?.createdTime ?? rec.createdTime ?? "",
    ),
  };
}

// MEJORAS nº 28 — el filtro `aceptado` (flag caché del paciente) se retiró:
// "aceptado" se deriva de los presupuestos reales (finanzas-paciente).
export type ListPacientesParams = {
  clinicaIds?: string[];
  search?: string;
  fechaDesde?: string;
  fechaHasta?: string;
};

export async function listPacientes(params: ListPacientesParams = {}): Promise<Paciente[]> {
  const pg = await import("./pg");
  return pg.listPacientesPg(params);
  
}

export async function getPaciente(id: string): Promise<Paciente | null> {
  const pg = await import("./pg");
  return pg.getPacientePg(id);
  
}

export async function createPaciente(input: {
  nombre: string;
  telefono?: string;
  email?: string;
  clinicaId: string;
  tratamientos?: PacienteTratamiento[];
  doctorLinkId?: string;
  fechaCita?: string;
  financiado?: number;
  notas?: string;
  canalOrigen?: PacienteCanal;
  leadOrigenId?: string;
}): Promise<Paciente> {
  const pg = await import("./pg");
  return pg.createPacientePg(input);
  
}

export async function updatePaciente(
  id: string,
  patch: Partial<{
    nombre: string;
    telefono: string | null;
    email: string | null;
    tratamientos: PacienteTratamiento[];
    doctorLinkId: string | null;
    fechaCita: string | null;
    presupuestoTotal: number | null;
    aceptado: PacienteAceptado | null;
    pagado: number | null;
    financiado: number | null;
    notas: string | null;
    canalOrigen: PacienteCanal | null;
    activo: boolean;
    optoutAutomatizaciones: boolean;
  }>
): Promise<Paciente> {
  const pg = await import("./pg");
  return pg.updatePacientePg(id, patch as Record<string, unknown>);
  
}

export async function deletePaciente(id: string): Promise<void> {
  const pg = await import("./pg");
  return pg.deletePacientePg(id);
  
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — métodos añadidos para que TODO acceso a la tabla
// Pacientes pase por este repo (paridad estricta con los call-sites que
// sustituyen). En FASE 2 cambian su interior a Postgres sin tocar callers.
// ─────────────────────────────────────────────────────────────────────

function firstStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

/** Añade una línea al campo Notas (read-modify-write). El caller compone la
 *  línea (con su timestamp/prefijo); esto solo la anexa. Lanza si falla. */
export async function appendNotaPaciente(pacienteId: string, linea: string): Promise<void> {
  const pg = await import("./pg");
  return pg.appendNotaPacientePg(pacienteId, linea);
  
}

/**
 * Alta de paciente desde la conversión de un lead. Preserva exactamente los
 * campos que escribía la ruta convertir (Sprint 8).
 * FOLLOW-UP detectado (no tocar en migración): a diferencia de
 * createPaciente, NO escribe CreatedAt (el sort nativo por CreatedAt deja a
 * los convertidos al final) ni el link Lead_Origen (el enlace queda solo en
 * el lado del Lead via Paciente_ID).
 */
export async function createPacienteDesdeConversion(input: {
  nombre: string;
  telefono?: string | null;
  clinicaId: string;
  notas: string;
}): Promise<{ id: string; nombre: string }> {
  const pg = await import("./pg");
  return pg.createPacienteDesdeConversionPg(input);
  
}

/** Upsert del import Gesden: matchea por Teléfono; update si existe, create
 *  si no. `fields` llega ya mapeado a nombres de columna del import.
 *  Cualquier error → "skipped" (mismo criterio del import por filas). */
export async function upsertPacienteImportPorTelefono(
  fields: Record<string, string>,
): Promise<"created" | "updated" | "skipped"> {
  const pg = await import("./pg");
  return pg.upsertPacienteImportPorTelefonoPg(fields);
  
}

/** Muestra compacta para el buscador por nombre/teléfono (no-shows agenda).
 *  Carga hasta `maxRecords` con 3 campos; el caller filtra en memoria. */
export async function listPacientesBusquedaRapida(
  maxRecords = 300,
): Promise<Array<{ id: string; nombre: string; telefono: string; clinica: string }>> {
  const pg = await import("./pg");
  return pg.listPacientesBusquedaRapidaPg(maxRecords);
  
}

/** Resumen financiero por lote de IDs (cruce de pagos por clínica/origen).
 *  `tieneLeadOrigen` preserva el criterio exacto del caller original
 *  (campo presente y distinto de ""). */
export async function listResumenFinancieroPorIds(
  ids: string[],
): Promise<Array<{ id: string; clinicaIds: string[]; tieneLeadOrigen: boolean; pendiente: number }>> {
  const pg = await import("./pg");
  return pg.listResumenFinancieroPorIdsPg(ids);
  
}

/** Suma de pendiente para una lista de pacientes — DERIVADO de presupuestos
 *  ACEPTADO − pagos reales (MEJORAS nº 28; antes leía la columna caché
 *  Pendiente). Error → 0 (mismo criterio original). */
export async function sumPendientePorIds(pacIds: string[]): Promise<number> {
  const pg = await import("./pg");
  return pg.sumPendientePorIdsPg(pacIds);
  
}

/** Reescribe el cache financiero del paciente: Pagado = total real y
 *  Pendiente = max(0, Presupuesto_Total − total). Lanza si falla. */

/** ID del paciente cuyo Teléfono o Tutor teléfono coincide (waitlist). */
export async function findPacienteIdPorTelefonoOTutor(phone: string): Promise<string | null> {
  const pg = await import("./pg");
  return pg.findPacienteIdPorTelefonoOTutorPg(phone);
}

/** Contacto para mensajería del scheduler (nombre + teléfonos). Lanza si
 *  el record no existe (mismo criterio del caller original). */
export async function getPacienteContacto(
  patientRecordId: string,
): Promise<{ name: string; phone: string; tutorPhone: string }> {
  const pg = await import("./pg");
  return pg.getPacienteContactoPg(patientRecordId);
}

/** ID por Teléfono exacto (scheduler / Twilio). */
export async function findPacienteIdPorTelefono(phoneE164: string): Promise<string | null> {
  const pg = await import("./pg");
  return pg.findPacienteIdPorTelefonoPg(phoneE164);
}

/** {recordId, name} por Teléfono exacto, o null (scheduler). */
export async function getPacientePorTelefono(
  phoneE164: string,
): Promise<{ recordId: string; name: string } | null> {
  const pg = await import("./pg");
  return pg.getPacientePorTelefonoPg(phoneE164);
}

/**
 * Marca Opt_Out=true por teléfono (STOP de Twilio, scheduler legacy).
 * FOLLOW-UP detectado (no tocar en migración): el campo `Opt_Out` es
 * DISTINTO de `Optout_Automatizaciones` (motor de reglas) — dos flags de
 * opt-out paralelos que ninguna pieza unifica.
 */
export async function marcarOptOutPorTelefono(phoneE164: string): Promise<void> {
  const pg = await import("./pg");
  return pg.marcarOptOutPorTelefonoPg(phoneE164);
}

/** Campos del paciente que consume el predictor de no-shows. Lanza si el
 *  record no existe (el predictor trata el fallo como "sin datos"). */
export async function getPacienteFactoresRiesgo(pacienteId: string): Promise<{
  canalOrigen: string | null;
  edad: number | null;
  fechaNacimiento: string | null;
}> {
  const pg = await import("./pg");
  return pg.getPacienteFactoresRiesgoPg(pacienteId);
}

/** Map id → {nombre, telefono} por lote (expansión de linked records en la
 *  superficie demo /api/db). Chunk de 40 por límite de fórmula. */
export async function mapNombreTelefonoPorIds(
  ids: string[],
): Promise<Map<string, { nombre: string; telefono: string }>> {
  const pg = await import("./pg");
  return pg.mapNombreTelefonoPorIdsPg(ids);
}

/** true si el paciente con ese Teléfono tiene Opt_Out marcado (scheduler). */
export async function isOptOutPorTelefono(phoneE164: string): Promise<boolean> {
  const pg = await import("./pg");
  return pg.isOptOutPorTelefonoPg(phoneE164);
}

/** Alta mínima del scheduler: Nombre + Teléfono (+ Clínica). Preserva los
 *  campos exactos del MVP del scheduler (sin canal/consentimiento). */
export async function createPacienteBasico(params: {
  nombre: string;
  telefono: string;
  clinicaId?: string;
}): Promise<{ recordId: string }> {
  const pg = await import("./pg");
  return pg.createPacienteBasicoPg(params);
}

/** Alta sin teléfono propio (menores): Nombre + Tutor teléfono (+ Clínica). */
export async function createPacienteSinTelefono(params: {
  nombre: string;
  tutorTelefono: string;
  clinicaId?: string;
}): Promise<{ recordId: string }> {
  const pg = await import("./pg");
  return pg.createPacienteSinTelefonoPg(params);
}

/** ID por Nombre + Tutor teléfono exactos (+ Clínica opcional, por link). */
export async function findPacienteIdPorNombreYTutor(params: {
  nombre: string;
  tutorTelefono: string;
  clinicaId?: string;
}): Promise<string | null> {
  const pg = await import("./pg");
  return pg.findPacienteIdPorNombreYTutorPg(params);
}

/** SOLO DEV — muestra de fields crudos para introspección de esquema
 *  (/api/no-shows/dev/campos). No usar en superficie de producción. */
export async function samplePacientesFieldsDev(n: number): Promise<any[]> {
  const pg = await import("./pg");
  return pg.samplePacientesFieldsDevPg(n);
}

/** SOLO DEV — record ids de pacientes (seeder no-shows; fields:[] = solo ids). */
export async function listPacientesIdsDev(maxRecords: number): Promise<string[]> {
  const pg = await import("./pg");
  return pg.listPacientesIdsDevPg(maxRecords);
}
