// app/lib/pagos-pg.ts — FASE 2: dominio Pagos sobre Postgres.
// Nota D8: en PG desaparece el espejo Paciente_RecordId — paciente_id es la
// única fuente. usuario_id (link a Usuarios central) queda null hasta que
// Identidad voltee (misma decisión que acciones_lead.usuario_id).
import { sql } from "kysely";
import { runWithClienteDb } from "./db/context";
import { currentCliente, type Cliente } from "./airtable";
import type { MetodoPago, TipoPago, Pago } from "./pagos-format";
import { listResumenFinancieroPorIds, sumPendientePorIds, syncFinancieroPaciente } from "./pacientes/pacientes";
import type { PagoResumen } from "./pagos";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[pagos-pg] sin cliente (fail-closed)");
  return c;
}
const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
const d10 = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

function rowToPago(r: any): Pago {
  return {
    id: r.id, pacienteId: r.paciente_id ?? "",
    fechaPago: d10(r.fecha_pago), importe: Number(r.importe ?? 0),
    metodo: String(r.metodo ?? "Otro") as MetodoPago, tipo: String(r.tipo ?? "Liquidacion") as TipoPago,
    nota: r.nota ?? null, createdAt: iso(r.created_at), usuarioCreadorId: r.usuario_creador_id ?? null,
  };
}

export async function getPagosByPacientePg(pacienteId: string): Promise<Pago[]> {
  if (!pacienteId) return [];
  try {
    return await runWithClienteDb(cli(), async (trx) => {
      const rows = await trx.selectFrom("pagos_paciente").selectAll()
        .where("paciente_id", "=", pacienteId)
        .orderBy("fecha_pago", "desc").orderBy("id", "desc").execute();
      return rows.map(rowToPago);
    });
  } catch (err) { console.error("[pagos-pg] getPagosByPaciente:", err); return []; }
}

export async function listPagosResumenPg(opts: { desdeExclusivoIso?: string; hastaExclusivoIso?: string } = {}): Promise<PagoResumen[]> {
  return runWithClienteDb(cli(), async (trx) => {
    let q = trx.selectFrom("pagos_paciente").selectAll();
    if (opts.desdeExclusivoIso) q = q.where("fecha_pago", ">", opts.desdeExclusivoIso as any);
    if (opts.hastaExclusivoIso) q = q.where("fecha_pago", "<", opts.hastaExclusivoIso as any);
    const rows = await q.execute();
    return rows.map((r: any) => ({
      pacienteRecordId: r.paciente_id ?? "", importe: Number(r.importe ?? 0),
      metodo: r.metodo ?? "", tipo: r.tipo ?? "", fechaPago: d10(r.fecha_pago),
    }));
  });
}

async function pagosEntre(desdeShift: string, hastaShift: string): Promise<Pago[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("pagos_paciente").selectAll()
      .where("fecha_pago", ">", desdeShift as any).where("fecha_pago", "<", hastaShift as any).execute();
    return rows.map(rowToPago);
  });
}
const shiftDay = (isoD: string, days: number) => {
  const d = new Date(isoD + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function getFacturadoEnPeriodoPg(args: {
  desde: Date; hasta: Date; soloOrigenLead?: boolean; clinicaId?: string;
}): Promise<{ total: number; pendiente: number; pagosCount: number }> {
  let pagos: Pago[];
  try {
    pagos = await pagosEntre(shiftDay(args.desde.toISOString().slice(0, 10), -1), shiftDay(args.hasta.toISOString().slice(0, 10), 1));
  } catch (err) { console.error("[pagos-pg] getFacturadoEnPeriodo:", err); return { total: 0, pendiente: 0, pagosCount: 0 }; }
  if (pagos.length === 0) return { total: 0, pendiente: 0, pagosCount: 0 };
  const pacIds = Array.from(new Set(pagos.map((p) => p.pacienteId).filter(Boolean)));
  if (!args.soloOrigenLead && !args.clinicaId) {
    const total = pagos.reduce((s, p) => s + p.importe, 0);
    const pendiente = await sumPendientePorIds(pacIds);
    return { total, pendiente, pagosCount: pagos.length };
  }
  if (pacIds.length === 0) return { total: 0, pendiente: 0, pagosCount: 0 };
  let resumen; try { resumen = await listResumenFinancieroPorIds(pacIds); }
  catch (err) { console.error("[pagos-pg] crossing pacientes:", err); return { total: 0, pendiente: 0, pagosCount: 0 }; }
  const pacAllowed = new Set<string>(); let pendienteSum = 0;
  for (const p of resumen) {
    const okP = (!args.clinicaId || p.clinicaIds.includes(args.clinicaId)) && (!args.soloOrigenLead || p.tieneLeadOrigen);
    if (okP) { pacAllowed.add(p.id); pendienteSum += p.pendiente; }
  }
  const filtrados = pagos.filter((p) => pacAllowed.has(p.pacienteId));
  return { total: filtrados.reduce((s, p) => s + p.importe, 0), pendiente: pendienteSum, pagosCount: filtrados.length };
}

export async function getFacturadoPorPacientesPg(args: { pacienteIds: string[]; desde: Date; hasta: Date }): Promise<{ total: number; pendiente: number; pagosCount: number }> {
  if (args.pacienteIds.length === 0) return { total: 0, pendiente: 0, pagosCount: 0 };
  const desdeShift = shiftDay(args.desde.toISOString().slice(0, 10), -1);
  const hastaShift = shiftDay(args.hasta.toISOString().slice(0, 10), 1);
  const r = await runWithClienteDb(cli(), async (trx) => {
    const row = await trx.selectFrom("pagos_paciente")
      .select([sql<string>`coalesce(sum(importe),0)`.as("total"), sql<string>`count(*)`.as("n")])
      .where("fecha_pago", ">", desdeShift as any).where("fecha_pago", "<", hastaShift as any)
      .where("paciente_id", "in", args.pacienteIds).executeTakeFirst();
    return { total: Number(row?.total ?? 0), n: Number(row?.n ?? 0) };
  });
  const pendiente = await sumPendientePorIds(args.pacienteIds);
  return { total: r.total, pendiente, pagosCount: r.n };
}

async function logAccionPagoPgIntern(trxCliente: Cliente, a: {
  pagoId: string; pacienteId: string; tipo: string; importeAntes?: number | null;
  importeDespues?: number | null; usuarioId?: string | null; notaCambio?: string;
}): Promise<void> {
  try {
    await runWithClienteDb(trxCliente, (trx) =>
      trx.insertInto("acciones_pago").values({
        cliente: trxCliente,
        resumen: `${a.tipo} · ${a.pagoId.slice(0, 6)} · paciente ${a.pacienteId.slice(0, 6)}`,
        pago_id: a.tipo === "Eliminar" ? null : a.pagoId, tipo: a.tipo, fecha: new Date(),
        importe_antes: a.importeAntes ?? null, importe_despues: a.importeDespues ?? null,
        usuario_id: null /* Identidad aún Airtable */, nota_cambio: a.notaCambio ?? null,
      } as any).execute());
  } catch (err) { console.error("[pagos-pg] logAccionPago:", err); }
}

export async function crearPagoPg(args: {
  pacienteId: string; importe: number; fechaPago?: string; metodo?: MetodoPago;
  tipo?: TipoPago; nota?: string; usuarioCreadorId?: string;
}): Promise<Pago> {
  const c = cli();
  const fechaPago = args.fechaPago ?? new Date().toISOString().slice(0, 10);
  const metodo = args.metodo ?? "Otro"; const tipo = args.tipo ?? "Liquidacion";
  const row = await runWithClienteDb(c, (trx) =>
    trx.insertInto("pagos_paciente").values({
      cliente: c, resumen: `${metodo} · ${fechaPago} · ${args.importe.toFixed(2)}€`,
      paciente_id: args.pacienteId, fecha_pago: fechaPago, importe: args.importe,
      metodo, tipo, nota: args.nota ?? null, usuario_creador_id: null,
    } as any).returningAll().executeTakeFirstOrThrow());
  const pago = rowToPago(row);
  const { getPagosByPaciente } = await import("./pagos");
  const pagos = await getPagosByPaciente(args.pacienteId);
  await syncFinancieroPaciente(args.pacienteId, pagos.reduce((s, p) => s + (p.importe || 0), 0));
  await logAccionPagoPgIntern(c, { pagoId: pago.id, pacienteId: args.pacienteId, tipo: "Crear", importeAntes: null, importeDespues: args.importe, usuarioId: args.usuarioCreadorId ?? null, notaCambio: args.nota });
  return pago;
}

export async function actualizarPagoPg(pagoId: string, patch: Partial<{
  importe: number; fechaPago: string; metodo: MetodoPago; tipo: TipoPago; nota: string | null;
}>, context: { usuarioId?: string | null } = {}): Promise<Pago> {
  const c = cli();
  const before = await runWithClienteDb(c, (trx) =>
    trx.selectFrom("pagos_paciente").selectAll().where("id", "=", pagoId).executeTakeFirstOrThrow());
  const importeAntes = Number(before.importe ?? 0) || 0;
  const pacienteId = before.paciente_id ?? "";
  const set: Record<string, unknown> = {};
  if (patch.importe !== undefined) set.importe = patch.importe;
  if (patch.fechaPago !== undefined) set.fecha_pago = patch.fechaPago;
  if (patch.metodo !== undefined) set.metodo = patch.metodo;
  if (patch.tipo !== undefined) set.tipo = patch.tipo;
  if (patch.nota !== undefined) set.nota = patch.nota ?? "";
  if (patch.importe !== undefined || patch.fechaPago !== undefined || patch.metodo !== undefined) {
    const fechaPago = patch.fechaPago ?? d10(before.fecha_pago);
    const metodo = patch.metodo ?? String(before.metodo ?? "Otro");
    const importe = patch.importe ?? importeAntes;
    set.resumen = `${metodo} · ${fechaPago} · ${importe.toFixed(2)}€`;
  }
  const updated = await runWithClienteDb(c, (trx) =>
    trx.updateTable("pagos_paciente").set(set as any).where("id", "=", pagoId).returningAll().executeTakeFirstOrThrow());
  if (pacienteId) {
    const { getPagosByPaciente } = await import("./pagos");
    const pagos = await getPagosByPaciente(pacienteId);
    await syncFinancieroPaciente(pacienteId, pagos.reduce((s, p) => s + (p.importe || 0), 0));
  }
  await logAccionPagoPgIntern(c, { pagoId, pacienteId, tipo: "Editar", importeAntes, importeDespues: Number(updated.importe ?? 0) || 0, usuarioId: context.usuarioId ?? null });
  return rowToPago(updated);
}

export async function eliminarPagoPg(pagoId: string, context: { usuarioId?: string | null } = {}): Promise<void> {
  const c = cli();
  const before = await runWithClienteDb(c, (trx) =>
    trx.selectFrom("pagos_paciente").selectAll().where("id", "=", pagoId).executeTakeFirstOrThrow());
  const importeAntes = Number(before.importe ?? 0) || 0;
  const pacienteId = before.paciente_id ?? "";
  await logAccionPagoPgIntern(c, { pagoId, pacienteId, tipo: "Eliminar", importeAntes, importeDespues: null, usuarioId: context.usuarioId ?? null, notaCambio: `Pago ${before.tipo ?? ""} de ${importeAntes}€ eliminado` });
  await runWithClienteDb(c, (trx) => trx.deleteFrom("pagos_paciente").where("id", "=", pagoId).execute());
  if (pacienteId) {
    const { getPagosByPaciente } = await import("./pagos");
    const pagos = await getPagosByPaciente(pacienteId);
    await syncFinancieroPaciente(pacienteId, pagos.reduce((s, p) => s + (p.importe || 0), 0));
  }
}

export async function reconciliarPagosCachePg(): Promise<{ procesados: number; ok: number; errores: number }> {
  const c = cli();
  const ids = await runWithClienteDb(c, async (trx) => {
    const rows = await trx.selectFrom("pagos_paciente").select("paciente_id").distinct().execute();
    return rows.map((r) => r.paciente_id).filter(Boolean) as string[];
  });
  let ok = 0, errores = 0;
  const { getPagosByPaciente } = await import("./pagos");
  for (const pid of ids) {
    try {
      const pagos = await getPagosByPaciente(pid);
      await syncFinancieroPaciente(pid, pagos.reduce((s, p) => s + (p.importe || 0), 0));
      ok++;
    } catch (err) { console.error(`[reconciliar-pg] paciente ${pid}:`, err); errores++; }
  }
  return { procesados: ids.length, ok, errores };
}
