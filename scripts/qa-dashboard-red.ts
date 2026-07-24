#!/usr/bin/env node
// Bloque 2 — QA de PARIDAD del dashboard de Red: cada número cotejado
// contra su origen en DEMO por SQL independiente (protocolo de siempre).
//
//   npx tsx scripts/qa-dashboard-red.ts
//
// Además: RLS — todas las clínicas del resultado pertenecen al cliente DEMO
// (las sumas SQL ya van scoped por app.cliente, así que la paridad ES la
// verificación de tenant), y sin contexto de cliente el cálculo falla
// (fail-closed), nunca devuelve datos de otro.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

// Flags espejo de producción: identidad incluida — sin ella listClinicas cae
// a la base central de Airtable (otro espacio de IDs) y la paridad de
// clínicas no puede cuadrar.
process.env.DATA_BACKEND_PG_DOMINIOS = "identidad,presupuestos,mensajes,leads,pagos,pacientes,configuraciones";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { calcularDashboardRed } from "../app/lib/dashboard-red";
import {
  estadoConversacion,
  UMBRAL_REACTIVACION_MS,
} from "../app/lib/presupuestos/estado-conversacion";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`);
  if (!c) fallos++;
};

async function main() {
  const url = process.env.SUPABASE_DB_URL_APP;
  if (!url) throw new Error("SUPABASE_DB_URL_APP requerida");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("begin");
  await c.query("select set_config('app.cliente','DEMO',true)");
  const q = async (sql: string, params: any[] = []) => (await c.query(sql, params)).rows;

  const d = await runWithCliente("DEMO", () => calcularDashboardRed({ clinicaIds: null }));

  const mesActual = new Date().toISOString().slice(0, 7);
  const prevDate = new Date();
  prevDate.setMonth(prevDate.getMonth() - 1);
  const mesPrevio = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // ── Sección 4 · progreso: Σ aceptado por mes vs SQL ──
  console.log("\nS4 · € aceptado por mes (6 meses) vs SQL");
  const sqlMeses = await q(`
    select to_char(fecha_aceptado::date, 'YYYY-MM') mes, coalesce(sum(importe),0)::numeric s
    from presupuestos where estado='ACEPTADO' and fecha_aceptado is not null
    group by 1`);
  const sqlPorMes = new Map(sqlMeses.map((r: any) => [r.mes, Number(r.s)]));
  for (const p of d.progreso) {
    ok(`  ${p.mes}: ${p.importe} €`, p.importe === (sqlPorMes.get(p.mes) ?? 0),
      `SQL: ${sqlPorMes.get(p.mes) ?? 0}`);
  }

  // ── Sección 2 · negocio vs SQL ──
  console.log("\nS2 · números del negocio vs SQL");
  const [acepMes] = await q(
    `select count(*)::int n, coalesce(sum(importe),0)::numeric s from presupuestos
     where estado='ACEPTADO' and to_char(fecha_aceptado::date,'YYYY-MM')=$1`, [mesActual]);
  ok(`aceptados mes = ${d.negocio.presupuestos.aceptadosMes.valor}`, d.negocio.presupuestos.aceptadosMes.valor === acepMes.n, `SQL: ${acepMes.n}`);
  ok(`€ aceptado mes = ${d.negocio.presupuestos.aceptadosImporteMes.valor}`, d.negocio.presupuestos.aceptadosImporteMes.valor === Number(acepMes.s), `SQL: ${acepMes.s}`);
  const [cobMes] = await q(
    `select coalesce(sum(importe),0)::numeric s from pagos_paciente
     where to_char(fecha_pago::date,'YYYY-MM')=$1`, [mesActual]);
  ok(`cobrado mes = ${d.negocio.cobros.cobradoMes.valor}`, d.negocio.cobros.cobradoMes.valor === Number(cobMes.s), `SQL: ${cobMes.s}`);
  const [cobPrev] = await q(
    `select coalesce(sum(importe),0)::numeric s from pagos_paciente
     where to_char(fecha_pago::date,'YYYY-MM')=$1`, [mesPrevio]);
  ok(`cobrado mes previo = ${d.negocio.cobros.cobradoMes.previo}`, d.negocio.cobros.cobradoMes.previo === Number(cobPrev.s), `SQL: ${cobPrev.s}`);
  const [pend] = await q(`
    select coalesce(sum(x.pendiente),0)::numeric s from (
      select p.paciente_id, greatest(0, sum(p.importe) - coalesce((
        select sum(pg2.importe) from pagos_paciente pg2 where pg2.paciente_id = p.paciente_id), 0)) pendiente
      from presupuestos p where p.estado='ACEPTADO' group by p.paciente_id
    ) x`);
  ok(`pendiente total = ${d.negocio.cobros.pendiente}`, d.negocio.cobros.pendiente === Number(pend.s), `SQL: ${pend.s}`);
  const [perdMes] = await q(
    `select count(*)::int n from historial_acciones
     where tipo='cambio_estado' and metadata like '%PERDIDO%'
       and to_char(fecha,'YYYY-MM')=$1`, [mesActual]);
  ok(`perdidos mes = ${d.negocio.presupuestos.perdidosMes.valor}`, d.negocio.presupuestos.perdidosMes.valor === perdMes.n, `SQL: ${perdMes.n}`);
  const [perdPrev] = await q(
    `select count(*)::int n from historial_acciones
     where tipo='cambio_estado' and metadata like '%PERDIDO%'
       and to_char(fecha,'YYYY-MM')=$1`, [mesPrevio]);
  ok(`perdidos mes previo = ${d.negocio.presupuestos.perdidosMes.previo}`, d.negocio.presupuestos.perdidosMes.previo === perdPrev.n, `SQL: ${perdPrev.n}`);
  const [nuevosMes] = await q(
    `select count(*)::int n from leads where to_char(created_at,'YYYY-MM')=$1`, [mesActual]);
  ok(`leads nuevos mes = ${d.negocio.leads.nuevosMes.valor}`, d.negocio.leads.nuevosMes.valor === nuevosMes.n, `SQL: ${nuevosMes.n}`);

  // ── Sección 1 · riesgo vs recomputación independiente ──
  console.log("\nS1 · línea de riesgo vs origen");
  // Leads sin primer contacto: activos sin mensajes NI acciones.
  const [sinCont] = await q(`
    select count(*)::int n from leads l
    where l.estado in ('Nuevo','Contactado','Citado','Citados Hoy') and not l.convertido_a_paciente
      and not exists(select 1 from mensajes_whatsapp m where m.lead_id=l.id)
      and not exists(select 1 from acciones_lead a where a.lead_id=l.id)`);
  const riesgoSinCont = d.hoy.riesgo.find((r) => r.tipo === "sin_contacto");
  ok(`leads sin primer contacto = ${riesgoSinCont?.n ?? 0}`, (riesgoSinCont?.n ?? 0) === sinCont.n, `SQL: ${sinCont.n}`);

  // Reactivables: clasificación recompuesta desde SQL crudo + función pura.
  const abiertos = await q(`
    select p.id, p.importe, p.intencion_detectada, p.fecha_ultima_respuesta, p.ultima_accion_registrada, p.tipo_ultima_accion,
      (select max(m.timestamp) from mensajes_whatsapp m where m.presupuesto_id=p.id and m.direccion='Entrante') ent,
      (select max(m.timestamp) from mensajes_whatsapp m where m.presupuesto_id=p.id and m.direccion='Saliente') sal
    from presupuestos p where p.estado not in ('ACEPTADO','PERDIDO')`);
  const TIPOS = new Set(["WhatsApp enviado", "Llamada realizada", "Sin respuesta tras llamada"]);
  const CIERRE = new Set(["Acepta sin condiciones", "Acepta pero pregunta pago"]);
  let reactN = 0;
  let reactImp = 0;
  let cierreN = 0;
  let cierreImp = 0;
  for (const r of abiertos) {
    const iso = (v: any) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
    const fur = iso(r.fecha_ultima_respuesta);
    const ent = iso(r.ent);
    const accion = r.ultima_accion_registrada && TIPOS.has(String(r.tipo_ultima_accion ?? "")) ? iso(r.ultima_accion_registrada) : null;
    const entrante = !ent || (fur && fur > ent) ? fur : ent;
    const conv = estadoConversacion(
      { ultimoEntranteAt: entrante, ultimoSalienteAt: iso(r.sal), ultimaAccionSalienteAt: accion },
      UMBRAL_REACTIVACION_MS.presupuesto,
    );
    if (conv.estado === "reactivable") {
      reactN++;
      reactImp += Number(r.importe ?? 0) || 0;
    }
    if (conv.estado === "pendiente_responder" && CIERRE.has(String(r.intencion_detectada ?? ""))) {
      cierreN++;
      cierreImp += Number(r.importe ?? 0) || 0;
    }
  }
  const riesgoReact = d.hoy.riesgo.find((r) => r.tipo === "reactivables");
  ok(`reactivables n = ${riesgoReact?.n ?? 0}`, (riesgoReact?.n ?? 0) === reactN, `SQL: ${reactN}`);
  ok(`reactivables € = ${riesgoReact?.importe ?? 0}`, (riesgoReact?.importe ?? 0) === reactImp, `SQL: ${reactImp}`);

  // Vencidos: regla de cobros recompuesta (plazo global 90, >7d, sin Liquidación).
  const vencSql = await q(`
    select x.paciente_id, x.firmado, coalesce(pg.pagado,0) pagado, coalesce(pg.liq,0) liq, x.fmin
    from (
      select paciente_id, sum(importe) firmado, min(coalesce(fecha_aceptado::date, fecha_alta::date)) fmin
      from presupuestos where estado='ACEPTADO' group by paciente_id
    ) x
    left join (
      select paciente_id, sum(importe) pagado, count(*) filter (where tipo='Liquidacion') liq
      from pagos_paciente group by paciente_id
    ) pg on pg.paciente_id = x.paciente_id`);
  let vencImp = 0;
  const DAY = 86400_000;
  for (const r of vencSql) {
    const pendiente = Math.max(0, Number(r.firmado) - Number(r.pagado));
    if (pendiente <= 0 || !r.fmin) continue;
    const vence = new Date(r.fmin).getTime() + 90 * DAY;
    const diasVenc = Math.floor((Date.now() - vence) / DAY);
    if (diasVenc > 7 && Number(r.liq) === 0) vencImp += pendiente;
  }
  const riesgoVenc = d.hoy.riesgo.find((r) => r.tipo === "vencidos");
  ok(`vencidos € = ${riesgoVenc?.importe ?? 0}`, (riesgoVenc?.importe ?? 0) === vencImp, `SQL: ${vencImp}`);
  const riesgoCierre = d.hoy.riesgo.find((r) => r.tipo === "cierre_sin_accion");
  ok(`cierre sin acción n = ${riesgoCierre?.n ?? 0}`, (riesgoCierre?.n ?? 0) === cierreN, `SQL: ${cierreN}`);
  ok(`cierre sin acción € = ${riesgoCierre?.importe ?? 0}`, (riesgoCierre?.importe ?? 0) === cierreImp, `SQL: ${cierreImp}`);

  // ── RLS ──
  console.log("\nRLS · tenant");
  const clinicasDemo = new Set((await q(`select id from clinicas`)).map((r: any) => r.id));
  ok("todas las clínicas del dashboard son del cliente DEMO",
    d.clinicas.every((cl) => clinicasDemo.has(cl.id)) && d.clinicas.length > 0,
    `${d.clinicas.length} clínicas`);
  let failClosed = false;
  try {
    await calcularDashboardRed({ clinicaIds: null }); // sin runWithCliente
  } catch {
    failClosed = true;
  }
  ok("sin contexto de cliente → falla (fail-closed), nunca datos de otro", failClosed);

  await c.query("rollback");
  await c.end();

  console.log(fallos === 0 ? "\nVERDE — paridad dashboard↔origen verificada" : `\nROJO — ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
