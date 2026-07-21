// app/lib/pacientes/pacientes.ts
// Sprint 8 Bloque C — repositorio de Pacientes central.

import { base, TABLES, fetchAll } from "../airtable";
import { usaPostgres } from "../db/data-backend";

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
  presupuestoTotal: number | null;
  aceptado: PacienteAceptado | null;
  pagado: number | null;
  pendiente: number | null;
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
    presupuestoTotal: typeof f["Presupuesto_Total"] === "number" ? f["Presupuesto_Total"] : null,
    aceptado: f["Aceptado"] ? (String(f["Aceptado"]) as PacienteAceptado) : null,
    pagado: typeof f["Pagado"] === "number" ? f["Pagado"] : null,
    pendiente: typeof f["Pendiente"] === "number" ? f["Pendiente"] : null,
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

export type ListPacientesParams = {
  clinicaIds?: string[];
  search?: string;
  aceptado?: PacienteAceptado;
  fechaDesde?: string;
  fechaHasta?: string;
};

export async function listPacientes(params: ListPacientesParams = {}): Promise<Paciente[]> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.listPacientesPg(params);
  }
  // Sprint 15 Bloque 9 — sort nativo Airtable por CreatedAt (formula
  // CREATED_TIME() añadida por sprint15-bloque9-schema.ts). Si la
  // base aún no tiene el campo añadido (404 / UNKNOWN_FIELD_NAME),
  // caemos a JS sort sobre rec._rawJson.createdTime para no romper.
  let recs: any[];
  try {
    recs = await fetchAll(
      base(TABLES.patients).select({
        sort: [{ field: "CreatedAt", direction: "desc" }],
      }),
    );
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/UNKNOWN_FIELD_NAME|CreatedAt/i.test(msg)) {
      recs = await fetchAll(base(TABLES.patients).select({}));
      recs.sort((a: any, b: any) => {
        const ta = String(a._rawJson?.createdTime ?? a.createdTime ?? "");
        const tb = String(b._rawJson?.createdTime ?? b.createdTime ?? "");
        return tb.localeCompare(ta);
      });
    } else {
      throw err;
    }
  }
  let pacientes = recs.map(toPaciente);

  if (params.clinicaIds && params.clinicaIds.length > 0) {
    const set = new Set(params.clinicaIds);
    pacientes = pacientes.filter((p) => p.clinicaId && set.has(p.clinicaId));
  }
  if (params.aceptado) {
    pacientes = pacientes.filter((p) => p.aceptado === params.aceptado);
  }
  if (params.search) {
    const q = params.search.toLowerCase().trim();
    if (q) {
      pacientes = pacientes.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          (p.telefono ?? "").toLowerCase().includes(q) ||
          (p.email ?? "").toLowerCase().includes(q)
      );
    }
  }
  if (params.fechaDesde) {
    pacientes = pacientes.filter((p) => p.createdAt >= params.fechaDesde!);
  }
  if (params.fechaHasta) {
    pacientes = pacientes.filter((p) => p.createdAt <= params.fechaHasta!);
  }
  return pacientes;
}

export async function getPaciente(id: string): Promise<Paciente | null> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.getPacientePg(id);
  }
  try {
    const rec = await base(TABLES.patients).find(id);
    return toPaciente(rec);
  } catch {
    return null;
  }
}

export async function createPaciente(input: {
  nombre: string;
  telefono?: string;
  email?: string;
  clinicaId: string;
  tratamientos?: PacienteTratamiento[];
  doctorLinkId?: string;
  fechaCita?: string;
  presupuestoTotal?: number;
  aceptado?: PacienteAceptado;
  pagado?: number;
  financiado?: number;
  notas?: string;
  canalOrigen?: PacienteCanal;
  leadOrigenId?: string;
}): Promise<Paciente> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.createPacientePg(input);
  }
  const fields: Record<string, any> = {
    Nombre: input.nombre,
    Clínica: [input.clinicaId],
    Activo: true,
    "Canal preferido": "Whatsapp",
    "Consentimiento Whatsapp": true,
    // Sprint 15 Bloque 9 — escribimos CreatedAt para que el sort
    // nativo Airtable funcione en nuevos pacientes (Airtable no permite
    // formula/createdTime via API; usamos un dateTime editable).
    CreatedAt: new Date().toISOString(),
  };
  if (input.telefono) fields["Teléfono"] = input.telefono;
  if (input.email) fields["Email"] = input.email;
  if (input.tratamientos?.length) fields["Tratamientos"] = input.tratamientos;
  if (input.doctorLinkId) fields["Doctor_Link"] = [input.doctorLinkId];
  if (input.fechaCita) fields["Fecha_Cita"] = input.fechaCita;
  if (typeof input.presupuestoTotal === "number")
    fields["Presupuesto_Total"] = input.presupuestoTotal;
  if (input.aceptado) fields["Aceptado"] = input.aceptado;
  if (typeof input.pagado === "number") {
    fields["Pagado"] = input.pagado;
    if (typeof input.presupuestoTotal === "number") {
      fields["Pendiente"] = Math.max(0, input.presupuestoTotal - input.pagado);
    }
  }
  if (typeof input.financiado === "number") fields["Financiado"] = input.financiado;
  if (input.notas) fields["Notas"] = input.notas;
  if (input.canalOrigen) fields["Canal_Origen"] = input.canalOrigen;
  if (input.leadOrigenId) fields["Lead_Origen"] = [input.leadOrigenId];

  const created = (await base(TABLES.patients).create([{ fields }]))[0]!;
  return toPaciente(created);
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
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.updatePacientePg(id, patch as Record<string, unknown>);
  }
  const fields: Record<string, any> = {};
  if (patch.nombre !== undefined) fields["Nombre"] = patch.nombre;
  if (patch.telefono !== undefined) fields["Teléfono"] = patch.telefono ?? "";
  if (patch.email !== undefined) fields["Email"] = patch.email ?? "";
  if (patch.tratamientos !== undefined) fields["Tratamientos"] = patch.tratamientos;
  if (patch.doctorLinkId !== undefined)
    fields["Doctor_Link"] = patch.doctorLinkId ? [patch.doctorLinkId] : [];
  if (patch.fechaCita !== undefined) fields["Fecha_Cita"] = patch.fechaCita ?? "";
  if (patch.presupuestoTotal !== undefined)
    fields["Presupuesto_Total"] = patch.presupuestoTotal ?? null;
  if (patch.aceptado !== undefined) fields["Aceptado"] = patch.aceptado ?? null;
  if (patch.pagado !== undefined) fields["Pagado"] = patch.pagado ?? null;
  if (patch.financiado !== undefined) fields["Financiado"] = patch.financiado ?? null;
  if (patch.notas !== undefined) fields["Notas"] = patch.notas ?? "";
  if (patch.canalOrigen !== undefined) fields["Canal_Origen"] = patch.canalOrigen ?? null;
  if (patch.activo !== undefined) fields["Activo"] = patch.activo;
  // Sprint 16b Bloque 5 — flag opt-out de automatizaciones.
  if (patch.optoutAutomatizaciones !== undefined)
    fields["Optout_Automatizaciones"] = patch.optoutAutomatizaciones;

  // Recalcular Pendiente si cambia Presupuesto o Pagado.
  if (patch.presupuestoTotal !== undefined || patch.pagado !== undefined) {
    const current = await getPaciente(id);
    const total = patch.presupuestoTotal ?? current?.presupuestoTotal ?? null;
    const pagado = patch.pagado ?? current?.pagado ?? null;
    if (typeof total === "number" && typeof pagado === "number") {
      fields["Pendiente"] = Math.max(0, total - pagado);
    }
  }

  const updated = (await base(TABLES.patients).update([{ id, fields }]))[0]!;
  return toPaciente(updated);
}

export async function deletePaciente(id: string): Promise<void> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.deletePacientePg(id);
  }
  await base(TABLES.patients).destroy([id]);
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
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.appendNotaPacientePg(pacienteId, linea);
  }
  const rec = await base(TABLES.patients as any).find(pacienteId);
  const prev = String(((rec.fields as any) ?? {})["Notas"] ?? "");
  await base(TABLES.patients as any).update(pacienteId, {
    Notas: prev ? `${prev}\n${linea}` : linea,
  } as any);
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
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.createPacienteDesdeConversionPg(input);
  }
  const created = (
    await base(TABLES.patients).create([
      {
        fields: {
          Nombre: input.nombre,
          ...(input.telefono && { Teléfono: input.telefono }),
          Clínica: [input.clinicaId],
          "Canal preferido": "Whatsapp",
          "Consentimiento Whatsapp": true,
          Activo: true,
          Notas: input.notas,
        },
      },
    ])
  )[0]!;
  return {
    id: created.id,
    nombre: String(created.fields?.["Nombre"] ?? input.nombre),
  };
}

/** Upsert del import Gesden: matchea por Teléfono; update si existe, create
 *  si no. `fields` llega ya mapeado a nombres de columna del import.
 *  Cualquier error → "skipped" (mismo criterio del import por filas). */
export async function upsertPacienteImportPorTelefono(
  fields: Record<string, string>,
): Promise<"created" | "updated" | "skipped"> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.upsertPacienteImportPorTelefonoPg(fields);
  }
  const phone = fields["Teléfono"];
  if (!phone) return "skipped";
  try {
    const existing = await base(TABLES.patients as any)
      .select({
        filterByFormula: `{Teléfono}='${phone.replace(/'/g, "\\'")}'`,
        maxRecords: 1,
        fields: ["Nombre", "Teléfono"],
      })
      .firstPage();
    if (existing.length > 0) {
      await base(TABLES.patients as any).update(existing[0]!.id, fields);
      return "updated";
    }
    await base(TABLES.patients as any).create(fields);
    return "created";
  } catch {
    return "skipped";
  }
}

/** Muestra compacta para el buscador por nombre/teléfono (no-shows agenda).
 *  Carga hasta `maxRecords` con 3 campos; el caller filtra en memoria. */
export async function listPacientesBusquedaRapida(
  maxRecords = 300,
): Promise<Array<{ id: string; nombre: string; telefono: string; clinica: string }>> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.listPacientesBusquedaRapidaPg(maxRecords);
  }
  const recs = await base(TABLES.patients as any)
    .select({ maxRecords, fields: ["Nombre", "Teléfono", "Clínica"] })
    .all();
  return (recs as any[]).map((r) => ({
    id: r.id,
    nombre: firstStr(r.fields["Nombre"]),
    telefono: firstStr(r.fields["Teléfono"]),
    clinica: firstStr(r.fields["Clínica"]),
  }));
}

/** Resumen financiero por lote de IDs (cruce de pagos por clínica/origen).
 *  `tieneLeadOrigen` preserva el criterio exacto del caller original
 *  (campo presente y distinto de ""). */
export async function listResumenFinancieroPorIds(
  ids: string[],
): Promise<Array<{ id: string; clinicaIds: string[]; tieneLeadOrigen: boolean; pendiente: number }>> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.listResumenFinancieroPorIdsPg(ids);
  }
  if (ids.length === 0) return [];
  const formula = `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
  const recs = await fetchAll(
    base(TABLES.patients as any).select({
      filterByFormula: formula,
      fields: ["Clínica", "Lead_Origen", "Pendiente"],
    }),
  );
  return recs.map((r) => {
    const f = r.fields as any;
    const origenLead = f["Lead_Origen"];
    return {
      id: r.id,
      clinicaIds: (f["Clínica"] ?? []) as string[],
      tieneLeadOrigen: origenLead != null && origenLead !== "",
      pendiente: Number(f["Pendiente"] ?? 0) || 0,
    };
  });
}

const BATCH_PENDIENTE = 50;

/** Suma de Pendiente para una lista de pacientes, con batching (límite de
 *  longitud de fórmula). Error de un batch → 0 (mismo criterio original). */
export async function sumPendientePorIds(pacIds: string[]): Promise<number> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.sumPendientePorIdsPg(pacIds);
  }
  if (pacIds.length === 0) return 0;
  if (pacIds.length > BATCH_PENDIENTE) {
    let total = 0;
    for (let i = 0; i < pacIds.length; i += BATCH_PENDIENTE) {
      total += await sumPendientePorIds(pacIds.slice(i, i + BATCH_PENDIENTE));
    }
    return total;
  }
  const formula = `OR(${pacIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
  try {
    const recs = await fetchAll(
      base(TABLES.patients as any).select({
        filterByFormula: formula,
        fields: ["Pendiente"],
      }),
    );
    return recs.reduce(
      (s, r) => s + (Number((r.fields as any)?.["Pendiente"] ?? 0) || 0),
      0,
    );
  } catch {
    return 0;
  }
}

/** Reescribe el cache financiero del paciente: Pagado = total real y
 *  Pendiente = max(0, Presupuesto_Total − total). Lanza si falla. */
export async function syncFinancieroPaciente(
  pacienteId: string,
  totalPagado: number,
): Promise<void> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.syncFinancieroPacientePg(pacienteId, totalPagado);
  }
  const pacRec = await base(TABLES.patients as any).find(pacienteId);
  const f = pacRec.fields as any;
  const presupuesto = Number(f["Presupuesto_Total"] ?? 0) || 0;
  await base(TABLES.patients as any).update(pacienteId, {
    Pagado: totalPagado,
    Pendiente: Math.max(0, presupuesto - totalPagado),
  } as any);
}

/** ID del paciente cuyo Teléfono o Tutor teléfono coincide (waitlist). */
export async function findPacienteIdPorTelefonoOTutor(phone: string): Promise<string | null> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.findPacienteIdPorTelefonoOTutorPg(phone);
  }
  const esc = String(phone).replace(/'/g, "\\'");
  const recs = await base(TABLES.patients)
    .select({
      filterByFormula: `OR({Teléfono}='${esc}',{Tutor teléfono}='${esc}')`,
      maxRecords: 1,
    })
    .firstPage();
  return recs?.[0]?.id ?? null;
}

/** Contacto para mensajería del scheduler (nombre + teléfonos). Lanza si
 *  el record no existe (mismo criterio del caller original). */
export async function getPacienteContacto(
  patientRecordId: string,
): Promise<{ name: string; phone: string; tutorPhone: string }> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.getPacienteContactoPg(patientRecordId);
  }
  const r = await base(TABLES.patients).find(patientRecordId);
  const f: any = r.fields || {};
  return {
    name: firstStr(f["Nombre"]) || "Paciente",
    phone: firstStr(f["Teléfono"]) || "",
    tutorPhone: firstStr(f["Tutor teléfono"]) || "",
  };
}

/** ID por Teléfono exacto (scheduler / Twilio). */
export async function findPacienteIdPorTelefono(phoneE164: string): Promise<string | null> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.findPacienteIdPorTelefonoPg(phoneE164);
  }
  const safe = String(phoneE164).replace(/'/g, "\\'");
  const recs = await base(TABLES.patients)
    .select({ maxRecords: 1, filterByFormula: `{Teléfono}='${safe}'` })
    .firstPage();
  return recs?.[0]?.id ?? null;
}

/** {recordId, name} por Teléfono exacto, o null (scheduler). */
export async function getPacientePorTelefono(
  phoneE164: string,
): Promise<{ recordId: string; name: string } | null> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.getPacientePorTelefonoPg(phoneE164);
  }
  const recs = await base(TABLES.patients)
    .select({ filterByFormula: `{Teléfono}='${phoneE164}'`, fields: ["Nombre"], maxRecords: 1 })
    .all();
  if (!recs.length) return null;
  const r = recs[0] as any;
  return { recordId: r.id, name: String(r.fields?.["Nombre"] ?? "") };
}

/**
 * Marca Opt_Out=true por teléfono (STOP de Twilio, scheduler legacy).
 * FOLLOW-UP detectado (no tocar en migración): el campo `Opt_Out` es
 * DISTINTO de `Optout_Automatizaciones` (motor de reglas) — dos flags de
 * opt-out paralelos que ninguna pieza unifica.
 */
export async function marcarOptOutPorTelefono(phoneE164: string): Promise<void> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.marcarOptOutPorTelefonoPg(phoneE164);
  }
  const recs = await base(TABLES.patients)
    .select({ filterByFormula: `{Teléfono}='${phoneE164}'`, fields: ["Nombre"], maxRecords: 1 })
    .all();
  if (!recs.length) return;
  await base(TABLES.patients).update([{ id: recs[0]!.id, fields: { Opt_Out: true } as any }]);
}

/** Campos del paciente que consume el predictor de no-shows. Lanza si el
 *  record no existe (el predictor trata el fallo como "sin datos"). */
export async function getPacienteFactoresRiesgo(pacienteId: string): Promise<{
  canalOrigen: string | null;
  edad: number | null;
  fechaNacimiento: string | null;
}> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.getPacienteFactoresRiesgoPg(pacienteId);
  }
  const pac = await base(TABLES.patients).find(pacienteId);
  const pf: Record<string, unknown> = pac.fields ?? {};
  const edadRaw = pf["Edad"];
  const fnac = pf["Fecha_Nacimiento"] ?? pf["Fecha de nacimiento"];
  return {
    canalOrigen: firstStr(pf["Canal_Origen"]) || null,
    edad: typeof edadRaw === "number" && Number.isFinite(edadRaw) ? edadRaw : null,
    fechaNacimiento: fnac ? String(fnac) : null,
  };
}

/** Map id → {nombre, telefono} por lote (expansión de linked records en la
 *  superficie demo /api/db). Chunk de 40 por límite de fórmula. */
export async function mapNombreTelefonoPorIds(
  ids: string[],
): Promise<Map<string, { nombre: string; telefono: string }>> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.mapNombreTelefonoPorIdsPg(ids);
  }
  const map = new Map<string, { nombre: string; telefono: string }>();
  if (!ids.length) return map;
  const uniq = Array.from(new Set(ids));
  const chunkSize = 40;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const formula =
      chunk.length === 1
        ? `RECORD_ID()='${chunk[0]}'`
        : `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const recs = await base(TABLES.patients as any)
      .select({ filterByFormula: formula, fields: ["Nombre", "Teléfono"] })
      .all();
    for (const r of recs as any[]) {
      map.set(r.id, {
        nombre: firstStr(r.fields?.["Nombre"]),
        telefono: firstStr(r.fields?.["Teléfono"]),
      });
    }
  }
  return map;
}

/** true si el paciente con ese Teléfono tiene Opt_Out marcado (scheduler). */
export async function isOptOutPorTelefono(phoneE164: string): Promise<boolean> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.isOptOutPorTelefonoPg(phoneE164);
  }
  const recs = await base(TABLES.patients)
    .select({
      filterByFormula: `AND({Teléfono}='${phoneE164}',{Opt_Out}=TRUE())`,
      fields: ["Opt_Out"],
      maxRecords: 1,
    })
    .all();
  return recs.length > 0;
}

/** Alta mínima del scheduler: Nombre + Teléfono (+ Clínica). Preserva los
 *  campos exactos del MVP del scheduler (sin canal/consentimiento). */
export async function createPacienteBasico(params: {
  nombre: string;
  telefono: string;
  clinicaId?: string;
}): Promise<{ recordId: string }> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.createPacienteBasicoPg(params);
  }
  const fields: any = { Nombre: params.nombre, "Teléfono": params.telefono };
  if (params.clinicaId) fields["Clínica"] = [params.clinicaId];
  const created = await base(TABLES.patients).create([{ fields }]);
  const rec = created?.[0];
  if (!rec?.id) throw new Error("Airtable: no se pudo crear paciente (sin id).");
  return { recordId: rec.id };
}

/** Alta sin teléfono propio (menores): Nombre + Tutor teléfono (+ Clínica). */
export async function createPacienteSinTelefono(params: {
  nombre: string;
  tutorTelefono: string;
  clinicaId?: string;
}): Promise<{ recordId: string }> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.createPacienteSinTelefonoPg(params);
  }
  const fields: any = { Nombre: params.nombre, "Tutor teléfono": params.tutorTelefono };
  if (params.clinicaId) fields["Clínica"] = [params.clinicaId];
  const created = await base(TABLES.patients).create([{ fields }]);
  const rec = created?.[0];
  if (!rec?.id) throw new Error("Airtable: no se pudo crear paciente sin teléfono (sin id).");
  return { recordId: rec.id };
}

/** ID por Nombre + Tutor teléfono exactos (+ Clínica opcional, por link). */
export async function findPacienteIdPorNombreYTutor(params: {
  nombre: string;
  tutorTelefono: string;
  clinicaId?: string;
}): Promise<string | null> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.findPacienteIdPorNombreYTutorPg(params);
  }
  const safeName = String(params.nombre).replace(/'/g, "\\'");
  const safeTutor = String(params.tutorTelefono).replace(/'/g, "\\'");
  const parts = [`{Nombre}='${safeName}'`, `{Tutor teléfono}='${safeTutor}'`];
  if (params.clinicaId) parts.push(`FIND('${params.clinicaId}', ARRAYJOIN({Clínica}))`);
  const recs = await base(TABLES.patients)
    .select({ maxRecords: 1, filterByFormula: `AND(${parts.join(",")})` })
    .firstPage();
  return recs?.[0]?.id ?? null;
}

/** SOLO DEV — muestra de fields crudos para introspección de esquema
 *  (/api/no-shows/dev/campos). No usar en superficie de producción. */
export async function samplePacientesFieldsDev(n: number): Promise<any[]> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.samplePacientesFieldsDevPg(n);
  }
  return (await (base(TABLES.patients as any).select({ maxRecords: n }).firstPage() as any)) as any[];
}

/** SOLO DEV — record ids de pacientes (seeder no-shows; fields:[] = solo ids). */
export async function listPacientesIdsDev(maxRecords: number): Promise<string[]> {
  if (usaPostgres("pacientes")) {
    const pg = await import("./pg");
    return pg.listPacientesIdsDevPg(maxRecords);
  }
  const recs = await base(TABLES.patients as any)
    .select({ maxRecords, fields: [] })
    .all();
  return (recs as any[]).map((r) => r.id);
}
