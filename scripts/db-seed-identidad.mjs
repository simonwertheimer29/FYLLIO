#!/usr/bin/env node
// FASE 2 CORTE (FASE B) — copia la IDENTIDAD (Usuarios/Clínicas/Usuario_Clinicas)
// de la base CENTRAL de Airtable → Postgres, RECONCILIANDO ids de clínica.
//
//   node scripts/db-seed-identidad.mjs [--dry]
//
// Reconciliación (mata el cabo #3): DEMO ya tiene sus clínicas en PG con id de
// NEGOCIO (db-seed-demo); su junction debe enlazar a ESOS ids (resueltos por
// NOMBRE, central→PG), NO al id central. RB/INDEP no tienen negocio en PG → sus
// clínicas se siembran con el id CENTRAL (sin conflicto). Así la sesión lleva ids
// de PG y el filtro de clínica sigue resolviendo por nombre sin cambiarlo.
//
// Corre como admin (bypassa RLS) pero estampa el `cliente` correcto en cada fila.
// Idempotente: borra identidad (usuario_clinicas, usuarios, clínicas de RB/INDEP)
// y re-copia. Las clínicas DEMO (de negocio) NO se tocan.

import pg from "pg";
import Airtable from "airtable";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const DRY = process.argv.includes("--dry");
const central = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_CENTRAL);
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
await db.connect();

const CLIENTES = new Set(["RB", "INDEP", "DEMO"]);
const txt = (v) => (v == null || v === "" ? null : String(v));
const link1 = (v) => (Array.isArray(v) && v[0] ? String(v[0]) : null);
const boolv = (v) => Boolean(v ?? false);

async function leer(tabla) {
  const out = [];
  await central(tabla).select({}).eachPage((recs, next) => { out.push(...recs); next(); });
  return out;
}

console.log(DRY ? "— DRY RUN —" : "— SEED IDENTIDAD central → Postgres —");

const usuarios = await leer("Usuarios");
const clinicas = await leer("Clínicas");
const junctions = await leer("Usuario_Clinicas");
console.log(`central: ${usuarios.length} usuarios, ${clinicas.length} clínicas, ${junctions.length} junctions`);

// Mapa NOMBRE→id de las clínicas DEMO que YA están en PG (id de negocio).
const demoPg = await db.query("select id, nombre from clinicas where cliente='DEMO'");
const demoNombreAId = new Map(demoPg.rows.map((r) => [r.nombre, r.id]));

// Mapa cliente por usuario (para estampar la junction).
const clienteDeUsuario = new Map();
for (const u of usuarios) { const c = txt(u.fields["Cliente"]); if (CLIENTES.has(c)) clienteDeUsuario.set(u.id, c); }

// Mapa id-clínica-central → id-clínica-PG (reconciliación).
//  DEMO  → por NOMBRE al id de negocio ya en PG.
//  RB/INDEP → se sembrará con el id central (identidad).
const clinicaCentralAPg = new Map();
const clinicasParaInsertar = []; // solo RB/INDEP
for (const c of clinicas) {
  const cliente = txt(c.fields["Cliente"]);
  if (!CLIENTES.has(cliente)) continue;
  if (cliente === "DEMO") {
    const pgId = demoNombreAId.get(txt(c.fields["Nombre"]));
    if (!pgId) { console.log(`  ⚠ clínica DEMO central "${c.fields["Nombre"]}" sin equivalente en PG (por nombre) → junction se saltará`); continue; }
    clinicaCentralAPg.set(c.id, pgId);
  } else {
    clinicaCentralAPg.set(c.id, c.id); // preserva id central
    clinicasParaInsertar.push({ id: c.id, cliente, nombre: txt(c.fields["Nombre"]), ciudad: txt(c.fields["Ciudad"]), activa: c.fields["Activa"] === undefined ? true : boolv(c.fields["Activa"]) });
  }
}

await db.query("begin");
try {
  // wipe identidad (FK-safe). Las clínicas DEMO (negocio) NO se tocan.
  await db.query("delete from usuario_clinicas where cliente in ('RB','INDEP','DEMO')");
  await db.query("delete from usuarios where cliente in ('RB','INDEP','DEMO')");
  await db.query("delete from clinicas where cliente in ('RB','INDEP')"); // DEMO clínicas = negocio, se quedan
  console.log("wipe identidad (usuario_clinicas, usuarios, clínicas RB/INDEP) hecho");

  // 1) usuarios (preservando id)
  let nu = 0;
  for (const u of usuarios) {
    const cliente = txt(u.fields["Cliente"]);
    if (!CLIENTES.has(cliente)) continue;
    const f = u.fields;
    const rawLen = f["Pin_length"];
    const pinLength = rawLen === 4 || rawLen === 6 ? rawLen : null;
    if (!DRY) await db.query(
      `insert into usuarios (id, cliente, nombre, email, telefono, rol, activo, password_hash, pin_hash, pin_length, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())`,
      [u.id, cliente, txt(f["Nombre"]), txt(f["Email"]), txt(f["Telefono"]),
       txt(f["Rol"]) ?? "coordinacion", f["Activo"] === undefined ? true : boolv(f["Activo"]),
       txt(f["Password_hash"]), txt(f["Pin_hash"]), pinLength]);
    nu++;
  }
  console.log(`usuarios → ${nu}`);

  // 2) clínicas RB/INDEP (id central)
  let nc = 0;
  for (const c of clinicasParaInsertar) {
    if (!DRY) await db.query(
      `insert into clinicas (id, cliente, nombre, ciudad, activa, created_at) values ($1,$2,$3,$4,$5, now())`,
      [c.id, c.cliente, c.nombre, c.ciudad, c.activa]);
    nc++;
  }
  console.log(`clínicas RB/INDEP → ${nc} (DEMO intactas: ${demoPg.rows.length})`);

  // 3) usuario_clinicas (reconciliado)
  let nj = 0, saltos = 0;
  for (const j of junctions) {
    const usuarioId = link1(j.fields["Usuario"]);
    const clinicaCentral = link1(j.fields["Clinica"]);
    const cliente = usuarioId ? clienteDeUsuario.get(usuarioId) : null;
    const clinicaPg = clinicaCentral ? clinicaCentralAPg.get(clinicaCentral) : null;
    if (!usuarioId || !clinicaPg || !cliente) { saltos++; continue; }
    if (!DRY) await db.query(
      `insert into usuario_clinicas (cliente, usuario_id, clinica_id, created_at) values ($1,$2,$3, now())`,
      [cliente, usuarioId, clinicaPg]);
    nj++;
  }
  console.log(`usuario_clinicas → ${nj} (saltos: ${saltos})`);

  await db.query(DRY ? "rollback" : "commit");
  console.log(DRY ? "rollback (dry)." : "✓ commit.");
} catch (e) {
  await db.query("rollback");
  console.error("✗ seed identidad FALLÓ (rollback):", e.message);
  process.exit(1);
} finally { await db.end(); }
