#!/usr/bin/env tsx
// scripts/db-seed-conocimiento.mts — SOLO lo publicado de las 4 clínicas DEMO.
//
//   npm run demo:conocimiento
//
// Escribe configuracion_automatizaciones.conocimiento con demo-conocimiento.mjs
// (la misma definición que usa demo:reset), validada con el parser REAL antes
// de tocar nada (§15: el seed respeta el vocabulario y una invariante lo
// comprueba). Para cambiar lo publicado sin resembrar 39 tablas. Idempotente:
// UPDATE por clínica dentro de una transacción, y exige UNA fila tocada por
// sede (§1: cero filas no es éxito — sin demo:reset previo no hay fila).
//
// Salidas: 0 · 1 datos inválidos o fila no encontrada · 2 entorno.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";
import { esConocimientoVacio, parseConocimiento, renderConocimiento } from "../app/lib/agente/conocimiento";
import { CONOCIMIENTO_DEMO } from "./demo-conocimiento.mjs";

if (!process.env["SUPABASE_DB_URL_APP"]) {
  console.error("✗ Falta SUPABASE_DB_URL_APP.");
  process.exit(2);
}

// 1 · validar TODO antes de escribir nada: un JSON ilegible LANZA aquí, no
// en el primer turno del agente.
const validados = new Map<string, string>();
for (const [nombre, c] of Object.entries(CONOCIMIENTO_DEMO)) {
  const raw = JSON.stringify(c);
  const parseado = parseConocimiento(raw);
  if (esConocimientoVacio(parseado)) {
    console.error(`✗ ${nombre}: el conocimiento parsea VACÍO — no es lo que se quiere sembrar.`);
    process.exit(1);
  }
  validados.set(nombre, raw);
  console.log(`  ${nombre}: ${renderConocimiento(parseado).length} líneas al prompt`);
}

// 2 · escribir, en el contexto DEMO (RLS por cliente, como db-seed-demo-rico).
const db = new pg.Client({ connectionString: process.env["SUPABASE_DB_URL_APP"], ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  await db.query("begin");
  await db.query("select set_config('app.cliente', 'DEMO', true)");
  const ctx = (await db.query("select current_setting('app.cliente', true) as c")).rows[0].c;
  if (ctx !== "DEMO") throw new Error(`contexto no es DEMO: ${ctx}`);
  for (const [nombre, raw] of validados) {
    const r = await db.query(
      `update configuracion_automatizaciones
          set conocimiento = $1, actualizado_en = now()
        where cliente = 'DEMO'
          and clinica_id = (select id from clinicas where cliente = 'DEMO' and nombre = $2)`,
      [raw, nombre],
    );
    if (r.rowCount !== 1) {
      throw new Error(`${nombre}: ${r.rowCount} filas tocadas — ¿existe la clínica y su configuración? (npm run demo:reset)`);
    }
  }
  await db.query("commit");
  console.log(`✓ lo publicado sembrado en ${validados.size} clínicas DEMO`);
} catch (err) {
  await db.query("rollback").catch(() => {});
  console.error("✗", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.end();
}
