#!/usr/bin/env node
// FASE 2 · GATE FINAL — QA adversarial del Sprint B contra Postgres + RLS.
//
//   node scripts/qa-rls-sprint-b.mjs
//
// Re-corre los 5 escenarios de SPRINT-B-QA.md a nivel de MOTOR (RLS), como el
// rol real de la app (fyllio_app, NOBYPASSRLS), INTENTANDO ACTIVAMENTE saltarse
// el aislamiento (mandamiento §5). Con datos reconocibles [QA_SB] en RB, INDEP y
// DEMO — un preview vacío da falsos aprobados.
//
// Este harness cubre lo que RLS garantiza a nivel de motor:
//   · Escenario 1  — cliente↔cliente (lo más crítico): un cliente NO ve, NO
//                    modifica y NO borra filas de otro, en NINGUNA tabla.
//   · Escenario 3  — IDOR por id: leer una fila de otro cliente por su id → 0.
//   · Escenario 4  — identidad: usuario_clinicas es cliente-scoped; usuarios es
//                    cross-cliente POR DISEÑO (login email+PIN) — se documenta.
//   · Escenario 5  — copilot: mensajes/llamadas/conversaciones de otro cliente → 0.
// El aislamiento clínica↔clínica (Escenario 2) NO vive en RLS todavía — es
// app-level (repos). Se prueba aparte con qa-clinica-pg.mjs (código real sobre PG).
//
// No deja residuos: cada fila [QA_SB] se borra por id al final (y al empezar).

import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const url = process.env.SUPABASE_DB_URL_APP;
if (!url) { console.error("Falta SUPABASE_DB_URL_APP"); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, max: 3, ssl: { rejectUnauthorized: false } });
const MARK = "[QA_SB]";
const CLIENTES = ["RB", "INDEP", "DEMO"];

let fallos = 0, pasos = 0;
const ok = (n, c, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ── ejecutar dentro de una transacción con contexto de cliente (SET LOCAL) ──
async function enTrx(cliente, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (cliente) await c.query("select set_config('app.cliente', $1, true)", [cliente]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
// intento que puede fallar por RLS/CHECK/FK — devuelve "ok" o el código de error
async function intento(cliente, sql, params = []) {
  try { await enTrx(cliente, (c) => c.query(sql, params)); return "ok"; }
  catch (e) { return e.code ?? "err"; }
}

// ── SEED reconocible por cliente (importe distinto por cliente: reconocible) ──
const IMPORTE = { RB: 77777, INDEP: 88888, DEMO: 99999 };
const ids = {}; // ids[cliente] = { clinica, usuario, uclinica, paciente, presupuesto, lead, mensaje, llamada, conversacion }

async function limpiar() {
  // Borra por marca en ORDEN FK-SEGURO (hijos → padres), dentro del contexto de
  // cada cliente. NO se traga errores: un fallo de limpieza se reporta (§9) — un
  // residuo silencioso falsea el recuento del siguiente run.
  const P = MARK + "%";
  // usuarios es cross-cliente (p_identidad using true): su borrado se ESCOPA al
  // cliente en contexto ($2), o intentaría borrar los usuarios de otros clientes
  // cuyos usuario_clinicas hijos no son visibles/borrables aquí (FK).
  const pasos = [
    ["usuario_clinicas", `delete from usuario_clinicas where clinica_id in (select id from clinicas where nombre like $1) or usuario_id in (select id from usuarios where nombre like $1)`],
    ["presupuestos", `delete from presupuestos where notas like $1`],
    ["pacientes", `delete from pacientes where nombre like $1`],
    ["leads", `delete from leads where nombre like $1`],
    ["mensajes_whatsapp", `delete from mensajes_whatsapp where contenido like $1`],
    ["llamadas_vapi", `delete from llamadas_vapi where resumen like $1`],
    ["conversaciones_copilot", `delete from conversaciones_copilot where resumen like $1`],
    ["clinicas", `delete from clinicas where nombre like $1`],
    ["usuarios", `delete from usuarios where nombre like $1 and cliente = $2`],
  ];
  for (const cl of CLIENTES) {
    await enTrx(cl, async (c) => { for (const [t, q] of pasos) await c.query(q, t === "usuarios" ? [P, cl] : [P]); });
  }
}

async function sembrar() {
  for (const cl of CLIENTES) {
    ids[cl] = await enTrx(cl, async (c) => {
      const one = async (sql, params) => (await c.query(sql, params)).rows[0].id;
      const clinica = await one(`insert into clinicas (cliente, nombre, ciudad) values ($1,$2,$3) returning id`, [cl, `${MARK} Clínica ${cl}`, cl]);
      const usuario = await one(`insert into usuarios (cliente, nombre, email) values ($1,$2,$3) returning id`, [cl, `${MARK} Admin ${cl}`, `qa-sb-${cl.toLowerCase()}@fyllio.test`]);
      const uclinica = await one(`insert into usuario_clinicas (cliente, usuario_id, clinica_id) values ($1,$2,$3) returning id`, [cl, usuario, clinica]);
      const paciente = await one(`insert into pacientes (cliente, nombre, clinica_id) values ($1,$2,$3) returning id`, [cl, `${MARK} Paciente ${cl}`, clinica]);
      const presupuesto = await one(`insert into presupuestos (cliente, estado, importe, paciente_id, clinica_id, notas) values ($1,'PRESENTADO',$2,$3,$4,$5) returning id`, [cl, IMPORTE[cl], paciente, clinica, `${MARK} presupuesto ${cl}`]);
      const lead = await one(`insert into leads (cliente, nombre, estado, clinica_id) values ($1,$2,'Nuevo',$3) returning id`, [cl, `${MARK} Lead ${cl}`, clinica]);
      const mensaje = await one(`insert into mensajes_whatsapp (cliente, direccion, contenido) values ($1,'Entrante',$2) returning id`, [cl, `${MARK} msg ${cl}`]);
      const llamada = await one(`insert into llamadas_vapi (cliente, estado, resumen) values ($1,'completada',$2) returning id`, [cl, `${MARK} llamada ${cl}`]);
      const conversacion = await one(`insert into conversaciones_copilot (cliente, resumen) values ($1,$2) returning id`, [cl, `${MARK} conv ${cl}`]);
      return { clinica, usuario, uclinica, paciente, presupuesto, lead, mensaje, llamada, conversacion };
    });
  }
}

// tablas cuya fila [QA_SB] probamos leer/escribir cross-cliente
const TABLA_ID = {
  clinicas: "clinica", pacientes: "paciente", presupuestos: "presupuesto", leads: "lead",
  mensajes_whatsapp: "mensaje", llamadas_vapi: "llamada", conversaciones_copilot: "conversacion",
  usuario_clinicas: "uclinica",
};

async function main() {
  console.log("═".repeat(70));
  console.log("  GATE FINAL — QA adversarial Sprint B contra Postgres + RLS");
  console.log("  rol: fyllio_app (NOBYPASSRLS) · datos reconocibles " + MARK);
  console.log("═".repeat(70));

  await limpiar();
  await sembrar();
  console.log(`\nSeed listo: filas ${MARK} en ${CLIENTES.join(", ")} (importe reconocible RB=77777 INDEP=88888 DEMO=99999).`);

  // ── ESCENARIO 1 — cliente↔cliente: NO ver filas de otro cliente ──
  seccion("ESCENARIO 1 — Separación TOTAL entre clientes (lo más crítico)");
  for (const viewer of CLIENTES) {
    for (const victim of CLIENTES) {
      if (viewer === victim) continue;
      await enTrx(viewer, async (c) => {
        for (const [tabla, key] of Object.entries(TABLA_ID)) {
          const r = await c.query(`select count(*)::int n from ${tabla} where id = $1`, [ids[victim][key]]);
          ok(`${viewer} NO ve ${tabla} de ${victim}`, r.rows[0].n === 0);
        }
      });
    }
  }
  // recuento total: cada cliente ve SOLO su propia fila [QA_SB], nunca 2+
  for (const viewer of CLIENTES) {
    await enTrx(viewer, async (c) => {
      const r = await c.query(`select count(*)::int n from presupuestos where notas like $1`, [MARK + "%"]);
      ok(`${viewer} ve exactamente 1 presupuesto ${MARK} (el suyo), no los 3`, r.rows[0].n === 1, `n=${r.rows[0].n}`);
      const imp = await c.query(`select importe from presupuestos where notas like $1`, [MARK + "%"]);
      ok(`${viewer} solo ve su importe reconocible ${IMPORTE[viewer]}`, imp.rows.every((x) => Number(x.importe) === IMPORTE[viewer]));
    });
  }

  // ── ESCENARIO 1b — cliente↔cliente: NO modificar/borrar/insertar cruzado ──
  seccion("ESCENARIO 1b — Escrituras cruzadas rechazadas por el motor");
  for (const viewer of CLIENTES) {
    for (const victim of CLIENTES) {
      if (viewer === victim) continue;
      const upd = await enTrx(viewer, (c) => c.query(`update presupuestos set importe = 1 where id = $1`, [ids[victim].presupuesto]));
      ok(`${viewer} UPDATE sobre presupuesto de ${victim} → 0 filas`, upd.rowCount === 0, `rowCount=${upd.rowCount}`);
      const del = await enTrx(viewer, (c) => c.query(`delete from pacientes where id = $1`, [ids[victim].paciente]));
      ok(`${viewer} DELETE sobre paciente de ${victim} → 0 filas`, del.rowCount === 0, `rowCount=${del.rowCount}`);
      const ins = await intento(viewer, `insert into clinicas (cliente, nombre) values ($1,$2)`, [victim, `${MARK} cross ${viewer}->${victim}`]);
      ok(`${viewer} INSERT estampando cliente=${victim} → rechazado (WITH CHECK)`, ins === "42501", `code=${ins}`);
    }
  }

  // ── ESCENARIO 3 — IDOR por id (backstop de motor cross-cliente) ──
  seccion("ESCENARIO 3 — IDOR por id de presupuesto (backstop de motor)");
  // Coord/Admin de un cliente pega el id de un presupuesto de OTRO cliente.
  for (const viewer of CLIENTES) {
    for (const victim of CLIENTES) {
      if (viewer === victim) continue;
      await enTrx(viewer, async (c) => {
        const r = await c.query(`select id, importe from presupuestos where id = $1`, [ids[victim].presupuesto]);
        ok(`${viewer} pega id de presupuesto de ${victim} → 0 filas (no IDOR)`, r.rowCount === 0);
      });
    }
  }

  // ── ESCENARIO 4 — identidad: usuario_clinicas scoped, usuarios cross por diseño ──
  seccion("ESCENARIO 4 — Gestión de usuarios/clínicas entre clientes");
  for (const viewer of CLIENTES) {
    for (const victim of CLIENTES) {
      if (viewer === victim) continue;
      await enTrx(viewer, async (c) => {
        const uc = await c.query(`select count(*)::int n from usuario_clinicas where id = $1`, [ids[victim].uclinica]);
        ok(`${viewer} NO ve la asignación usuario↔clínica de ${victim}`, uc.rows[0].n === 0);
        const cl = await c.query(`select count(*)::int n from clinicas where id = $1`, [ids[victim].clinica]);
        ok(`${viewer} NO ve la clínica de ${victim}`, cl.rows[0].n === 0);
      });
    }
  }
  // usuarios: cross-cliente POR DISEÑO (p_identidad using true). Documentado, no es fuga.
  await enTrx("RB", async (c) => {
    const r = await c.query(`select count(*)::int n from usuarios where id = $1`, [ids.INDEP.usuario]);
    ok(`usuarios es cross-cliente (p_identidad, login email+PIN) — RB VE el usuario de INDEP`, r.rows[0].n === 1,
      "POR DISEÑO D9: la protección de gestión es app-level (bcrypt PIN + chequeo de cliente en la ruta). NO es fuga de negocio.");
  });

  // ── ESCENARIO 5 — copilot: datos de otras clínicas/clientes ──
  seccion("ESCENARIO 5 — El Copilot no cruza datos (mensajes/llamadas)");
  for (const viewer of CLIENTES) {
    for (const victim of CLIENTES) {
      if (viewer === victim) continue;
      await enTrx(viewer, async (c) => {
        for (const t of ["mensajes_whatsapp", "llamadas_vapi", "conversaciones_copilot"]) {
          const r = await c.query(`select count(*)::int n from ${t} where id = $1`, [ids[victim][TABLA_ID[t]]]);
          ok(`${viewer} (copilot) NO ve ${t} de ${victim}`, r.rows[0].n === 0);
        }
      });
    }
  }

  // ── FAIL-CLOSED — sin contexto no se ve ni se escribe nada ──
  seccion("FAIL-CLOSED — sin SET LOCAL app.cliente (el motor niega por defecto)");
  {
    const c = await pool.connect();
    try {
      for (const t of ["clinicas", "pacientes", "presupuestos", "leads", "mensajes_whatsapp", "llamadas_vapi"]) {
        const r = await c.query(`select count(*)::int n from ${t}`);
        ok(`sin contexto → ${t} devuelve 0 filas`, r.rows[0].n === 0, `n=${r.rows[0].n}`);
      }
    } finally { c.release(); }
    const ins = await intento(null, `insert into clinicas (cliente, nombre) values ('DEMO', $1)`, [`${MARK} no-ctx`]);
    ok(`sin contexto → INSERT rechazado por RLS`, ins === "42501", `code=${ins}`);
  }

  // ── COMPLETITUD DE ESQUEMA — ninguna tabla de negocio sin candado ──
  seccion("COMPLETITUD — toda tabla de negocio con FORCE RLS + política por cliente");
  {
    const c = await pool.connect();
    try {
      const ANALITICA = new Set(["eventos_comportamentales", "factores_no_show", "patrones_aprendidos"]);
      const tabs = await c.query(`
        select t.tablename, cls.relforcerowsecurity force
        from pg_tables t join pg_class cls on cls.relname = t.tablename
        where t.schemaname='public' and t.tablename not in ('_migraciones')`);
      const pols = await c.query(`select tablename, policyname, qual::text from pg_policies where schemaname='public'`);
      const polByTable = new Map();
      for (const p of pols.rows) { if (!polByTable.has(p.tablename)) polByTable.set(p.tablename, []); polByTable.get(p.tablename).push(p); }

      let sinForce = [], sinCliente = [], permisivas = [];
      for (const t of tabs.rows) {
        if (ANALITICA.has(t.tablename)) continue;
        const ps = polByTable.get(t.tablename) ?? [];
        if (!t.force) sinForce.push(t.tablename);
        const tieneCliente = ps.some((p) => (p.qual ?? "").includes("app.cliente"));
        const esPermisiva = ps.some((p) => (p.qual ?? "").trim() === "true");
        if (t.tablename === "usuarios") { // excepción por diseño
          ok(`usuarios: única tabla con política permisiva (p_identidad, by design)`, esPermisiva && !tieneCliente);
          continue;
        }
        if (!tieneCliente) sinCliente.push(t.tablename);
        if (esPermisiva) permisivas.push(t.tablename);
      }
      ok(`todas las tablas de negocio con FORCE RLS`, sinForce.length === 0, sinForce.join(",") || "0 huecos");
      ok(`todas las tablas de negocio filtran por app.cliente`, sinCliente.length === 0, sinCliente.join(",") || "0 huecos");
      ok(`ninguna tabla de negocio con política permisiva (using true) salvo usuarios`, permisivas.length === 0, permisivas.join(",") || "0 permisivas");

      const rb = await c.query(`select rolbypassrls from pg_roles where rolname='fyllio_app'`);
      ok(`fyllio_app SIN BYPASSRLS`, rb.rows[0]?.rolbypassrls === false);
      const an = await c.query(`select count(*) from factores_no_show`).then(() => "leyó", (e) => e.code);
      ok(`fyllio_app NO puede leer la analítica del Sprint 18`, an === "42501", `code=${an}`);
    } finally { c.release(); }
  }

  await limpiar();

  seccion("RESULTADO");
  console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
  if (fallos === 0) console.log("\n\x1b[32m✓ GATE MOTOR (RLS) VERDE — ningún cliente ve, modifica ni borra datos de otro.\x1b[0m");
  else console.log(`\n\x1b[31m✗ GATE ROJO — ${fallos} fallo(s). SE PARA (mandato: si un cliente ve a otro, se para).\x1b[0m`);
  await pool.end();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e.message); await pool.end().catch(() => {}); process.exit(2); });
