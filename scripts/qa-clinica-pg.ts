#!/usr/bin/env node
// FASE 2 · GATE FINAL — Escenario 2 (clínica↔clínica) contra el CÓDIGO REAL sobre Postgres.
//
//   npx tsx scripts/qa-clinica-pg.ts
//
// El aislamiento clínica↔clínica NO vive en RLS (eso es FASE 3) — es app-level:
// los handlers filtran con `formulaClinicaPermitida()` y autorizan con
// `permiteClinica()` / `verificarPresupuestoPermitido()`. Este harness ejercita
// ESAS MISMAS piezas a través de los REPOS QUE DELEGAN POR FLAG (usaPostgres) —
// el mismo camino que corre en producción — sobre el seed DEMO, intentando ver
// clínicas ajenas (§5).
//
// Cubre el fix del finding #2: verificarPresupuestoPermitido ahora resuelve el
// presupuesto por el repo (→ PG cuando está volteado), no por Airtable congelado.
// Incluye la prueba DISCRIMINANTE: un presupuesto creado SOLO en PG (que con la
// lectura Airtable vieja daba "not_found" a un coord) ahora da "ok".
//
// Punto honesto: dentro de un cliente, el MOTOR (RLS por app.cliente) deja ver
// TODAS las clínicas; la barrera entre clínicas es 100% código de app.
//
// Limpieza del presupuesto PG-only: vía SUPABASE_DB_URL_APP + SET LOCAL (rol de
// la app, guard-clean — nunca la URL admin en un script no-migración).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

// Flag de volteo: presupuestos+DEMO → PG (el mismo que activa el volteo real).
process.env.DATA_BACKEND_PG_DOMINIOS = "presupuestos";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { selectPresupuestosRaw, getPresupuestoPorIdRaw, createPresupuestoRaw } from "../app/lib/presupuestos/repo";
import { formulaClinicaPermitida, permiteClinica, verificarPresupuestoPermitido } from "../app/lib/presupuestos/clinica-scope";
import { listClinicas } from "../app/lib/auth/users";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const clinicaDe = (rec: any) => String(rec?.fields?.["Clinica"] ?? "");
const listar = (frag?: string) => selectPresupuestosRaw(frag === undefined ? {} : { filterByFormula: frag });
const MARK2 = "[QA_FIX2] pg-only";

async function limpiarPgOnly() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from presupuestos where notas like '[QA_FIX2]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} presupuesto(s) PG-only borrado(s)`);
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ limpieza PG-only falló:", e?.message); }
  finally { await c.end(); }
}

async function main() {
console.log("═".repeat(70));
console.log("  GATE FINAL — Escenario 2 (clínica↔clínica) · código real sobre Postgres");
console.log("═".repeat(70));

try {
await runWithCliente("DEMO", async () => {
  seccion("SANITY — el flag enruta presupuestos+DEMO a Postgres");
  ok("usaPostgres('presupuestos') = true en contexto DEMO", usaPostgres("presupuestos") === true);

  const todos = await listar(undefined);
  const porClinica: Record<string, number> = {};
  for (const r of todos) porClinica[clinicaDe(r)] = (porClinica[clinicaDe(r)] ?? 0) + 1;
  const clinicas = Object.keys(porClinica).filter(Boolean).sort();

  seccion("BASELINE — admin (sin restricción de clínica) ve todo su cliente");
  ok(`admin ve los ${todos.length} presupuestos DEMO (vía repo→PG)`, todos.length > 0, `${todos.length} filas`);
  console.log("  composición por clínica:", clinicas.map((c) => `${c}=${porClinica[c]}`).join("  "));
  ok(`hay ≥2 clínicas con presupuestos (necesario para el test)`, clinicas.length >= 2, `${clinicas.length} clínicas`);

  const [A, B] = clinicas;
  const otras = clinicas.filter((c) => c !== A);

  seccion("ESCENARIO 2 — coordinadora ve SOLO su(s) clínica(s)");
  const fragA = formulaClinicaPermitida(new Set([A]), "Clinica")!;
  const soloA = await listar(fragA);
  ok(`coordinadora de "${A}" ve solo su clínica`, soloA.every((r) => clinicaDe(r) === A), `${soloA.length} filas`);
  ok(`coordinadora de "${A}" ve exactamente ${porClinica[A]} (los de ${A})`, soloA.length === porClinica[A], `${soloA.length}/${porClinica[A]}`);
  ok(`coordinadora de "${A}" NO ve NINGUNA de las otras clínicas (${otras.join(", ")})`,
    soloA.every((r) => !otras.includes(clinicaDe(r))));

  const fragAB = formulaClinicaPermitida(new Set([A, B]), "Clinica")!;
  const AB = await listar(fragAB);
  const esperadoAB = porClinica[A] + porClinica[B];
  ok(`coordinadora de {"${A}","${B}"} ve exactamente ${esperadoAB}`, AB.length === esperadoAB, `${AB.length}/${esperadoAB}`);
  ok(`…y solo esas dos clínicas`, AB.every((r) => clinicaDe(r) === A || clinicaDe(r) === B));

  seccion("FAIL-CLOSED — coordinadora sin clínicas asignadas no ve nada");
  const fragVacio = formulaClinicaPermitida(new Set(), "Clinica");
  ok(`fragmento sin clínicas = "FALSE()"`, fragVacio === "FALSE()", String(fragVacio));
  ok(`coordinadora sin clínicas → 0 presupuestos`, (await listar(fragVacio!)).length === 0);

  seccion("ESCENARIO 3 (app-level) — IDOR por id de otra clínica del MISMO cliente");
  const victima = todos.find((r) => clinicaDe(r) === B);
  ok(`hay un presupuesto de "${B}" como víctima`, !!victima, victima ? `id=${victima.id}` : "no hay");
  if (victima) {
    const rec = await getPresupuestoPorIdRaw(victima.id, ["Clinica"]);
    ok(`el motor sirve el id dentro del cliente (clínica NO es barrera de motor)`, !!rec, "→ la barrera la pone el código de app");
    ok(`coordinadora de "${A}" → permiteClinica sobre presupuesto de "${B}" = DENEGADO`, permiteClinica(new Set([A]), clinicaDe(rec)) === false);
    ok(`el presupuesto de "${B}" NO aparece en el listado de una coord de "${A}"`, !soloA.some((r) => r.id === victima.id));
  }

  // ── FIX #2 — verificarPresupuestoPermitido de VERDAD sobre PG ──
  seccion("FIX #2 — verificarPresupuestoPermitido resuelve el presupuesto desde PG");
  const ident = await listClinicas({ cliente: "DEMO" as any });
  const idA = ident.find((c) => c.nombre === A)?.id;
  const idB = ident.find((c) => c.nombre === B)?.id;
  ok(`identidad DEMO mapea "${A}" y "${B}" a id de sesión`, !!idA && !!idB, `A=${idA} B=${idB}`);
  const presA = todos.find((r) => clinicaDe(r) === A);
  const presB = todos.find((r) => clinicaDe(r) === B);
  const coord: any = idA ? { userId: "qa", rol: "coordinacion", cliente: "DEMO", clinicasAccesibles: [idA], nombre: "QA Coord A" } : null;
  const coordB: any = idB ? { userId: "qa", rol: "coordinacion", cliente: "DEMO", clinicasAccesibles: [idB], nombre: "QA Coord B" } : null;
  const admin: any = { userId: "qa", rol: "admin", cliente: "DEMO", clinicasAccesibles: ["*"], nombre: "QA Admin" };

  if (coord && presA && presB) {
    ok(`coord de "${A}" abre su presupuesto seed → "ok"`, (await verificarPresupuestoPermitido(coord, presA.id)) === "ok");
    ok(`coord de "${A}" abre presupuesto de "${B}" → "forbidden"`, (await verificarPresupuestoPermitido(coord, presB.id)) === "forbidden");
    ok(`coord abre un id inexistente → "not_found" (no revienta)`, (await verificarPresupuestoPermitido(coord, "recQAxNoExiste0001")) === "not_found");
    ok(`admin (["*"]) → "ok" sin mirar clínica (control)`, (await verificarPresupuestoPermitido(admin, presB.id)) === "ok");
  } else {
    ok(`prerequisitos del test`, false, "falta idA/presA/presB — revisar identidad DEMO");
  }

  // ── DISCRIMINANTE — un presupuesto que existe SOLO en PG ──
  // Con la lectura Airtable vieja daba "not_found" (404 al coord); con el fix, "ok".
  seccion("FIX #2 — DISCRIMINANTE: presupuesto PG-only (el que rompía con Airtable)");
  await createPresupuestoRaw({ Estado: "PRESENTADO", Clinica: A, Notas: MARK2 });
  const nuevo = (await listar(`{Notas}='${MARK2}'`))[0];
  ok(`presupuesto creado SOLO en PG (no existe en Airtable)`, !!nuevo, nuevo ? `id=${nuevo.id}` : "no se creó");
  if (nuevo && coord && coordB) {
    const r1 = await verificarPresupuestoPermitido(coord, nuevo.id);
    ok(`coord de "${A}" abre su presupuesto PG-only → "ok" (con Airtable habría sido "not_found")`, r1 === "ok", `→ ${r1}`);
    const r2 = await verificarPresupuestoPermitido(coordB, nuevo.id);
    ok(`coord de "${B}" abre ese presupuesto PG-only de "${A}" → "forbidden"`, r2 === "forbidden", `→ ${r2}`);
  }
});
} finally {
  seccion("LIMPIEZA");
  await limpiarPgOnly();
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Escenario 2 + fix #2 VERDE — clínica aislada sobre PG por el código real.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s). SE PARA.\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); await limpiarPgOnly().catch(() => {}); process.exit(2); });
