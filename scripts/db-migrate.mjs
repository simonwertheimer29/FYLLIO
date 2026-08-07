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

// ─── Lo que este script YA NO hace, y por qué ────────────────────────────────
//
// Aquí había un post-paso que ejecutaba `alter role fyllio_app with password`
// desde `FYLLIO_APP_DB_PASSWORD` en CADA migración aplicada. Se retiró el
// 2026-08-05: **una migración de esquema no toca credenciales.**
//
// El fallo que evita: el valor de `FYLLIO_APP_DB_PASSWORD` de quien corre la
// migración y la contraseña embebida en el `SUPABASE_DB_URL_APP` de Vercel son
// dos secretos distintos que nadie compara. El día que diverjan —alguien rota
// uno, alguien clona el repo con un .env viejo, alguien no tiene la variable—
// aplicar una migración de esquema **deja producción sin acceso a su base**, y
// el síntoma aparece en la app, lejos del comando que lo causó.
//
// Ya dio un aviso el 2026-08-05: tras aplicar la 014 el pooler de Supabase
// rechazó credenciales durante unos segundos, porque el `alter role` invalida
// su caché aunque la contraseña sea LA MISMA. Esa vez lo era. La siguiente no
// tiene por qué.
//
// La rotación vive ahora en `npm run db:password`, que es lo que se quería:
// una operación explícita, que se ejecuta cuando se rota una credencial y no
// cuando se añade una columna.
await client.end();

// ─── Aviso: ¿ha quedado esquema sin tipo? ────────────────────────────────────
//
// El generador de tipos solo conoce las migraciones 001 y 002; lo que añaden las
// posteriores se declara a mano en `app/lib/db/types.ts`. Olvidarlo no rompe
// nada —da un `any`, que parece comprobado y no lo está—, así que el momento de
// enterarse es JUSTO AQUÍ, al aplicar la migración, y no tres días después.
//
// Avisa, no falla: las migraciones YA se han aplicado, y salir con error haría
// dudar de si se aplicaron. Quien quiera el código de salida tiene `qa:tipos`.
{
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [new URL("qa-tipos-db.mjs", import.meta.url).pathname], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.log("\n" + "─".repeat(76));
    console.log("⚠  Las migraciones se aplicaron, PERO hay esquema sin declarar en los tipos:");
    console.log((r.stderr || r.stdout || "").trimEnd());
    console.log("─".repeat(76));
  }
}
