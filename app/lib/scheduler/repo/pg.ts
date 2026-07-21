// app/lib/scheduler/repo/pg.ts — FASE 2: dominio Agenda sobre Postgres.
//
// La superficie diferida (no-shows, /api/db) lee RECORDS CRUDOS de Airtable
// (r.fields["Hora inicio"], r.get("Nombre"), lookups Paciente_nombre...).
// Este módulo devuelve RECORD-SHIMS: { id, fields, get() } con los nombres
// de campo de Airtable, sintetizando los LOOKUPs con JOIN (D6). Así el
// volteo no obliga a re-tipar la superficie diferida todavía.

import { runWithClienteDb } from "../../db/context";
import { currentCliente, type Cliente } from "../../airtable";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[agenda-pg] sin cliente en contexto (fail-closed)");
  return c;
}
const iso = (v: any): string | undefined => (v == null ? undefined : v instanceof Date ? v.toISOString() : String(v));

type Shim = { id: string; fields: Record<string, unknown>; get: (k: string) => unknown; _rawJson: { createdTime: string } };
function shim(id: string, fields: Record<string, unknown>, createdAt: any): Shim {
  const f: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined && v !== "") f[k] = v;
  return { id, fields: f, get: (k: string) => f[k], _rawJson: { createdTime: iso(createdAt) ?? "" } };
}

// JOIN de lookups de Citas (paciente/tratamiento/staff/sillón/clínica).
const CITA_SELECT = `
  select c.*, p.nombre as _pac_nombre, p.telefono as _pac_tel, p.tutor_telefono as _pac_tutor,
         t.categoria as _trat_categoria, t.nombre as _trat_nombre,
         s.staff_id as _staff_id, si.sillon_id as _sillon_id,
         cl.clinica_id_airtable as _cli_id, cl.nombre as _cli_nombre
  from citas c
  left join pacientes p on p.cliente = c.cliente and p.id = c.paciente_id
  left join tratamientos t on t.cliente = c.cliente and t.id = c.tratamiento_id
  left join staff s on s.cliente = c.cliente and s.id = c.profesional_id
  left join sillones si on si.cliente = c.cliente and si.id = c.sillon_id
  left join clinicas cl on cl.cliente = c.cliente and cl.id = c.clinica_id`;

function citaShim(r: any): Shim {
  return shim(r.id, {
    "Nombre": r.nombre, "Hora inicio": iso(r.hora_inicio), "Hora final": iso(r.hora_final),
    "Estado": r.estado, "Notas": r.notas, "Origen": r.origen,
    "Paciente": r.paciente_id ? [r.paciente_id] : undefined,
    "Tratamiento": r.tratamiento_id ? [r.tratamiento_id] : undefined,
    "Profesional": r.profesional_id ? [r.profesional_id] : undefined,
    "Sillón": r.sillon_id ? [r.sillon_id] : undefined,
    "Clínica": r.clinica_id ? [r.clinica_id] : undefined,
    "Ultima_accion": r.ultima_accion ? String(r.ultima_accion).slice(0, 10) : undefined,
    "Tipo_ultima_accion": r.tipo_ultima_accion, "Fase_recordatorio": r.fase_recordatorio,
    "Notas_accion": r.notas_accion,
    // LOOKUPs sintetizados (D6)
    "Paciente_nombre": r._pac_nombre ? [r._pac_nombre] : undefined,
    "Paciente_teléfono": r._pac_tel ? [r._pac_tel] : undefined,
    "Paciente_tutor_teléfono": r._pac_tutor ? [r._pac_tutor] : undefined,
    "Tratamiento_nombre": r._trat_nombre ? [r._trat_nombre] : undefined,
    "Profesional_id": r._staff_id ? [r._staff_id] : undefined,
    "Sillon_id": r._sillon_id ? [r._sillon_id] : undefined,
    "Clínica ID": r._cli_id ? [r._cli_id] : undefined,
    "Clínica_id": r._cli_id ? [r._cli_id] : undefined,
  }, r.created_at);
}

async function citasWhere(whereSql: string, params: unknown[]): Promise<Shim[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const q = sql.raw(`${CITA_SELECT} where ${whereSql} order by c.hora_inicio asc nulls last, c.id asc`);
    const r: any = await q.execute(trx);
    // parámetros: interpolados de forma segura por el caller (solo ISO strings generadas)
    return (r.rows as any[]).map(citaShim);
  });
}

// ── Citas: lecturas raw ───────────────────────────────────────────────
export async function listCitasDesdeRawPg(desdeIso: string, opts: { hastaIso?: string } = {}): Promise<any[]> {
  const w = opts.hastaIso
    ? `c.hora_inicio > '${desdeIso.replace(/'/g, "''")}' and c.hora_inicio < '${opts.hastaIso.replace(/'/g, "''")}'`
    : `c.hora_inicio > '${desdeIso.replace(/'/g, "''")}'`;
  return citasWhere(w, []);
}
export async function listCitasEstadoVentanaRawPg(p: { estado: string; desdeIso: string; hastaIso: string }): Promise<any[]> {
  const e = p.estado.replace(/'/g, "''");
  return citasWhere(`c.estado = '${e}' and c.hora_inicio > '${p.desdeIso.replace(/'/g, "''")}' and c.hora_inicio < '${p.hastaIso.replace(/'/g, "''")}'`, []);
}
export async function listCitasPorTelefonoRawPg(phone: string): Promise<any[]> {
  const t = phone.replace(/'/g, "''");
  return citasWhere(`(p.telefono = '${t}' or p.tutor_telefono = '${t}')`, []);
}
export async function listCitasPorProfesionalRawPg(staffId: string, opts: { maxRecords?: number } = {}): Promise<any[]> {
  const recs = await citasWhere(`s.staff_id = '${staffId.replace(/'/g, "''")}'`, []);
  return recs.slice(0, opts.maxRecords ?? 500);
}
export async function listCitasRevenueRawPg(p: { staffId?: string | null; fromIso: string }): Promise<any[]> {
  const w = [`c.hora_inicio >= '${p.fromIso.replace(/'/g, "''")}'`];
  if (p.staffId) w.push(`s.staff_id = '${p.staffId.replace(/'/g, "''")}'`);
  const recs = await citasWhere(w.join(" and "), []);
  return recs.slice(0, 2000);
}
export async function listCitasRawPg(maxRecords: number): Promise<any[]> {
  const recs = await citasWhere("true", []);
  return recs.slice(0, maxRecords);
}
export async function listCitasOrdenadasDescRawPg(maxRecords: number): Promise<any[]> {
  const recs = await citasWhere("true", []);
  return recs.reverse().slice(0, maxRecords);
}
export async function listCitasResumenNoShowRawPg(): Promise<any[]> {
  const recs = await citasWhere("true", []);
  return recs.slice(0, 500);
}
export async function findCitaRawPg(citaId: string): Promise<any> {
  const recs = await citasWhere(`c.id = '${citaId.replace(/'/g, "''")}'`, []);
  if (!recs[0]) throw new Error(`cita no encontrada: ${citaId}`);
  return recs[0];
}

// ── Citas: escrituras ─────────────────────────────────────────────────
export async function updateCitaEstadoPg(citaId: string, estado: string): Promise<void> {
  await runWithClienteDb(cli(), (trx) =>
    trx.updateTable("citas").set({ estado } as any).where("id", "=", citaId).execute());
}
export async function registrarAccionNoShowEnCitaPg(citaId: string, i: {
  ultimaAccion: string; tipoUltimaAccion?: string; faseRecordatorio?: string; notasAccion?: string;
}): Promise<void> {
  const set: Record<string, unknown> = { ultima_accion: i.ultimaAccion };
  if (i.tipoUltimaAccion) set.tipo_ultima_accion = i.tipoUltimaAccion;
  if (i.faseRecordatorio) set.fase_recordatorio = i.faseRecordatorio;
  if (i.notasAccion) set.notas_accion = i.notasAccion;
  await runWithClienteDb(cli(), (trx) => trx.updateTable("citas").set(set as any).where("id", "=", citaId).execute());
}
export async function createCitaMinimaPg(i: { nombre: string; horaInicioIso: string; horaFinalIso: string; notas?: string }): Promise<{ id: string }> {
  const r = await runWithClienteDb(cli(), (trx) =>
    trx.insertInto("citas").values({
      cliente: cli(), nombre: i.nombre, hora_inicio: new Date(i.horaInicioIso), hora_final: new Date(i.horaFinalIso), notas: i.notas ?? null,
    } as any).returning("id").executeTakeFirstOrThrow());
  return { id: r.id };
}
export async function reprogramarCitaPg(citaId: string, i: { horaInicioIso?: string; horaFinalIso?: string; estado?: string }): Promise<void> {
  const set: Record<string, unknown> = {};
  if (i.horaInicioIso) set.hora_inicio = new Date(i.horaInicioIso);
  if (i.horaFinalIso) set.hora_final = new Date(i.horaFinalIso);
  if (i.estado) set.estado = i.estado;
  await runWithClienteDb(cli(), (trx) => trx.updateTable("citas").set(set as any).where("id", "=", citaId).execute());
}

// ── Citas: métodos TIPADOS del scheduler (cierre del split-brain gate 5) ──
// Los 10 métodos tipados de reserva escribían/leían base(Citas)=Airtable
// mientras las *Raw ya iban a PG. Aquí voltean al MISMO backend. Los
// side-effects (fireCitaEvento/fireEvaluarRiesgo) los conserva el caller.
async function setCita(citaId: string, set: Record<string, unknown>): Promise<void> {
  if (!Object.keys(set).length) return;
  await runWithClienteDb(cli(), (trx) => trx.updateTable("citas").set(set as any).where("id", "=", citaId).execute());
}
export async function cancelAppointmentPg(citaId: string, origin?: string): Promise<void> {
  await setCita(citaId, origin ? { estado: "Cancelado", origen: origin } : { estado: "Cancelado" });
}
export async function completeAppointmentPg(citaId: string): Promise<void> {
  await setCita(citaId, { estado: "Completado" });
}
export async function markNoShowPg(citaId: string, notas: string): Promise<void> {
  await setCita(citaId, { estado: "Cancelado", notas });
}
export async function confirmAppointmentPg(citaId: string): Promise<void> {
  await setCita(citaId, { estado: "Confirmada" });
}
export async function updateAppointmentPg(citaId: string, p: {
  startIso?: string; endIso?: string; staffRecordId?: string; treatmentRecordId?: string; notes?: string;
}): Promise<void> {
  const set: Record<string, unknown> = {};
  if (p.startIso) set.hora_inicio = new Date(p.startIso);
  if (p.endIso) set.hora_final = new Date(p.endIso);
  if (p.staffRecordId) set.profesional_id = p.staffRecordId;
  if (p.treatmentRecordId) set.tratamiento_id = p.treatmentRecordId;
  if (p.notes !== undefined) set.notas = p.notes;
  await setCita(citaId, set);
}
export async function createAppointmentPg(p: {
  name: string; startIso: string; endIso: string; clinicRecordId?: string; notes?: string;
  staffRecordId?: string; sillonRecordId?: string; treatmentRecordId?: string; patientRecordId?: string;
}): Promise<{ recordId: string }> {
  const r = await runWithClienteDb(cli(), (trx) =>
    trx.insertInto("citas").values({
      cliente: cli(), nombre: p.name, hora_inicio: new Date(p.startIso), hora_final: new Date(p.endIso),
      notas: p.notes ?? null, clinica_id: p.clinicRecordId ?? null, profesional_id: p.staffRecordId ?? null,
      sillon_id: p.sillonRecordId ?? null, tratamiento_id: p.treatmentRecordId ?? null, paciente_id: p.patientRecordId ?? null,
    } as any).returning("id").executeTakeFirstOrThrow());
  return { recordId: r.id };
}
/** Todas las citas como shims (para listAppointmentsByDay/Week que filtran en JS). */
export async function listCitasTodasPg(maxRecords: number): Promise<any[]> {
  const recs = await citasWhere("true", []);
  return recs.slice(0, maxRecords);
}

// ── Staff / Sillones / Tratamientos raw ───────────────────────────────
function staffShim(r: any): Shim {
  return shim(r.id, {
    "Staff ID": r.staff_id, "Nombre": r.nombre, "Activo": r.activo, "Rol": r.rol,
    "Tratamientos": r.tratamientos ? String(r.tratamientos).split(",") : undefined,
    "Horario laboral": r.horario_laboral, "Horario": r.horario,
    "Almuerzo_inicio": r.almuerzo_inicio, "Almuerzo_fin": r.almuerzo_fin,
    "Clínica": r.clinica_id ? [r.clinica_id] : undefined,
  }, r.created_at);
}
export async function listStaffCamposRawPg(_fields: string[]): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("staff").selectAll().orderBy("created_at", "asc").orderBy("id", "asc").execute();
    return rows.map(staffShim);
  });
}
export async function findStaffPorStaffIdRawPg(staffId: string): Promise<any | null> {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("staff").selectAll().where("staff_id", "=", staffId).limit(1).executeTakeFirst();
    return r ? staffShim(r) : null;
  });
}
export async function getStaffHorarioPorRecordIdPg(id: string): Promise<any | null> {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("staff").selectAll().where("id", "=", id).executeTakeFirst();
    return r ? staffShim(r) : null;
  });
}
export async function listStaffFirstPageRawPg(maxRecords = 200): Promise<any[]> {
  const all = await listStaffCamposRawPg([]);
  return all.slice(0, maxRecords);
}
export async function getStaffNombrePorIdPg(id: string): Promise<string> {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("staff").select("nombre").where("id", "=", id).executeTakeFirstOrThrow();
    return r.nombre ?? "";
  });
}
export async function findStaffRawPg(id: string): Promise<any> {
  const r = await getStaffHorarioPorRecordIdPg(id);
  if (!r) throw new Error(`staff no encontrado: ${id}`);
  return r;
}
export async function mapStaffNombrePorIdsPg(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("staff").select(["id", "nombre"]).where("id", "in", ids).execute();
    for (const r of rows) map.set(r.id, r.nombre ?? "");
    return map;
  });
}
export async function listSillonesCamposRawPg(_f: string[]): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("sillones").selectAll().orderBy("created_at", "asc").execute();
    return rows.map((r: any) => shim(r.id, { "Sillón ID": r.sillon_id, "Nombre": r.nombre }, r.created_at));
  });
}
function tratShim(r: any): Shim {
  return shim(r.id, {
    "Tratamientos ID": r.tratamientos_id, "Categoria": r.categoria, "Nombre": r.nombre,
    "Duración": r.duracion_min, "Buffer antes": r.buffer_antes_min, "Buffer despues": r.buffer_despues_min,
    "Instrucciones_pre": r.instrucciones_pre, "Clínica ID": r.clinica_id ? [r.clinica_id] : undefined,
  }, r.created_at);
}
export async function listTratamientosRawPg(maxRecords = 100): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("tratamientos").selectAll().orderBy("created_at", "asc").limit(maxRecords).execute();
    return rows.map(tratShim);
  });
}
export async function listTratamientosInstruccionesPg(): Promise<Array<{ nombre: string; instruccionesPre: string }>> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("tratamientos").select(["nombre", "instrucciones_pre"]).limit(200).execute();
    return rows.map((r) => ({ nombre: r.nombre ?? "", instruccionesPre: r.instrucciones_pre ?? "" }));
  });
}
export async function updateTratamientoInstruccionesPg(id: string, instrucciones: string): Promise<void> {
  await runWithClienteDb(cli(), (trx) => trx.updateTable("tratamientos").set({ instrucciones_pre: instrucciones } as any).where("id", "=", id).execute());
}
export async function mapTratamientosPorIdsPg(ids: string[], _fields: string[]): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!ids.length) return map;
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("tratamientos").selectAll().where("id", "in", Array.from(new Set(ids))).execute();
    for (const r of rows) map.set(r.id, tratShim(r).fields);
    return map;
  });
}
export async function listTratamientosPorIdsRawPg(ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("tratamientos").selectAll().where("id", "in", Array.from(new Set(ids))).execute();
    return rows.map(tratShim);
  });
}
export async function listSillonesPorIdsRawPg(ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("sillones").selectAll().where("id", "in", Array.from(new Set(ids))).execute();
    return rows.map((r: any) => shim(r.id, { "Sillón ID": r.sillon_id, "Nombre": r.nombre }, r.created_at));
  });
}
export async function listTratamientosNombreRawPg(): Promise<any[]> {
  return listTratamientosRawPg(1000);
}
