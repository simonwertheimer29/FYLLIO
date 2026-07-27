#!/usr/bin/env node
// QA adversarial del scope de clínica de /red (2026-07-27).
//
//   npm run dev   (en otra terminal)
//   node scripts/qa-red-scope.mjs
//
// Mandamiento §5: un filtro que nadie ha intentado romper es decorativo. El
// ?clinica= de /api/red/dashboard llega DEL CLIENTE, así que aquí se intenta
// activamente pedir lo prohibido: una clínica inventada, una de otro cliente
// legal (RB desde una sesión DEMO) y una clínica hermana desde una sesión de
// coordinación. Todas deben ser 403 — nunca "sin filtro".
//
// Firma sesiones en local con AUTH_SECRET del .env.local; no escribe nada.
import { SignJWT } from "jose"; import pg from "pg"; import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max: 1, ssl:{rejectUnauthorized:false} });
const c = await pool.connect(); await c.query("begin"); await c.query("select set_config('app.cliente','DEMO',true)");
const admin = (await c.query("select id,nombre from usuarios where email='demo@fyllio.com'")).rows[0];
const coord1 = (await c.query("select id,nombre from usuarios where email='demo-coord1@fyllio.com'")).rows[0];
const cls = (await c.query("select id,nombre from clinicas where cliente='DEMO' order by nombre")).rows;
await c.query("rollback");
await c.query("begin"); await c.query("select set_config('app.cliente','RB',true)");
const rb = (await c.query("select id,nombre from clinicas where cliente='RB' limit 1")).rows[0];
await c.query("rollback"); c.release(); await pool.end();

const sec = new TextEncoder().encode(process.env.AUTH_SECRET);
const tok = (u, rol, cl) => new SignJWT({userId:u.id, rol, cliente:"DEMO", clinicasAccesibles:cl, nombre:u.nombre})
  .setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("1h").sign(sec);

const get = async (t, q) => {
  const r = await fetch(`http://localhost:3000/api/red/dashboard${q}`, { headers:{ cookie:`fyllio_session=${t}` }});
  return r.status;
};
const tAdmin = await tok(admin, "admin", ["*"]);
// coord1 = una sola clínica; sacamos la suya de la junction
const pool2 = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max:1, ssl:{rejectUnauthorized:false}});
const c2 = await pool2.connect(); await c2.query("begin"); await c2.query("select set_config('app.cliente','DEMO',true)");
const suyas = (await c2.query("select clinica_id from usuario_clinicas where usuario_id=$1",[coord1.id])).rows.map(r=>r.clinica_id);
await c2.query("rollback"); c2.release(); await pool2.end();
const tCoord = await tok(coord1, "coordinacion", suyas);

let fallos = 0;
const ok = (n, cond, extra="") => { console.log(`${cond?"✓":"✗"} ${n} ${extra}`); if(!cond) fallos++; };
ok("admin sin ?clinica → 200", await get(tAdmin, "") === 200);
ok("admin con clínica suya → 200", await get(tAdmin, `?clinica=${cls[0].id}`) === 200);
ok("admin con id inventado → 403", await get(tAdmin, "?clinica=recNOEXISTE123") === 403);
ok("admin con clínica de OTRO cliente (RB) → 403", await get(tAdmin, `?clinica=${rb.id}`) === 403, `(${rb.nombre})`);
ok("coord con su clínica → 200", await get(tCoord, `?clinica=${suyas[0]}`) === 200);
const ajena = cls.find(x => !suyas.includes(x.id));
ok("coord con clínica AJENA de su mismo cliente → 403", await get(tCoord, `?clinica=${ajena.id}`) === 403, `(${ajena.nombre})`);
ok("sin cookie → 401", await fetch("http://localhost:3000/api/red/dashboard").then(r=>r.status) === 401);
console.log(fallos === 0 ? "\nVERDE 7/7" : `\nROJO: ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
