// scripts/qa-export-csv.mjs — MEJORAS 61: el CSV exporta LO QUE SE VE.
//
// La Tabla manda los ids de las filas filtradas (POST) y el servidor devuelve
// exactamente esas, en ese orden, con el recuento en el nombre del archivo.
// El GET sin ids sigue exportando todo (compatibilidad). Corre contra el dev
// server (QA_BASE_URL, por defecto :3000) con la base DEMO.
//
//   npm run qa:export
import pg from "pg";
import { SignJWT } from "jose";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max: 1, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
await c.query("begin");
await c.query("select set_config('app.cliente','DEMO',true)");
const [usuario] = (await c.query("select id, nombre from usuarios where email='demo@fyllio.com'")).rows;
const filas = (await c.query("select id, paciente_id from presupuestos where cliente='DEMO' order by fecha desc nulls last limit 3")).rows;
const total = (await c.query("select count(*)::int as n from presupuestos where cliente='DEMO'")).rows[0].n;
await c.query("rollback");
c.release();
await pool.end();
if (!usuario || filas.length < 3) {
  console.log("✗ no comprobable: hace falta el usuario demo@fyllio.com y ≥ 3 presupuestos DEMO (corre `npm run demo:reset`)");
  process.exit(2);
}

const cookie = `fyllio_session=${await new SignJWT({
  userId: usuario.id, rol: "admin", cliente: "DEMO", clinicasAccesibles: ["*"], nombre: usuario.nombre, email: "demo@fyllio.com",
})
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET))}`;

let ok = 0, ko = 0;
const check = (n, cond, det = "") => { if (cond) { ok++; console.log(`✓ ${n}`); } else { ko++; console.log(`✗ ${n}${det ? ` — ${det}` : ""}`); } };
const lineasDe = (txt) => txt.replace(/^﻿/, "").split("\r\n").filter(Boolean);
const post = (body) => fetch(`${BASE}/api/export/presupuestos.csv`, {
  method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body),
});

// ── 1 · tres ids, en un orden que NO es el de la base ─────────────────────
const ids = filas.map((f) => f.id);
const orden = [ids[2], ids[0], ids[1]];
const r = await post({ ids: orden });
const txt = await r.text();
const lineas = lineasDe(txt);
check("1 · POST con 3 ids responde 200", r.status === 200, `status ${r.status} · ${txt.slice(0, 120)}`);
check(`1 · vuelven cabecera + 3 filas, no las ${total} de la base`, lineas.length === 4, `líneas=${lineas.length}`);
const cd = r.headers.get("content-disposition") ?? "";
check("1 · el nombre del archivo dice 3-filas", /_3-filas\.csv/.test(cd), cd);
check("1 · las columnas oficiales siguen siendo 12", lineas[0]?.split(";").length === 12, lineas[0]);

// ── 2 · el orden es el pedido (el de la pantalla) ─────────────────────────
// La fila no lleva el id, así que se compara por el paciente de cada una.
const nombres = await (async () => {
  const p = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max: 1, ssl: { rejectUnauthorized: false } });
  const cc = await p.connect();
  await cc.query("begin");
  await cc.query("select set_config('app.cliente','DEMO',true)");
  const rows = (await cc.query("select id, nombre from pacientes where id = any($1)", [filas.map((f) => f.paciente_id)])).rows;
  await cc.query("rollback");
  cc.release();
  await p.end();
  return new Map(rows.map((x) => [x.id, x.nombre]));
})();
const esperado = orden.map((id) => nombres.get(filas.find((f) => f.id === id)?.paciente_id) ?? "");
const visto = lineas.slice(1).map((l) => l.split(";")[1]?.replace(/^"|"$/g, "").replace(/""/g, '"'));
check("2 · las filas salen en el orden pedido", JSON.stringify(visto) === JSON.stringify(esperado), `visto=${JSON.stringify(visto)} esperado=${JSON.stringify(esperado)}`);

// ── 3 · compatibilidad y bordes ───────────────────────────────────────────
const g = await fetch(`${BASE}/api/export/presupuestos.csv`, { headers: { cookie } });
const gl = lineasDe(await g.text());
check(`3 · GET sin ids sigue exportando todo (${total})`, g.status === 200 && gl.length === total + 1, `status ${g.status} líneas=${gl.length}`);
const sin = await post({});
check("3 · POST sin ids da 400, no exporta todo por defecto", sin.status === 400, `status ${sin.status}`);
const vacio = await post({ ids: ["no-existe"] });
const vl = lineasDe(await vacio.text());
check("3 · un id inexistente no se rellena con otra fila (solo cabecera)", vacio.status === 200 && vl.length === 1, `status ${vacio.status} líneas=${vl.length}`);

console.log(`\n${ok} OK · ${ko} KO`);
process.exit(ko ? 1 : 0);
