#!/usr/bin/env node
// FASE 2 gate 2 — tests de humo de RLS contra Supabase (rol fyllio_app).
// Mandamiento §5: el aislamiento se prueba INTENTANDO saltárselo.
//
//   node scripts/db-smoke-rls.mjs
//
// Usa SUPABASE_DB_URL_APP (pooler, fyllio_app). No deja residuos: los datos
// de prueba se insertan y borran dentro del propio test.

import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const url = process.env.SUPABASE_DB_URL_APP;
if (!url) { console.error("Falta SUPABASE_DB_URL_APP"); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
let fallos = 0;
const ok = (n, c) => { console.log(`${c ? "✓" : "✗"} ${n}`); if (!c) fallos++; };

async function enTrx(cliente, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (cliente) await c.query("select set_config('app.cliente', $1, true)", [cliente]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}

const MARK = "[SMOKE_RLS]";

// 0. limpiar restos de runs anteriores
await enTrx("DEMO", (c) => c.query("delete from clinicas where nombre like $1", [MARK + "%"]));

// 1. sin SET LOCAL → 0 filas (fail-closed del motor)
{
  const c = await pool.connect();
  try {
    const r = await c.query("select count(*)::int as n from clinicas");
    ok("sin SET LOCAL app.cliente → clinicas devuelve 0 filas", r.rows[0].n === 0);
    const w = await c.query("insert into clinicas (cliente, nombre) values ('DEMO', $1) returning id", [MARK + " no-ctx"]).then(() => "insertó", (e) => e.code);
    ok(`sin SET LOCAL → INSERT rechazado por RLS (code=${w})`, w === "42501");
  } finally { c.release(); }
}

// 2. con SET LOCAL DEMO → escribe y lee su fila
const idDemo = await enTrx("DEMO", async (c) => {
  const r = await c.query("insert into clinicas (cliente, nombre) values ('DEMO', $1) returning id", [MARK + " demo"]);
  const s = await c.query("select count(*)::int as n from clinicas where nombre like $1", [MARK + "%"]);
  ok("SET LOCAL DEMO → inserta y ve su propia fila", s.rows[0].n === 1);
  return r.rows[0].id;
});

// 3. cliente↔cliente: RB no ve la fila DEMO
await enTrx("RB", async (c) => {
  const s = await c.query("select count(*)::int as n from clinicas where nombre like $1", [MARK + "%"]);
  ok("SET LOCAL RB → NO ve la clínica DEMO (aislamiento cliente↔cliente)", s.rows[0].n === 0);
  const u = await c.query("update clinicas set nombre = 'hackeada' where id = $1", [idDemo]);
  ok("SET LOCAL RB → UPDATE sobre fila DEMO afecta 0 filas", u.rowCount === 0);
});

// 4. FK compuesta: staff de RB no puede referenciar clínica DEMO
{
  const r = await enTrx("RB", (c) =>
    c.query("insert into staff (cliente, nombre, clinica_id) values ('RB', $1, $2)", [MARK, idDemo]),
  ).then(() => "insertó", (e) => e.code);
  ok(`FK compuesta → link RB→clínica-DEMO RECHAZADO (code=${r})`, r === "23503" || r === "42501");
}

// 5. D7a — directorio de login SIN contexto (el caso del flujo clásico)
{
  const c = await pool.connect();
  try {
    const r = await c.query("select count(*)::int as n from login_clinicas_directorio where nombre like $1", [MARK + "%"]);
    ok("vista login_clinicas_directorio legible SIN contexto (D7a)", r.rows[0].n === 1);
    const cols = await c.query("select * from login_clinicas_directorio limit 0");
    const names = cols.fields.map((f) => f.name).sort().join(",");
    ok(`vista expone SOLO id/cliente/nombre/ciudad/activa (${names})`, names === "activa,ciudad,cliente,id,nombre");
  } finally { c.release(); }
}

// 6. el rol no puede saltarse RLS ni tocar la analítica
{
  const c = await pool.connect();
  try {
    const rb = await c.query("select rolbypassrls from pg_roles where rolname = 'fyllio_app'");
    ok("fyllio_app SIN BYPASSRLS", rb.rows[0]?.rolbypassrls === false);
    const an = await c.query("select count(*) from factores_no_show").then(() => "leyó", (e) => e.code);
    ok(`fyllio_app NO puede leer la analítica del Sprint 18 (code=${an})`, an === "42501");
  } finally { c.release(); }
}

// limpieza
await enTrx("DEMO", (c) => c.query("delete from clinicas where nombre like $1", [MARK + "%"]));

await pool.end();
console.log(fallos === 0 ? "\n✓ SMOKE RLS: todo aislado." : `\n✗ SMOKE RLS: ${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
