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
import { mesISO, hoyISO, inicioDelDiaUTC } from "../app/lib/time";
import {
  estadoConversacion,
  UMBRAL_REACTIVACION_DIAS,
} from "../app/lib/presupuestos/estado-conversacion";

// UN instante para toda la corrida, pasado explícitamente al dashboard Y a la
// derivación de contraste. Hasta el 2026-07-31 cada lado llamaba a `Date.now()`
// por su cuenta y el umbral era una ventana rodante al segundo: un caso que
// cruzara entre las dos lecturas hacía fallar la paridad sin que nada
// estuviera roto. Y `calcularDashboardRed({ahora})` ni siquiera llegaba a la
// franja de riesgo — era un parámetro muerto.
const AHORA = new Date();

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

  const d = await runWithCliente("DEMO", () => calcularDashboardRed({ clinicaIds: null, ahora: AHORA }));

  // Mes de la CLÍNICA, y resta sobre el calendario — no con `setMonth`.
  // Este test daba ROJO en un producto sano los días 29, 30 y 31: `setMonth(-1)`
  // sobre un 31 de julio pide "31 de junio", que no existe, y JavaScript lo
  // rueda al 1 de julio → el "mes previo" era el mes ACTUAL, así que dos
  // comprobaciones se comparaban contra sí mismas. Mismo defecto que MEJORAS 52
  // por otra puerta, y en la herramienta en vez de en el producto (§9: una
  // herramienta que informa mal cuesta más que el bug que buscaba).
  const mesActual = mesISO(AHORA);
  const mesPrevio = (() => {
    const y = Number(mesActual.slice(0, 4));
    const m = Number(mesActual.slice(5, 7)) - 2; // -1 mes, -1 por el índice 0
    const anio = y + Math.floor(m / 12);
    return `${anio}-${String((((m % 12) + 12) % 12) + 1).padStart(2, "0")}`;
  })();

  // ── Sección 4 · progreso: Σ aceptado por mes vs SQL ──
  console.log("\nS4 · € aceptado por mes (6 meses) vs SQL");
  const sqlMeses = await q(`
    select to_char(fecha_aceptado::date, 'YYYY-MM') mes, coalesce(sum(importe),0)::numeric s
    from presupuestos where estado='ACEPTADO' and fecha_aceptado is not null
    group by 1`);
  const sqlPorMes = new Map(sqlMeses.map((r: any) => [r.mes, Number(r.s)]));
  const sqlCobros = await q(`
    select to_char(fecha_pago::date, 'YYYY-MM') mes, coalesce(sum(importe),0)::numeric s
    from pagos_paciente group by 1`);
  const sqlCobrosPorMes = new Map(sqlCobros.map((r: any) => [r.mes, Number(r.s)]));
  for (const p of d.progreso) {
    ok(`  ${p.mes}: aceptado ${p.total} €`, p.total === (sqlPorMes.get(p.mes) ?? 0),
      `SQL: ${sqlPorMes.get(p.mes) ?? 0}`);
    ok(`  ${p.mes}: cobrado ${p.cobros} €`, p.cobros === (sqlCobrosPorMes.get(p.mes) ?? 0),
      `SQL: ${sqlCobrosPorMes.get(p.mes) ?? 0}`);
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
  // MISMO TRAMO (días 1..hoy), que es la regla del producto desde el
  // 2026-07-27. Compararlo contra el mes ENTERO era darle por bueno al
  // dashboard justo el error que esa decisión mató (MEJORAS 88).
  const diaHoy = Number(hoyISO(AHORA).slice(8, 10));
  const [cobPrev] = await q(
    `select coalesce(sum(importe),0)::numeric s from pagos_paciente
     where to_char(fecha_pago::date,'YYYY-MM')=$1
       and extract(day from fecha_pago::date) <= $2`, [mesPrevio, diaHoy]);
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
       and to_char(fecha,'YYYY-MM')=$1
       and extract(day from fecha) <= $2`, [mesPrevio, diaHoy]);
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
      UMBRAL_REACTIVACION_DIAS.presupuesto,
      AHORA,
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

  // ── La gráfica de 6 meses NO depende del día del mes (MEJORAS 88) ──
  //
  // El bug vivía en una ventana de DOS DÍAS al mes: la serie se recortaba con
  // `enTramo`, así que el día 1 los cinco meses cerrados marcaban 0 € y solo
  // era correcta a final de mes. Nadie lo iba a probar a mano — exactamente
  // como el de las zonas horarias. Se simula el reloj en tres días distintos
  // y los meses CERRADOS tienen que dar lo mismo en los tres.
  console.log("\nS6 · la serie de 6 meses no depende del día del mes");
  const seriePorDia = new Map<number, Map<string, number>>();
  for (const dia of [1, 2, 15]) {
    const simulado = new Date(inicioDelDiaUTC(`${mesActual}-${String(dia).padStart(2, "0")}`).getTime() + 12 * 3_600_000);
    const dd = await runWithCliente("DEMO", () =>
      calcularDashboardRed({ clinicaIds: null, ahora: simulado }));
    seriePorDia.set(dia, new Map(dd.progreso.map((p) => [p.mes, p.total])));
  }
  // Meses cerrados = todos menos el actual (el en curso SÍ debe crecer con los días).
  const cerrados = [...seriePorDia.get(15)!.keys()].filter((m) => m !== mesActual);
  for (const mes of cerrados) {
    const vals = [1, 2, 15].map((d) => seriePorDia.get(d)!.get(mes) ?? 0);
    ok(
      `  ${mes}: mismo € mirando el día 1, el 2 y el 15`,
      new Set(vals).size === 1 && vals[0] === (sqlPorMes.get(mes) ?? 0),
      `día1=${vals[0]} · día2=${vals[1]} · día15=${vals[2]} · SQL=${sqlPorMes.get(mes) ?? 0}`,
    );
  }
  // Y el contraste: la fórmula vieja SÍ dependía del día. Se demuestra, no se
  // supone — con `enTramo` el día 1 solo entraba lo fechado el día 1.
  const conTramoDia1 = (await q(
    `select coalesce(sum(importe),0)::numeric s from presupuestos
     where estado='ACEPTADO' and to_char(fecha_aceptado::date,'YYYY-MM')=$1
       and extract(day from fecha_aceptado::date) <= 1`, [cerrados[0]]))[0];
  const viejoDia1 = Number(conTramoDia1.s);
  const realCerrado = sqlPorMes.get(cerrados[0]!) ?? 0;
  ok(
    `contraste: la fórmula vieja habría dado ${viejoDia1} € en ${cerrados[0]} el día 1, no ${realCerrado} €`,
    viejoDia1 !== realCerrado,
    viejoDia1 === realCerrado ? "este mes no distingue las dos fórmulas; el contraste no prueba nada" : "",
  );

  await c.query("rollback");
  await c.end();

  console.log(fallos === 0 ? "\nVERDE — paridad dashboard↔origen verificada" : `\nROJO — ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
