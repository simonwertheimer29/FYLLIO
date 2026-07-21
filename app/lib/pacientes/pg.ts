// app/lib/pacientes/pg.ts — FASE 2 gate 4: dominio Pacientes sobre Postgres.
// Mismos shapes que la implementación Airtable; cliente desde runWithCliente.
import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import type { Paciente, PacienteAceptado, ListPacientesParams } from "./pacientes";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[pacientes-pg] sin cliente en contexto (fail-closed)");
  return c;
}
const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
const numN = (v: any): number | null => (v == null ? null : Number(v));

function rowToPaciente(r: any): Paciente {
  return {
    id: r.id, nombre: r.nombre ?? "", telefono: r.telefono, email: r.email,
    tratamientos: (r.tratamientos ? String(r.tratamientos).split(",") : []) as Paciente["tratamientos"],
    doctorLinkId: r.doctor_id, fechaCita: r.fecha_cita,
    presupuestoTotal: numN(r.presupuesto_total), aceptado: r.aceptado as PacienteAceptado | null,
    pagado: numN(r.pagado), pendiente: numN(r.pendiente), financiado: numN(r.financiado),
    notas: r.notas, canalOrigen: r.canal_origen, clinicaId: r.clinica_id,
    leadOrigenId: r.lead_origen_id, activo: Boolean(r.activo ?? true),
    optoutAutomatizaciones: Boolean(r.optout_automatizaciones), createdAt: iso(r.created_at),
  };
}

export async function listPacientesPg(params: ListPacientesParams = {}): Promise<Paciente[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("pacientes").selectAll()
      .orderBy("created_at", "desc").orderBy("id", "asc").execute();
    let ps = rows.map(rowToPaciente);
    if (params.clinicaIds?.length) { const s = new Set(params.clinicaIds); ps = ps.filter((p) => p.clinicaId && s.has(p.clinicaId)); }
    if (params.aceptado) ps = ps.filter((p) => p.aceptado === params.aceptado);
    if (params.search) { const q = params.search.toLowerCase().trim(); if (q) ps = ps.filter((p) => p.nombre.toLowerCase().includes(q) || (p.telefono ?? "").toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q)); }
    if (params.fechaDesde) ps = ps.filter((p) => p.createdAt >= params.fechaDesde!);
    if (params.fechaHasta) ps = ps.filter((p) => p.createdAt <= params.fechaHasta!);
    return ps;
  });
}

export async function getPacientePg(id: string): Promise<Paciente | null> {
  try {
    return await runWithClienteDb(cli(), async (trx) => {
      const r = await trx.selectFrom("pacientes").selectAll().where("id", "=", id).executeTakeFirst();
      return r ? rowToPaciente(r) : null;
    });
  } catch { return null; }
}

type CreateInput = Parameters<typeof import("./pacientes").createPaciente>[0];
export async function createPacientePg(input: CreateInput): Promise<Paciente> {
  const row = await runWithClienteDb(cli(), (trx) =>
    trx.insertInto("pacientes").values({
      cliente: cli(), nombre: input.nombre, clinica_id: input.clinicaId, activo: true,
      canal_preferido: "Whatsapp", consentimiento_whatsapp: true,
      telefono: input.telefono ?? null, email: input.email ?? null,
      tratamientos: input.tratamientos?.length ? input.tratamientos.join(",") : null,
      doctor_id: input.doctorLinkId ?? null, fecha_cita: input.fechaCita ?? null,
      presupuesto_total: input.presupuestoTotal ?? null, aceptado: input.aceptado ?? null,
      pagado: input.pagado ?? null,
      pendiente: typeof input.presupuestoTotal === "number" && typeof input.pagado === "number" ? Math.max(0, input.presupuestoTotal - input.pagado) : null,
      financiado: input.financiado ?? null, notas: input.notas ?? null,
      canal_origen: input.canalOrigen ?? null, lead_origen_id: input.leadOrigenId ?? null,
    } as any).returningAll().executeTakeFirstOrThrow());
  return rowToPaciente(row);
}

const COLS: Record<string, string> = {
  nombre: "nombre", telefono: "telefono", email: "email", doctorLinkId: "doctor_id",
  fechaCita: "fecha_cita", presupuestoTotal: "presupuesto_total", aceptado: "aceptado",
  pagado: "pagado", financiado: "financiado", notas: "notas", canalOrigen: "canal_origen",
  activo: "activo", optoutAutomatizaciones: "optout_automatizaciones",
};
export async function updatePacientePg(id: string, patch: Record<string, unknown>): Promise<Paciente> {
  const set: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(COLS)) if (patch[k] !== undefined) set[c] = patch[k] ?? null;
  if (patch.tratamientos !== undefined) set.tratamientos = Array.isArray(patch.tratamientos) ? (patch.tratamientos as string[]).join(",") : null;
  const row = await runWithClienteDb(cli(), async (trx) => {
    if (patch.presupuestoTotal !== undefined || patch.pagado !== undefined) {
      const cur = await trx.selectFrom("pacientes").select(["presupuesto_total", "pagado"]).where("id", "=", id).executeTakeFirst();
      const total = (patch.presupuestoTotal as number | null | undefined) ?? numN(cur?.presupuesto_total);
      const pag = (patch.pagado as number | null | undefined) ?? numN(cur?.pagado);
      if (typeof total === "number" && typeof pag === "number") set.pendiente = Math.max(0, total - pag);
    }
    return trx.updateTable("pacientes").set(set as any).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
  });
  return rowToPaciente(row);
}

export async function deletePacientePg(id: string): Promise<void> {
  await runWithClienteDb(cli(), (trx) => trx.deleteFrom("pacientes").where("id", "=", id).execute());
}

export async function appendNotaPacientePg(pacienteId: string, linea: string): Promise<void> {
  await runWithClienteDb(cli(), async (trx) => {
    const r = await sql`update pacientes set notas = coalesce(notas || E'\\n', '') || ${linea} where id = ${pacienteId}`.execute(trx);
    if (Number(r.numAffectedRows ?? 0) === 0) throw new Error("paciente no encontrado");
  });
}

export async function createPacienteDesdeConversionPg(input: {
  nombre: string; telefono?: string | null; clinicaId: string; notas: string;
}): Promise<{ id: string; nombre: string }> {
  const row = await runWithClienteDb(cli(), (trx) =>
    trx.insertInto("pacientes").values({
      cliente: cli(), nombre: input.nombre, clinica_id: input.clinicaId,
      canal_preferido: "Whatsapp", consentimiento_whatsapp: true, activo: true,
      notas: input.notas, telefono: input.telefono ?? null,
    } as any).returning(["id", "nombre"]).executeTakeFirstOrThrow());
  return { id: row.id, nombre: row.nombre ?? input.nombre };
}

const G: Record<string, string> = { "Nombre": "nombre", "Teléfono": "telefono", "Email": "email", "Notas": "notas" };
export async function upsertPacienteImportPorTelefonoPg(fields: Record<string, string>): Promise<"created" | "updated" | "skipped"> {
  const phone = fields["Teléfono"];
  if (!phone) return "skipped";
  try {
    return await runWithClienteDb(cli(), async (trx) => {
      const set: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) if (G[k]) set[G[k]] = v;
      const ex = await trx.selectFrom("pacientes").select("id").where("telefono", "=", phone).limit(1).executeTakeFirst();
      if (ex) { await trx.updateTable("pacientes").set(set as any).where("id", "=", ex.id).execute(); return "updated"; }
      await trx.insertInto("pacientes").values({ cliente: cli(), nombre: fields["Nombre"] ?? "(sin nombre)", ...set } as any).execute();
      return "created";
    });
  } catch { return "skipped"; }
}

export async function listPacientesBusquedaRapidaPg(maxRecords = 300) {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("pacientes").select(["id", "nombre", "telefono", "clinica_id"])
      .orderBy("created_at", "desc").limit(maxRecords).execute();
    return rows.map((r) => ({ id: r.id, nombre: r.nombre ?? "", telefono: r.telefono ?? "", clinica: r.clinica_id ?? "" }));
  });
}

export async function listResumenFinancieroPorIdsPg(ids: string[]) {
  if (!ids.length) return [];
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("pacientes").select(["id", "clinica_id", "lead_origen_id", "pendiente"]).where("id", "in", ids).execute();
    return rows.map((r) => ({
      id: r.id, clinicaIds: r.clinica_id ? [r.clinica_id] : [],
      tieneLeadOrigen: r.lead_origen_id != null, pendiente: Number(r.pendiente ?? 0) || 0,
    }));
  });
}

export async function sumPendientePorIdsPg(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  try {
    return await runWithClienteDb(cli(), async (trx) => {
      const r = await trx.selectFrom("pacientes")
        .select(sql<string>`coalesce(sum(pendiente), 0)`.as("s")).where("id", "in", ids).executeTakeFirst();
      return Number(r?.s ?? 0) || 0;
    });
  } catch { return 0; }
}

export async function syncFinancieroPacientePg(pacienteId: string, totalPagado: number): Promise<void> {
  await runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("pacientes").select("presupuesto_total").where("id", "=", pacienteId).executeTakeFirstOrThrow();
    const presupuesto = Number(r.presupuesto_total ?? 0) || 0;
    await trx.updateTable("pacientes").set({ pagado: totalPagado, pendiente: Math.max(0, presupuesto - totalPagado) } as any).where("id", "=", pacienteId).execute();
  });
}

const telNorm = (col: string) => sql<string>`replace(replace(replace(coalesce(${sql.ref(col)},''),' ',''),'+',''),'-','')`;
export async function findPacienteIdPorTelefonoOTutorPg(phone: string): Promise<string | null> {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("pacientes").select("id")
      .where((eb) => eb.or([eb("telefono", "=", phone), eb("tutor_telefono", "=", phone)]))
      .limit(1).executeTakeFirst();
    return r?.id ?? null;
  });
}
export async function getPacienteContactoPg(id: string) {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("pacientes").select(["nombre", "telefono", "tutor_telefono"]).where("id", "=", id).executeTakeFirstOrThrow();
    return { name: r.nombre || "Paciente", phone: r.telefono || "", tutorPhone: r.tutor_telefono || "" };
  });
}
export async function findPacienteIdPorTelefonoPg(phone: string): Promise<string | null> {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("pacientes").select("id").where("telefono", "=", phone).limit(1).executeTakeFirst();
    return r?.id ?? null;
  });
}
export async function getPacientePorTelefonoPg(phone: string) {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("pacientes").select(["id", "nombre"]).where("telefono", "=", phone).limit(1).executeTakeFirst();
    return r ? { recordId: r.id, name: r.nombre ?? "" } : null;
  });
}
export async function marcarOptOutPorTelefonoPg(phone: string): Promise<void> {
  await runWithClienteDb(cli(), (trx) => trx.updateTable("pacientes").set({ opt_out: true } as any).where("telefono", "=", phone).execute());
}
export async function isOptOutPorTelefonoPg(phone: string): Promise<boolean> {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("pacientes").select("id").where("telefono", "=", phone).where("opt_out", "=", true).limit(1).executeTakeFirst();
    return Boolean(r);
  });
}
export async function createPacienteBasicoPg(p: { nombre: string; telefono: string; clinicaId?: string }) {
  const r = await runWithClienteDb(cli(), (trx) =>
    trx.insertInto("pacientes").values({ cliente: cli(), nombre: p.nombre, telefono: p.telefono, clinica_id: p.clinicaId ?? null } as any).returning("id").executeTakeFirstOrThrow());
  return { recordId: r.id };
}
export async function createPacienteSinTelefonoPg(p: { nombre: string; tutorTelefono: string; clinicaId?: string }) {
  const r = await runWithClienteDb(cli(), (trx) =>
    trx.insertInto("pacientes").values({ cliente: cli(), nombre: p.nombre, tutor_telefono: p.tutorTelefono, clinica_id: p.clinicaId ?? null } as any).returning("id").executeTakeFirstOrThrow());
  return { recordId: r.id };
}
export async function findPacienteIdPorNombreYTutorPg(p: { nombre: string; tutorTelefono: string; clinicaId?: string }): Promise<string | null> {
  return runWithClienteDb(cli(), async (trx) => {
    let q = trx.selectFrom("pacientes").select("id").where("nombre", "=", p.nombre).where("tutor_telefono", "=", p.tutorTelefono);
    if (p.clinicaId) q = q.where("clinica_id", "=", p.clinicaId);
    const r = await q.limit(1).executeTakeFirst();
    return r?.id ?? null;
  });
}
export async function getPacienteFactoresRiesgoPg(id: string) {
  return runWithClienteDb(cli(), async (trx) => {
    const r = await trx.selectFrom("pacientes").select(["canal_origen", "edad", "fecha_nacimiento"]).where("id", "=", id).executeTakeFirstOrThrow();
    return { canalOrigen: r.canal_origen ?? null, edad: r.edad != null ? Number(r.edad) : null, fechaNacimiento: r.fecha_nacimiento ?? null };
  });
}
export async function mapNombreTelefonoPorIdsPg(ids: string[]): Promise<Map<string, { nombre: string; telefono: string }>> {
  const map = new Map<string, { nombre: string; telefono: string }>();
  if (!ids.length) return map;
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("pacientes").select(["id", "nombre", "telefono"]).where("id", "in", Array.from(new Set(ids))).execute();
    for (const r of rows) map.set(r.id, { nombre: r.nombre ?? "", telefono: r.telefono ?? "" });
    return map;
  });
}
export async function samplePacientesFieldsDevPg(n: number): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("pacientes").selectAll().limit(n).execute();
    return rows.map((r) => ({ id: r.id, fields: r }));
  });
}
export async function listPacientesIdsDevPg(maxRecords: number): Promise<string[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("pacientes").select("id").limit(maxRecords).execute();
    return rows.map((r) => r.id);
  });
}
