#!/usr/bin/env node
// FASE 2 — volteo mini-dominio Vapi (Llamadas_Vapi): ciclo real ejercitado sobre PG DEMO.
//   npx tsx scripts/qa-vapi-pg.ts
// Tabla vacía en DEMO → sin golden; la validación es el ciclo crear→leer(get/porVapiCallId/
// list)→contar→actualizar→verificar a través del repo (delegado por flag) sobre Postgres.
// Marcador de limpieza en vapi_call_id="[QA_VAPI]..." (el resumen se auto-genera y no lleva
// el marcador). FK paciente_id → usamos un paciente DEMO real. Limpieza vía
// SUPABASE_DB_URL_APP + SET LOCAL (guard-clean, nunca la URL admin).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "vapi";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import {
  createLlamada,
  updateLlamada,
  getLlamada,
  getLlamadaPorVapiCallId,
  listLlamadas,
  pacienteLlamadoUltimas24h,
  contarLlamadasHoyPorPaciente,
  contarLlamadasHoy,
  tasaFallidasUltimaHora,
} from "../app/lib/llamadas/repo";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_VAPI]";
const marker = () => `${MARK}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function guardClient() {
  return new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
}

async function pacienteDemoId(): Promise<string | null> {
  const c = guardClient();
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const r = await c.query("select id from pacientes order by created_at asc limit 1");
    await c.query("commit");
    return r.rows[0]?.id ?? null;
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ lookup paciente DEMO falló:", e?.message); return null; }
  finally { await c.end(); }
}

async function limpiar() {
  const c = guardClient();
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from llamadas_vapi where vapi_call_id like '[QA_VAPI]%' or resumen like '[QA_VAPI]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} llamada(s) borrada(s)`);
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ limpieza falló:", e?.message); }
  finally { await c.end(); }
}

async function main() {
console.log("═".repeat(70));
console.log("  Volteo Vapi (Llamadas_Vapi) — ciclo real sobre Postgres (DEMO)");
console.log("═".repeat(70));

try {
await runWithCliente("DEMO", async () => {
  seccion("SANITY");
  ok("usaPostgres('vapi') = true en DEMO", usaPostgres("vapi") === true);

  const pacienteId = await pacienteDemoId();
  ok("hay un paciente DEMO real para la FK paciente_id", !!pacienteId, pacienteId ? `id=${pacienteId}` : "NO hay pacientes en DEMO");
  if (!pacienteId) throw new Error("sin paciente DEMO — no se puede ejercitar la FK");

  seccion("CREAR → LEER (get / porVapiCallId / list)");
  const vapiId = marker();
  const creada = await createLlamada({
    pacienteId,
    tipo: "confirmacion_cita",
    vapiCallId: vapiId,
    estado: "iniciada",
    notas: `${MARK} llamada de prueba`,
  });
  ok("createLlamada devuelve id", !!creada.id, `id=${creada.id}`);
  ok("estado='iniciada' (default de creación)", creada.estado === "iniciada", `estado=${creada.estado}`);
  ok("resultado='sin_resultado' (default)", creada.resultado === "sin_resultado", `resultado=${creada.resultado}`);
  ok("pacienteId mapeado desde Paciente_Link", creada.pacienteId === pacienteId, `pacienteId=${creada.pacienteId}`);
  ok("vapiCallId round-trip", creada.vapiCallId === vapiId, `vapiCallId=${creada.vapiCallId}`);
  ok("iniciadaAt es ISO no vacío", !!creada.iniciadaAt && !Number.isNaN(Date.parse(creada.iniciadaAt)), `iniciadaAt=${creada.iniciadaAt}`);
  ok("notas round-trip", creada.notas === `${MARK} llamada de prueba`, `notas=${creada.notas}`);

  const porId = await getLlamada(creada.id);
  ok("getLlamada(id) la encuentra", porId?.id === creada.id, porId ? `id=${porId.id}` : "null");
  const porVapi = await getLlamadaPorVapiCallId(vapiId);
  ok("getLlamadaPorVapiCallId la encuentra", porVapi?.id === creada.id, porVapi ? `id=${porVapi.id}` : "null");
  ok("getLlamada de un id inexistente → null", (await getLlamada("recNoExisteQA000001")) === null);

  const porPaciente = await listLlamadas({ pacienteId });
  ok("listLlamadas({pacienteId}) la incluye", porPaciente.some((l) => l.id === creada.id), `${porPaciente.length} filas`);
  const porEstado = await listLlamadas({ estado: "iniciada" });
  ok("listLlamadas({estado:'iniciada'}) la incluye", porEstado.some((l) => l.id === creada.id), `${porEstado.length} filas`);
  ok("listLlamadas({estado:'iniciada'}) → todas 'iniciada'", porEstado.every((l) => l.estado === "iniciada"));
  const desde = new Date(Date.now() - 3600 * 1000).toISOString();
  const porVentana = await listLlamadas({ pacienteId, desde });
  ok("listLlamadas({pacienteId, desde}) (IS_AFTER) la incluye", porVentana.some((l) => l.id === creada.id), `${porVentana.length} filas`);

  seccion("CONTAR / COOLDOWN (fórmulas IS_AFTER + FIND/ARRAYJOIN por evaluador compartido)");
  ok("contarLlamadasHoy() ≥ 1", (await contarLlamadasHoy()) >= 1);
  ok("contarLlamadasHoyPorPaciente([pac]) ≥ 1", (await contarLlamadasHoyPorPaciente([pacienteId])) >= 1);
  ok("contarLlamadasHoyPorPaciente([]) = 0", (await contarLlamadasHoyPorPaciente([])) === 0);
  ok("pacienteLlamadoUltimas24h(pac) = true", (await pacienteLlamadoUltimas24h(pacienteId)) === true);
  const tasaAntes = await tasaFallidasUltimaHora();
  ok("tasaFallidasUltimaHora().total ≥ 1 (incluye la nuestra)", tasaAntes.total >= 1, `total=${tasaAntes.total} fallidas=${tasaAntes.fallidas} pct=${tasaAntes.pct}`);

  seccion("ACTUALIZAR → VERIFICAR");
  const finAt = new Date().toISOString();
  const upd = await updateLlamada(creada.id, {
    estado: "completada",
    resultado: "confirmada",
    finalizadaAt: finAt,
    duracionSegundos: 42,
    costeUSD: 0.15,
  });
  ok("updateLlamada devuelve estado='completada'", upd.estado === "completada", `estado=${upd.estado}`);
  ok("resultado='confirmada'", upd.resultado === "confirmada", `resultado=${upd.resultado}`);
  ok("finalizadaAt seteado", !!upd.finalizadaAt && !Number.isNaN(Date.parse(upd.finalizadaAt!)), `finalizadaAt=${upd.finalizadaAt}`);
  ok("duracionSegundos=42 (integer)", upd.duracionSegundos === 42, `duracionSegundos=${upd.duracionSegundos}`);
  ok("costeUSD=0.15 (numeric → number)", upd.costeUSD === 0.15, `costeUSD=${upd.costeUSD}`);

  const releida = await getLlamada(creada.id);
  ok("relectura confirma estado='completada'", releida?.estado === "completada", `estado=${releida?.estado}`);
  ok("relectura confirma costeUSD=0.15", releida?.costeUSD === 0.15, `costeUSD=${releida?.costeUSD}`);
  ok("ya NO aparece en list({estado:'iniciada'})", !(await listLlamadas({ estado: "iniciada" })).some((l) => l.id === creada.id));
  ok("aparece en list({estado:'completada'})", (await listLlamadas({ estado: "completada" })).some((l) => l.id === creada.id));

  seccion("BRANCH fallida — tasaFallidasUltimaHora cuenta fallidas");
  const vapiFail = marker();
  const fallida = await createLlamada({ pacienteId, tipo: "reactivacion", vapiCallId: vapiFail, estado: "iniciada", notas: `${MARK} fallida` });
  await updateLlamada(fallida.id, { estado: "fallida", resultado: "no_contesta" });
  const tasaDespues = await tasaFallidasUltimaHora();
  ok("tasaFallidasUltimaHora().fallidas ≥ 1 tras marcar una 'fallida'", tasaDespues.fallidas >= 1, `total=${tasaDespues.total} fallidas=${tasaDespues.fallidas} pct=${tasaDespues.pct}`);
  ok("getLlamadaPorVapiCallId(fallida) → estado='fallida'", (await getLlamadaPorVapiCallId(vapiFail))?.estado === "fallida");
});
} finally {
  seccion("LIMPIEZA");
  await limpiar();
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Vapi VERDE sobre PG (crear/leer/contar/cooldown/actualizar) — patrón mini-dominio validado.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); await limpiar().catch(() => {}); process.exit(2); });
