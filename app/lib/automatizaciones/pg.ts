// app/lib/automatizaciones/pg.ts — FASE 2: dominio Automatizaciones sobre PG.
// Shims con nombres de campo Airtable; clinica se re-expone como NOMBRE via
// JOIN (los callers filtran/leen por nombre; la FK vive en clinica_id).
import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import type { Regla, AccionLog, ResultadoEjecucion, EventoTipo, EventoSistema, Condicion, Accion } from "./types";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[automatizaciones-pg] sin cliente (fail-closed)");
  return c;
}
const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
const pj = <T,>(v: any): T[] => { try { const x = JSON.parse(String(v ?? "[]")); return Array.isArray(x) ? x : []; } catch { return []; } };

function rowToRegla(r: any): Regla {
  return {
    id: r.id, clinicaId: r.clinica_id, codigo: r.codigo ?? "", nombre: r.nombre ?? "",
    descripcion: r.descripcion ?? "", triggerTipo: r.trigger_tipo,
    condiciones: pj<Condicion>(r.condiciones), acciones: pj<Accion>(r.acciones),
    activa: Boolean(r.activa), vecesDisparada: Number(r.veces_disparada ?? 0),
    ultimaDisparada: r.ultima_disparada_at ? iso(r.ultima_disparada_at) : null,
    modoTest: Boolean(r.modo_test), pacienteTestId: r.paciente_test_id,
    createdAt: iso(r.created_at), updatedAt: r.updated_at ? iso(r.updated_at) : "",
  };
}

export async function listReglasPg(): Promise<Regla[]> {
  try {
    return await runWithClienteDb(cli(), async (trx) => {
      const rows = await trx.selectFrom("reglas_automatizacion").selectAll()
        .orderBy("created_at", "asc").orderBy("id", "asc").execute();
      return rows.map(rowToRegla);
    });
  } catch (err) { console.error("[automatizaciones listReglas pg]:", err); return []; }
}
export async function getReglaPg(id: string): Promise<Regla | null> {
  try {
    return await runWithClienteDb(cli(), async (trx) => {
      const r = await trx.selectFrom("reglas_automatizacion").selectAll().where("id", "=", id).executeTakeFirst();
      return r ? rowToRegla(r) : null;
    });
  } catch { return null; }
}
export async function updateReglaPg(id: string, patch: Record<string, unknown>): Promise<Regla> {
  const M: Record<string, string> = { activa: "activa", modoTest: "modo_test", pacienteTestId: "paciente_test_id", nombre: "nombre", descripcion: "descripcion" };
  const set: Record<string, unknown> = { updated_at: new Date() };
  for (const [k, c] of Object.entries(M)) if (patch[k] !== undefined) set[c] = patch[k] ?? null;
  if (patch.condiciones !== undefined) set.condiciones = JSON.stringify(patch.condiciones);
  if (patch.acciones !== undefined) set.acciones = JSON.stringify(patch.acciones);
  const row = await runWithClienteDb(cli(), (trx) =>
    trx.updateTable("reglas_automatizacion").set(set as any).where("id", "=", id).returningAll().executeTakeFirstOrThrow());
  return rowToRegla(row);
}
export async function incrementarDisparosPg(reglaId: string): Promise<void> {
  await runWithClienteDb(cli(), (trx) =>
    sql`update reglas_automatizacion set veces_disparada = coalesce(veces_disparada,0)+1, ultima_disparada_at = now() where id = ${reglaId}`.execute(trx));
}
export async function logAccionPg(i: {
  reglaId: string; pacienteId?: string | null; leadId?: string | null; presupuestoId?: string | null;
  resultado: ResultadoEjecucion; detalle: Record<string, unknown>;
}): Promise<void> {
  await runWithClienteDb(cli(), (trx) =>
    trx.insertInto("acciones_automatizacion").values({
      cliente: cli(), resumen: `${i.reglaId.slice(-6)} · ${i.resultado}`, regla_id: i.reglaId,
      paciente_id: i.pacienteId ?? null, lead_id: i.leadId ?? null, presupuesto_id: i.presupuestoId ?? null,
      resultado: i.resultado, detalle: JSON.stringify(i.detalle), ejecutada_at: new Date(),
    } as any).execute());
}
export async function listAccionesPg(f: { reglaId?: string; soloErrores?: boolean; limit?: number } = {}): Promise<AccionLog[]> {
  return runWithClienteDb(cli(), async (trx) => {
    let q = trx.selectFrom("acciones_automatizacion").selectAll()
      .orderBy("ejecutada_at", "desc").orderBy("id", "desc");
    if (f.reglaId) q = q.where("regla_id", "=", f.reglaId);
    if (f.soloErrores) q = q.where("resultado", "=", "error");
    const rows = await q.limit(f.limit ?? 50).execute();
    return rows.map((r: any) => ({
      id: r.id, reglaId: r.regla_id ?? "", pacienteId: r.paciente_id, leadId: r.lead_id,
      presupuestoId: r.presupuesto_id, resultado: r.resultado as ResultadoEjecucion,
      detalle: r.detalle ?? "", ejecutadaAt: iso(r.ejecutada_at),
    }));
  });
}
export async function emitirEventoRowPg(i: {
  tipo: EventoTipo; entidadTipo: EventoSistema["entidadTipo"]; entidadId: string; payload: Record<string, unknown>;
}): Promise<void> {
  await runWithClienteDb(cli(), (trx) =>
    trx.insertInto("eventos_sistema").values({
      cliente: cli(), resumen: `${i.tipo} · ${i.entidadId.slice(-6)}`, tipo: i.tipo,
      entidad_tipo: i.entidadTipo, entidad_id: i.entidadId, payload: JSON.stringify(i.payload), procesado: false,
    } as any).execute());
}
export async function listEventosLeadCreadoSinProcesarRawPg(antesDeIso: string): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("eventos_sistema").selectAll()
      .where("tipo", "=", "lead_creado").where("procesado", "=", false)
      .where("created_at", "<", new Date(antesDeIso)).execute();
    return rows.map((r: any) => ({
      id: r.id, fields: { "Tipo": r.tipo, "Entidad_Tipo": r.entidad_tipo, "Entidad_Id": r.entidad_id, "Payload": r.payload, "Procesado": r.procesado, "Created_At": iso(r.created_at) },
      _rawJson: { createdTime: iso(r.created_at) },
    }));
  });
}
export async function marcarEventoProcesadoPg(id: string): Promise<void> {
  await runWithClienteDb(cli(), (trx) => trx.updateTable("eventos_sistema").set({ procesado: true } as any).where("id", "=", id).execute());
}
export async function yaDisparadaRecientementePg(a: { reglaId: string; presupuestoId?: string; pacienteId?: string; dias: number }): Promise<boolean> {
  return runWithClienteDb(cli(), async (trx) => {
    let q = trx.selectFrom("acciones_automatizacion").select("id")
      .where("regla_id", "=", a.reglaId).where("resultado", "=", "success")
      .where("ejecutada_at", ">", new Date(Date.now() - a.dias * 864e5));
    if (a.presupuestoId) q = q.where("presupuesto_id", "=", a.presupuestoId);
    if (a.pacienteId) q = q.where("paciente_id", "=", a.pacienteId);
    return Boolean(await q.limit(1).executeTakeFirst());
  });
}
// ── secuencias / configuracion: shims con clinica como NOMBRE ─────────
const SEC_SELECT = `select s.*, cl.nombre as _cli_nombre from secuencias_automaticas s
  left join clinicas cl on cl.cliente = s.cliente and cl.id = s.clinica_id`;
function secShim(r: any) {
  const f: Record<string, unknown> = {
    presupuesto_id: r.presupuesto_id ?? undefined, clinica: r._cli_nombre ?? undefined,
    paciente_nombre: r.paciente_nombre ?? undefined, telefono: r.telefono ?? undefined,
    tratamiento: r.tratamiento ?? undefined, tipo_evento: r.tipo_evento ?? undefined,
    estado: r.estado ?? undefined, mensaje_generado: r.mensaje_generado ?? undefined,
    tono_usado: r.tono_usado ?? undefined, canal_sugerido: r.canal_sugerido ?? undefined,
    creado_en: iso(r.created_at), actualizado_en: r.actualizado_en ? iso(r.actualizado_en) : undefined,
  };
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return { id: r.id, fields: f, get: (k: string) => f[k] };
}
export async function listSecuenciasFiltradasRawPg(formula: string): Promise<any[]> {
  // La fórmula de los callers es {estado}="X" [AND OR({clinica}='n1',...)].
  const estado = formula.match(/\{estado\}="([^"]+)"/)?.[1];
  const clinicas = [...formula.matchAll(/\{clinica\}='([^']+)'/g)].map((m) => m[1]);
  return runWithClienteDb(cli(), async (trx) => {
    const conds = ["true"];
    if (estado) conds.push(`s.estado = '${estado.replace(/'/g, "''")}'`);
    if (clinicas.length) conds.push(`cl.nombre in (${clinicas.map((c) => `'${c.replace(/'/g, "''")}'`).join(",")})`);
    const r: any = await sql.raw(`${SEC_SELECT} where ${conds.join(" and ")} order by s.created_at desc, s.id desc limit 200`).execute(trx);
    return (r.rows as any[]).map(secShim);
  });
}
export async function patchSecuenciaPg(id: string, u: { estado?: string; mensajeGenerado?: string; actualizadoEn: string }): Promise<void> {
  const set: Record<string, unknown> = { actualizado_en: new Date(u.actualizadoEn) };
  if (u.estado !== undefined) set.estado = u.estado;
  if (u.mensajeGenerado !== undefined) set.mensaje_generado = u.mensajeGenerado;
  await runWithClienteDb(cli(), (trx) => trx.updateTable("secuencias_automaticas").set(set as any).where("id", "=", id).execute());
}
export async function findSecuenciaRawPg(id: string): Promise<any> {
  return runWithClienteDb(cli(), async (trx) => {
    const r: any = await sql.raw(`${SEC_SELECT} where s.id = '${id.replace(/'/g, "''")}'`).execute(trx);
    if (!r.rows[0]) throw new Error("secuencia no encontrada");
    return secShim(r.rows[0]);
  });
}
export async function listPresupuestoIdsPendientesPg(): Promise<Set<string>> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("secuencias_automaticas").select("presupuesto_id").where("estado", "=", "pendiente").execute();
    return new Set(rows.map((r) => String(r.presupuesto_id ?? "")));
  });
}
export async function createSecuenciaRawPg(fields: Record<string, unknown>): Promise<void> {
  await runWithClienteDb(cli(), async (trx) => {
    const nombre = fields["clinica"] ? String(fields["clinica"]) : null;
    const cl = nombre ? await trx.selectFrom("clinicas").select("id").where("nombre", "=", nombre).executeTakeFirst() : null;
    await trx.insertInto("secuencias_automaticas").values({
      cliente: cli(), presupuesto_id: (fields["presupuesto_id"] as string) ?? null, clinica_id: cl?.id ?? null,
      paciente_nombre: fields["paciente_nombre"] ?? null, telefono: fields["telefono"] ?? null,
      tratamiento: fields["tratamiento"] ?? null, tipo_evento: fields["tipo_evento"] ?? null,
      estado: fields["estado"] ?? null, mensaje_generado: fields["mensaje_generado"] ?? null,
      tono_usado: fields["tono_usado"] ?? null, canal_sugerido: fields["canal_sugerido"] ?? null,
      actualizado_en: fields["actualizado_en"] ? new Date(String(fields["actualizado_en"])) : new Date(),
    } as any).execute();
  });
}
const CFG_SELECT = `select c.*, cl.nombre as _cli_nombre from configuracion_automatizaciones c
  left join clinicas cl on cl.cliente = c.cliente and cl.id = c.clinica_id`;
function cfgShim(r: any) {
  const f: Record<string, unknown> = {
    clinica: r._cli_nombre ?? undefined, activa: r.activa,
    dias_inactividad_alerta: r.dias_inactividad_alerta ?? undefined,
    dias_portal_sin_respuesta: r.dias_portal_sin_respuesta ?? undefined,
    dias_reactivacion: r.dias_reactivacion ?? undefined, modo_whatsapp: r.modo_whatsapp ?? undefined,
  };
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return { id: r.id, fields: f, get: (k: string) => f[k] };
}
export async function findConfigPorClinicaRawPg(clinica: string): Promise<any | null> {
  return runWithClienteDb(cli(), async (trx) => {
    const r: any = await sql.raw(`${CFG_SELECT} where cl.nombre = '${clinica.replace(/'/g, "''")}' limit 1`).execute(trx);
    return r.rows[0] ? cfgShim(r.rows[0]) : null;
  });
}
export async function listConfigsRawPg(clinicaFormula?: string | null): Promise<any[]> {
  const clinicas = clinicaFormula ? [...clinicaFormula.matchAll(/\{clinica\}='([^']+)'/g)].map((m) => m[1]) : [];
  return runWithClienteDb(cli(), async (trx) => {
    const w = clinicas.length ? `where cl.nombre in (${clinicas.map((c) => `'${c.replace(/'/g, "''")}'`).join(",")})` : "";
    const r: any = await sql.raw(`${CFG_SELECT} ${w} order by c.created_at asc limit 100`).execute(trx);
    return (r.rows as any[]).map(cfgShim);
  });
}
export async function listConfigsProcesarRawPg(): Promise<any[]> {
  return listConfigsRawPg(null);
}
export async function updateConfigRawPg(id: string, fields: Record<string, unknown>): Promise<void> {
  const M: Record<string, string> = { activa: "activa", dias_inactividad_alerta: "dias_inactividad_alerta", dias_portal_sin_respuesta: "dias_portal_sin_respuesta", dias_reactivacion: "dias_reactivacion", modo_whatsapp: "modo_whatsapp", actualizado_en: "actualizado_en" };
  const set: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(M)) if (fields[k] !== undefined) set[c] = k === "actualizado_en" ? new Date(String(fields[k])) : fields[k];
  await runWithClienteDb(cli(), (trx) => trx.updateTable("configuracion_automatizaciones").set(set as any).where("id", "=", id).execute());
}
export async function createConfigRawPg(fields: Record<string, unknown>): Promise<void> {
  await runWithClienteDb(cli(), async (trx) => {
    const nombre = fields["clinica"] ? String(fields["clinica"]) : null;
    const cl = nombre ? await trx.selectFrom("clinicas").select("id").where("nombre", "=", nombre).executeTakeFirst() : null;
    await trx.insertInto("configuracion_automatizaciones").values({
      cliente: cli(), clinica_id: cl?.id ?? null, activa: fields["activa"] ?? true,
      dias_inactividad_alerta: fields["dias_inactividad_alerta"] ?? null,
      dias_portal_sin_respuesta: fields["dias_portal_sin_respuesta"] ?? null,
      dias_reactivacion: fields["dias_reactivacion"] ?? null, modo_whatsapp: fields["modo_whatsapp"] ?? null,
      actualizado_en: fields["actualizado_en"] ? new Date(String(fields["actualizado_en"])) : new Date(),
    } as any).execute();
  });
}
