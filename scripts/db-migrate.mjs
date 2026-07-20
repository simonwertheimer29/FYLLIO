#!/usr/bin/env node
// FASE 2 — aplicador de migraciones SQL contra Supabase.
//
//   node scripts/db-migrate.mjs           # aplica pendientes
//   node scripts/db-migrate.mjs --dry     # lista sin aplicar
//
// Conexión: SUPABASE_DB_URL_ADMIN (usuario postgres, SOLO para migraciones;
// la app NUNCA usa esta URL). Conexión directa (5432) o pooler session-mode
// — DDL no va por transaction-mode.
// Registro en tabla _migraciones (nombre + aplicada_en). Cada archivo corre
// en una transacción: o entra entero o no entra (mandamiento §1).

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const DRY = process.argv.includes("--dry");
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

const url = process.env.SUPABASE_DB_URL_ADMIN;
if (!url) {
  console.error("Falta SUPABASE_DB_URL_ADMIN (URL directa de Postgres, usuario postgres, solo migraciones).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`create table if not exists _migraciones (
  nombre text primary key,
  aplicada_en timestamptz not null default now()
)`);

const aplicadas = new Set(
  (await client.query("select nombre from _migraciones")).rows.map((r) => r.nombre),
);
const archivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

let n = 0;
for (const f of archivos) {
  if (aplicadas.has(f)) { console.log(`= ${f} (ya aplicada)`); continue; }
  if (DRY) { console.log(`→ ${f} (pendiente)`); n++; continue; }
  const sql = readFileSync(join(dir, f), "utf8");
  console.log(`→ aplicando ${f}...`);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into _migraciones (nombre) values ($1)", [f]);
    await client.query("commit");
    console.log(`✓ ${f}`);
    n++;
  } catch (e) {
    await client.query("rollback");
    console.error(`✗ ${f} FALLÓ (rollback):`, e.message);
    await client.end();
    process.exit(1);
  }
}
console.log(DRY ? `${n} pendientes.` : `${n} aplicadas.`);

// Post-paso: fijar el password del rol de app desde env (nunca en el repo).
if (!DRY && process.env.FYLLIO_APP_DB_PASSWORD) {
  await client.query(
    `alter role fyllio_app with password '${process.env.FYLLIO_APP_DB_PASSWORD.replace(/'/g, "''")}'`,
  );
  console.log("✓ password de fyllio_app fijado desde FYLLIO_APP_DB_PASSWORD.");
}
await client.end();
