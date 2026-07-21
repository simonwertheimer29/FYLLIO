#!/usr/bin/env node
// FASE 2 — volteo mini-dominio Informes (Informes_Guardados): escritura ejercitada contra PG DEMO.
//   npx tsx scripts/qa-informes-pg.ts
// Tabla vacía en DEMO (no la seedea db-seed-demo) → sin golden; la validación es el
// ciclo real crear→leer→update→verificar a través del repo (delegado por flag) sobre
// Postgres, incluida la traducción clinica(nombre)↔clinica_id y ambos sentinels globales.
// Limpieza vía SUPABASE_DB_URL_APP + SET LOCAL (guard-clean, nunca la URL admin).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "informes";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { selectInformesRaw, updateInformeRaw, createInformeRaw } from "../app/lib/informes";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_INFORMES]";
const CLINICA = "Clínica Demo Centro"; // clínica real en DEMO (JOIN clinica_id → nombre)

async function limpiar() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from informes_guardados where titulo like '[QA_INFORMES]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} informe(s) borrado(s)`);
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ limpieza falló:", e?.message); }
  finally { await c.end(); }
}

async function main() {
console.log("═".repeat(70));
console.log("  Volteo Informes — escritura ejercitada sobre Postgres (DEMO)");
console.log("═".repeat(70));

try {
await runWithCliente("DEMO", async () => {
  await limpiar(); // arranca de cero por si quedó basura de una corrida previa

  seccion("SANITY");
  ok("usaPostgres('informes') = true en DEMO", usaPostgres("informes") === true);

  // ── CREAR (clínica REAL) → LEER (filtro estilo caller) ────────────────────────
  seccion("CREAR (clínica real) → LEER");
  const nowISO = new Date().toISOString();
  const periodo1 = "2026-W30";
  const created = await createInformeRaw({
    tipo: "semanal", clinica: CLINICA, periodo: periodo1,
    titulo: `${MARK} semanal centro`,
    contenido_json: JSON.stringify({ totalNuevos: 3, tasa: 0.1 }),
    texto_narrativo: "Resumen QA.", generado_en: nowISO, generado_por: "qa",
  });
  ok("createInformeRaw devuelve ARRAY (paridad create([{fields}]))", Array.isArray(created), `typeof=${Array.isArray(created) ? "array" : typeof created}`);
  const rec0: any = Array.isArray(created) ? created[0] : created;
  ok("record[0] trae id", !!rec0?.id, `id=${rec0?.id}`);
  ok("clinica round-trip nombre→id→nombre", rec0?.fields?.["clinica"] === CLINICA, `clinica=${rec0?.fields?.["clinica"]}`);
  ok("tipo/periodo/titulo con nombres Airtable (snake_case minúscula)",
     rec0?.fields?.["tipo"] === "semanal" && rec0?.fields?.["periodo"] === periodo1 && rec0?.fields?.["titulo"] === `${MARK} semanal centro`);
  ok("contenido_json y texto_narrativo persistidos", !!rec0?.fields?.["contenido_json"] && rec0?.fields?.["texto_narrativo"] === "Resumen QA.");

  const filtroCaller = `AND({tipo}='semanal',{clinica}='${CLINICA}',{periodo}='${periodo1}')`;
  const leidos = await selectInformesRaw({
    fields: ["tipo", "clinica", "periodo", "titulo", "contenido_json", "texto_narrativo", "generado_en", "generado_por"],
    filterByFormula: filtroCaller, sort: [{ field: "generado_en", direction: "desc" }], maxRecords: 50,
  });
  const leido = leidos.find((r: any) => r.id === rec0?.id);
  ok("se lee de vuelta con el filtro exacto del caller (evaluador compartido)", !!leido, leido ? `id=${leido.id}` : "no aparece");
  ok("el filtro resuelve {clinica}='<nombre real>' (traducción JOIN)", leidos.length >= 1 && leidos.every((r: any) => r.fields?.["clinica"] === CLINICA));

  // ── UPSERT existing-lookup (como la ruta POST) ────────────────────────────────
  seccion("UPSERT — lookup de existente (estilo ruta POST)");
  const existing = await selectInformesRaw({ filterByFormula: filtroCaller, maxRecords: 1, fields: ["tipo"] });
  ok("el existente aparece exactamente una vez (upsert encontraría match)", existing.length === 1, `n=${existing.length}`);

  // ── GLOBAL "todas" (Presupuestos) → clinica_id null → reconstruido ────────────
  seccion("BUCKET GLOBAL 'todas' (Presupuestos)");
  const cTodas = await createInformeRaw({ tipo: "semanal", clinica: "todas", periodo: "2026-W31", titulo: `${MARK} semanal todas`, generado_en: nowISO, generado_por: "sistema" });
  const recTodas: any = cTodas[0];
  ok("clinica 'todas' round-trip (write→null→read 'todas')", recTodas?.fields?.["clinica"] === "todas", `clinica=${recTodas?.fields?.["clinica"]}`);
  const globTodas = await selectInformesRaw({ filterByFormula: `OR({clinica}='${CLINICA}',{clinica}='todas')`, maxRecords: 200 });
  ok("el informe global aparece bajo {clinica}='todas'", globTodas.some((r: any) => r.id === recTodas?.id));

  // ── GLOBAL "Todas" (No-Shows) → tipo noshow* → reconstruido con casing ────────
  seccion("BUCKET GLOBAL 'Todas' (No-Shows, tipo-aware)");
  const cNS = await createInformeRaw({ tipo: "noshow_semanal", clinica: "Todas", periodo: "2026-W31", titulo: `${MARK} noshow todas`, generado_en: nowISO, generado_por: "sistema" });
  const recNS: any = cNS[0];
  ok("clinica 'Todas' round-trip con casing (tipo noshow*)", recNS?.fields?.["clinica"] === "Todas", `clinica=${recNS?.fields?.["clinica"]}`);
  const globNS = await selectInformesRaw({ filterByFormula: `OR({clinica}='Clínica X',{clinica}='Todas')`, maxRecords: 200 });
  ok("el informe noshow global aparece bajo {clinica}='Todas'", globNS.some((r: any) => r.id === recNS?.id));

  // ── UPDATE → devuelve el record (no array) ────────────────────────────────────
  seccion("UPDATE → VERIFICAR");
  const upd = await updateInformeRaw(rec0.id, { titulo: `${MARK} semanal centro v2`, generado_por: "qa2" });
  ok("updateInformeRaw devuelve el record (no array — paridad update(id,fields))", !!upd && !Array.isArray(upd) && !!upd.id, `id=${upd?.id}`);
  ok("el update refleja el nuevo titulo/generado_por", upd?.fields?.["titulo"] === `${MARK} semanal centro v2` && upd?.fields?.["generado_por"] === "qa2");
  const reLeido = (await selectInformesRaw({ filterByFormula: `{titulo}='${MARK} semanal centro v2'`, maxRecords: 5 })).find((r: any) => r.id === rec0.id);
  ok("re-lectura confirma el update persistido", reLeido?.fields?.["titulo"] === `${MARK} semanal centro v2`, `titulo=${reLeido?.fields?.["titulo"]}`);
  ok("update NO tocó clinica (sigue siendo la clínica real)", reLeido?.fields?.["clinica"] === CLINICA, `clinica=${reLeido?.fields?.["clinica"]}`);

  // ── SORT generado_en desc ─────────────────────────────────────────────────────
  seccion("SORT generado_en desc");
  await createInformeRaw({ tipo: "mensual", clinica: CLINICA, periodo: "2099-12", titulo: `${MARK} futuro`, generado_en: "2099-12-31T00:00:00.000Z", generado_por: "qa" });
  const todos = await selectInformesRaw({ filterByFormula: `FIND('${MARK}', {titulo}) > 0`, sort: [{ field: "generado_en", direction: "desc" }], maxRecords: 50 });
  ok("el más reciente (2099) queda primero con sort generado_en desc", todos[0]?.fields?.["titulo"] === `${MARK} futuro`, `primero=${todos[0]?.fields?.["titulo"]}`);
});
} finally {
  seccion("LIMPIEZA");
  await limpiar();
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Informes VERDE sobre PG (crear/leer/filtro/clinica↔id/sentinels/update/sort) — patrón mini-dominio validado.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); await limpiar().catch(() => {}); process.exit(2); });
