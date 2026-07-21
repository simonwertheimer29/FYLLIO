#!/usr/bin/env node
// FASE 2 · GATE FINAL — Escenario 2 (clínica↔clínica) contra el CÓDIGO REAL sobre Postgres.
//
//   npx tsx scripts/qa-clinica-pg.ts
//
// El aislamiento clínica↔clínica NO vive en RLS (eso es FASE 3) — es app-level:
// los handlers filtran con `formulaClinicaPermitida()` y autorizan con
// `permiteClinica()` / `verificarPresupuestoPermitido()`. Este harness ejercita
// ESAS MISMAS piezas contra el read-path PG real (selectPresupuestosRawPg), con
// el seed DEMO (Centro/Sur/Norte/Este), intentando ver clínicas ajenas (§5).
//
// Punto honesto que este test hace explícito: dentro de un cliente, el MOTOR
// (RLS por app.cliente) deja ver TODAS las clínicas; la barrera entre clínicas
// es 100% código de app. Por eso se prueba el código, no el motor.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { runWithCliente } from "../app/lib/airtable";
import { selectPresupuestosRawPg, getPresupuestoPorIdRawPg } from "../app/lib/presupuestos/pg";
import { formulaClinicaPermitida, permiteClinica } from "../app/lib/presupuestos/clinica-scope";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const clinicaDe = (rec: any) => String(rec.fields?.["Clinica"] ?? "");
const listar = (frag?: string) => selectPresupuestosRawPg(frag === undefined ? {} : { filterByFormula: frag });

async function main() {
console.log("═".repeat(70));
console.log("  GATE FINAL — Escenario 2 (clínica↔clínica) · código real sobre Postgres");
console.log("═".repeat(70));

await runWithCliente("DEMO", async () => {
  // baseline admin: todo DEMO, agrupado por clínica (fuente de verdad del seed)
  const todos = await listar(undefined);
  const porClinica: Record<string, number> = {};
  for (const r of todos) porClinica[clinicaDe(r)] = (porClinica[clinicaDe(r)] ?? 0) + 1;
  const clinicas = Object.keys(porClinica).filter(Boolean).sort();

  seccion("BASELINE — admin (sin restricción de clínica) ve todo su cliente");
  ok(`admin ve los ${todos.length} presupuestos DEMO`, todos.length > 0, `${todos.length} filas`);
  console.log("  composición por clínica:", clinicas.map((c) => `${c}=${porClinica[c]}`).join("  "));
  ok(`hay ≥2 clínicas con presupuestos (necesario para el test)`, clinicas.length >= 2, `${clinicas.length} clínicas`);

  const [A, B] = clinicas; // dos clínicas reconocibles del seed
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
  const fragVacio = formulaClinicaPermitida(new Set(), "Clinica"); // → "FALSE()"
  ok(`fragmento sin clínicas = "FALSE()"`, fragVacio === "FALSE()", String(fragVacio));
  const nada = await listar(fragVacio!);
  ok(`coordinadora sin clínicas → 0 presupuestos`, nada.length === 0, `${nada.length} filas`);

  seccion("ESCENARIO 3 (app-level) — IDOR por id de otra clínica del MISMO cliente");
  const victima = todos.find((r) => clinicaDe(r) === B);
  ok(`hay un presupuesto de "${B}" como víctima`, !!victima, victima ? `id=${victima.id}` : "no hay");
  if (victima) {
    const rec = await getPresupuestoPorIdRawPg(victima.id);
    ok(`el motor sirve el id dentro del cliente (clínica NO es barrera de motor)`, !!rec, "→ la barrera la pone el código de app");
    const decision = permiteClinica(new Set([A]), clinicaDe(rec));
    ok(`coordinadora de "${A}" → permiteClinica sobre presupuesto de "${B}" = DENEGADO`, decision === false, `verificarPresupuestoPermitido devolvería "forbidden" → 404`);
    ok(`control: coordinadora de "${B}" → permiteClinica = permitido`, permiteClinica(new Set([B]), clinicaDe(rec)) === true);
    ok(`el presupuesto de "${B}" NO aparece en el listado de una coord de "${A}"`, !soloA.some((r) => r.id === victima.id));
  }
});

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Escenario 2 VERDE — el filtro de clínica del código real aísla sobre datos PG.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s). SE PARA.\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); process.exit(2); });
