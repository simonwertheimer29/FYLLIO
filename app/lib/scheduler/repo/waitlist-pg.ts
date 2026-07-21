// app/lib/scheduler/repo/waitlist-pg.ts — FASE 2: Lista_de_espera sobre Postgres.
//
// A DIFERENCIA de los mini-dominios, aquí NO se usa el evaluador de fórmulas:
// el campo {Clínica} se usa con DOS semánticas incompatibles según el caller
// (por NOMBRE en listWaitlistPorClinicaRaw; por RECORD ID en
// listActive/listWaitlist vía FIND/ARRAYJOIN). Un shim no puede exponer ambas,
// así que cada función traduce a SQL RESOLVIENDO SU INTENCIÓN: filtros por id →
// columna *_id; filtro por nombre → JOIN clinicas.nombre. Paridad por intención.

import { runWithClienteDb } from "../../db/context";
import { currentCliente, type Cliente } from "../../airtable";
import type { WaitlistEntry } from "./waitlistRepo";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[waitlist-pg] sin cliente (fail-closed)");
  return c;
}
const iso = (v: any): string | undefined => (v == null ? undefined : v instanceof Date ? v.toISOString() : String(v));

/** Fila PG → WaitlistEntry (mismo shape que la rama Airtable). */
function rowToEntry(r: any): WaitlistEntry {
  return {
    recordId: r.id,
    clinicRecordId: r.clinica_id ?? undefined,
    patientRecordId: r.paciente_id ?? undefined,
    treatmentRecordId: r.tratamiento_id ?? undefined,
    preferredStaffRecordId: r.profesional_preferido_id ?? undefined,
    diasPermitidos: r.dias_permitidos ? String(r.dias_permitidos).split(",").filter(Boolean) : [],
    rangoStart: iso(r.rango_deseado_start),
    rangoEnd: iso(r.rango_deseado_end),
    estado: r.estado ?? undefined,
    prioridad: r.prioridad ?? undefined,
    urgencia: r.urgencia_nivel ?? undefined,
    permiteFueraRango: Boolean(r.permite_fuera_rango),
    offerHoldId: r.offer_hold_id ?? undefined,
    offerExpiresAt: iso(r.offer_expires_at),
    offerCycle: r.offer_cycle != null ? Number(r.offer_cycle) : undefined,
    lastOfferedSlotKey: r.last_offered_slot_key ?? undefined,
    lastOfferResult: r.last_offer_result ?? undefined,
    citaSeguraRecordId: r.cita_segura_id ?? undefined,
    citaCerradaRecordId: r.cita_cerrada_id ?? undefined,
    createdAt: iso(r.created_at),
  };
}

/** Fila PG → record-shim con NOMBRES de campo Airtable (para listWaitlistPorClinicaRaw,
 *  cuyo caller lee fields crudos). {Clínica} = NOMBRE (via join) para paridad de ese caller. */
function rowToRawShim(r: any): any {
  const f: Record<string, unknown> = {
    "Clínica": r._cli_nombre ? [r._cli_nombre] : undefined,
    "Paciente": r.paciente_id ? [r.paciente_id] : undefined,
    "Tratamiento": r.tratamiento_id ? [r.tratamiento_id] : undefined,
    "Profesional preferido": r.profesional_preferido_id ? [r.profesional_preferido_id] : undefined,
    "Dias_Permitidos": r.dias_permitidos ? String(r.dias_permitidos).split(",").filter(Boolean) : undefined,
    "Rango_Deseado_Start": iso(r.rango_deseado_start), "Rango_Deseado_End": iso(r.rango_deseado_end),
    "Estado": r.estado, "Prioridad": r.prioridad, "Urgencia_Nivel": r.urgencia_nivel,
    "Permite_Fuera_Rango": r.permite_fuera_rango, "Offer_Hold_Id": r.offer_hold_id,
    "Offer_Expires_At": iso(r.offer_expires_at), "Offer_Cycle": r.offer_cycle,
    "Last_Offered_Slot_Key": r.last_offered_slot_key, "Last_Offer_Result": r.last_offer_result,
    "Cita_segura": r.cita_segura_id ? [r.cita_segura_id] : undefined,
    "Cita cerrada": r.cita_cerrada_id ? [r.cita_cerrada_id] : undefined,
    "Created_At": iso(r.created_at), "Notas": r.notas, "Último contacto": iso(r.ultimo_contacto),
  };
  for (const k of Object.keys(f)) if (f[k] === undefined || f[k] === null || f[k] === "") delete f[k];
  return { id: r.id, fields: f, get: (k: string) => f[k], _rawJson: { createdTime: iso(r.created_at) ?? "" } };
}

const SELECT = "select w.* from lista_espera w";
const SELECT_JOIN = `select w.*, cl.nombre as _cli_nombre from lista_espera w
  left join clinicas cl on cl.cliente = w.cliente and cl.id = w.clinica_id`;

// ── Lecturas (filtros por INTENCIÓN, no por el evaluador) ──────────────
export async function listActiveWaitlistByTreatmentPg(p: { treatmentRecordId: string; clinicRecordId?: string; maxRecords?: number }): Promise<WaitlistEntry[]> {
  return runWithClienteDb(cli(), async (trx) => {
    let q = trx.selectFrom("lista_espera").selectAll().where("estado", "=", "ACTIVE").where("tratamiento_id", "=", p.treatmentRecordId);
    if (p.clinicRecordId) q = q.where("clinica_id", "=", p.clinicRecordId);
    const rows = await q.limit(p.maxRecords ?? 200).execute();
    return rows.map(rowToEntry);
  });
}
export async function listWaitlistPg(p: { clinicRecordId?: string; preferredStaffRecordId?: string; estados?: string[]; maxRecords?: number }): Promise<WaitlistEntry[]> {
  const estados = p.estados ?? ["ACTIVE", "OFFERED"];
  return runWithClienteDb(cli(), async (trx) => {
    let q = trx.selectFrom("lista_espera").selectAll();
    if (estados.length) q = q.where("estado", "in", estados);
    if (p.clinicRecordId) q = q.where("clinica_id", "=", p.clinicRecordId);
    if (p.preferredStaffRecordId) q = q.where("profesional_preferido_id", "=", p.preferredStaffRecordId);
    const rows = await q.limit(p.maxRecords ?? 200).execute();
    return rows.map(rowToEntry);
  });
}
export async function getOfferedEntryByPatientIdPg(patientId: string): Promise<WaitlistEntry | null> {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("lista_espera").selectAll().where("estado", "=", "OFFERED").where("paciente_id", "=", patientId).limit(1).executeTakeFirst();
    return r ? rowToEntry(r) : null;
  });
}
export async function listWaitlistPorClinicaRawPg(clinicNombre: string): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const safe = clinicNombre.replace(/'/g, "''");
    const q = sql.raw(`${SELECT_JOIN} where cl.nombre = '${safe}' and w.estado is distinct from 'Aceptado' and w.estado is distinct from 'Expirado' order by w.prioridad desc nulls last`);
    const r: any = await q.execute(trx);
    return (r.rows as any[]).map(rowToRawShim);
  });
}

// ── Escrituras ─────────────────────────────────────────────────────────
async function setWaitlist(id: string, set: Record<string, unknown>): Promise<void> {
  if (!Object.keys(set).length) return;
  await runWithClienteDb(cli(), (trx) => trx.updateTable("lista_espera").set(set as any).where("id", "=", id).execute());
}
export async function markWaitlistOfferedPg(p: { waitlistRecordId: string; holdId: string; expiresAtIso: string; slotKey: string }): Promise<void> {
  await setWaitlist(p.waitlistRecordId, { estado: "OFFERED", offer_hold_id: p.holdId, offer_expires_at: new Date(p.expiresAtIso), last_offered_slot_key: p.slotKey, last_offer_result: "SENT" });
}
export async function markWaitlistActiveWithResultPg(p: { waitlistRecordId: string; result: "REJECTED" | "EXPIRED" }): Promise<void> {
  await setWaitlist(p.waitlistRecordId, { estado: p.result === "EXPIRED" ? "EXPIRED" : "ACTIVE", last_offer_result: p.result });
}
export async function markWaitlistBookedPg(p: { waitlistRecordId: string; appointmentRecordId: string }): Promise<void> {
  await setWaitlist(p.waitlistRecordId, { estado: "BOOKED", last_offer_result: "ACCEPTED", cita_cerrada_id: p.appointmentRecordId });
}
export async function updateWaitlistEntryPg(id: string, patch: { estado?: string; ultimoContacto?: string }): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.estado !== undefined) set.estado = patch.estado;
  if (patch.ultimoContacto !== undefined) set.ultimo_contacto = patch.ultimoContacto ? new Date(patch.ultimoContacto) : null;
  await setWaitlist(id, set);
}
export async function updateWaitlistEstadoPg(id: string, estado: string, ultimoContacto?: string): Promise<{ id: string }> {
  const set: Record<string, unknown> = { estado };
  if (ultimoContacto) set.ultimo_contacto = new Date(ultimoContacto);
  await setWaitlist(id, set);
  return { id };
}
function buildInsert(p: any): Record<string, unknown> {
  return {
    cliente: cli(), clinica_id: p.clinicRecordId ?? null, paciente_id: p.patientRecordId ?? null,
    tratamiento_id: p.treatmentRecordId ?? null, profesional_preferido_id: p.preferredStaffRecordId ?? null,
    dias_permitidos: Array.isArray(p.diasPermitidos) ? p.diasPermitidos.join(",") : null,
    rango_deseado_start: p.rangoStartIso ? new Date(p.rangoStartIso) : null,
    rango_deseado_end: p.rangoEndIso ? new Date(p.rangoEndIso) : null,
    estado: p.estado, prioridad: p.prioridad ?? null, urgencia_nivel: p.urgencia ?? null,
    permite_fuera_rango: Boolean(p.permiteFueraRango), notas: p.notas ?? null,
  };
}
export async function createWaitlistEntryPg(p: {
  clinicRecordId: string; patientRecordId: string; treatmentRecordId: string; preferredStaffRecordId?: string;
  diasPermitidos?: string[]; rangoStartIso?: string; rangoEndIso?: string;
  prioridad?: string; urgencia?: string; permiteFueraRango?: boolean; notas?: string;
}): Promise<{ recordId: string }> {
  const row = buildInsert({
    ...p, diasPermitidos: p.diasPermitidos ?? ["LUN", "MAR", "MIE", "JUE", "VIE"],
    estado: "ACTIVE", prioridad: p.prioridad ?? "MEDIA", urgencia: p.urgencia ?? "LOW", permiteFueraRango: p.permiteFueraRango ?? false,
  });
  const r = await runWithClienteDb(cli(), (trx) => trx.insertInto("lista_espera").values(row as any).returning("id").executeTakeFirstOrThrow());
  return { recordId: r.id };
}
export async function createWaitlistEntradaFlexiblePg(p: any): Promise<{ id: string | undefined }> {
  const row = buildInsert(p); // sin defaults: escribe lo que llega
  const r = await runWithClienteDb(cli(), (trx) => trx.insertInto("lista_espera").values(row as any).returning("id").executeTakeFirstOrThrow());
  return { id: r.id };
}
