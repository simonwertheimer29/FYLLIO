#!/usr/bin/env node
// FASE 2 — volteo mini-dominio Alertas: cooldown + log + coordinación sobre PG DEMO.
//   npx tsx scripts/qa-alertas-pg.ts
// Tabla vacía en DEMO → sin golden; la validación es el ciclo real recordAlert →
// lastAlertFor → checkCooldown → listHistorial, más el path de coordinación
// (createAlertaCoordinacionRaw → selectAlertasEnviadasRaw con IS_AFTER/{Tipo}),
// todo a través del repo (delegado por flag) sobre Postgres.
// Limpieza vía SUPABASE_DB_URL_APP + SET LOCAL (guard-clean, nunca la URL admin).
//
// FK: admin_origen_id/coordinadora_destino_id apuntan a usuarios (aún NO migrada,
// RLS la ve vacía) → recordAlertPg los escribe NULL (misma decisión que pagos-pg
// usuario_creador_id). clinica_id sí es real (se toma una clínica DEMO existente).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "alertas";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import {
  recordAlert,
  lastAlertFor,
  checkCooldown,
  listHistorial,
  createAlertaCoordinacionRaw,
  selectAlertasEnviadasRaw,
} from "../app/lib/alertas/historial";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_ALERTAS]";

function pgClient() {
  return new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
}

async function getDemoClinicaId(): Promise<string | null> {
  const c = pgClient();
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const r = await c.query("select id from clinicas limit 1");
    await c.query("commit");
    return r.rows[0]?.id ?? null;
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ getDemoClinicaId falló:", e?.message); return null; }
  finally { await c.end(); }
}

async function limpiar() {
  const c = pgClient();
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from alertas_enviadas where mensaje like '[QA_ALERTAS]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} alerta(s) borrada(s)`);
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ limpieza falló:", e?.message); }
  finally { await c.end(); }
}

async function main() {
console.log("═".repeat(70));
console.log("  Volteo Alertas — cooldown + log + coordinación sobre Postgres (DEMO)");
console.log("═".repeat(70));

const clinicaId = await getDemoClinicaId();

try {
await runWithCliente("DEMO", async () => {
  seccion("SANITY");
  ok("usaPostgres('alertas') = true en DEMO", usaPostgres("alertas") === true);
  ok("hay una clínica DEMO real para el FK clinica_id", !!clinicaId, clinicaId ? `clinicaId=${clinicaId}` : "no hay clínicas DEMO");
  if (!clinicaId) throw new Error("sin clínica DEMO — no se puede ejercitar el FK clinica_id");

  seccion("recordAlert → devuelve AlertaEnviada (path cooldown/log)");
  const rec = await recordAlert({
    clinicaId,
    tipo: "leads",
    adminId: "recQA_admin_inexistente",
    coordinadoraId: "recQA_coord_inexistente",
    mensaje: `${MARK} leads sin gestionar`,
    error: false,
  });
  ok("recordAlert devuelve id", !!rec.id, `id=${rec.id}`);
  ok("clinicaId preservado (link Clinica → clinica_id → [id])", rec.clinicaId === clinicaId, `clinicaId=${rec.clinicaId}`);
  ok("tipo preservado (Tipo_Alerta, TEXT abierto)", rec.tipo === "leads", `tipo=${rec.tipo}`);
  ok("error=false preservado", rec.error === false);
  ok("mensaje preservado", rec.mensaje === `${MARK} leads sin gestionar`);
  ok("adminId=null (Usuarios central aún Airtable — decisión de link)", rec.adminId === null, `adminId=${rec.adminId}`);
  ok("coordinadoraId=null (idem)", rec.coordinadoraId === null, `coordinadoraId=${rec.coordinadoraId}`);
  ok("createdAt es ISO no vacío (created_at → createdTime)", !!rec.createdAt && !Number.isNaN(Date.parse(rec.createdAt)), `createdAt=${rec.createdAt}`);

  seccion("lastAlertFor + checkCooldown");
  const last = await lastAlertFor(clinicaId, "leads");
  ok("lastAlertFor encuentra la alerta recién registrada", last?.id === rec.id, last ? `id=${last.id}` : "null");
  const cd = await checkCooldown(clinicaId, "leads");
  ok("checkCooldown('leads') → blocked:true (cooldown 2h)", cd.blocked === true, `blocked=${cd.blocked}`);
  ok("retryAfterMs > 0 y <= 2h", cd.blocked === true && cd.retryAfterMs > 0 && cd.retryAfterMs <= 2 * 60 * 60 * 1000, cd.blocked ? `retryAfterMs=${cd.retryAfterMs}` : "");
  const cdOtro = await checkCooldown(clinicaId, "presupuestos");
  ok("checkCooldown('presupuestos') → blocked:false (otro tipo, sin alerta)", cdOtro.blocked === false);

  seccion("listHistorial");
  const hist = await listHistorial(50);
  ok("listHistorial incluye la alerta", hist.some((a) => a.id === rec.id), `n=${hist.length}`);
  ok("orden por createdAt desc (la más reciente primero)", hist.length === 0 || hist[0]!.createdAt >= hist[hist.length - 1]!.createdAt);

  seccion("Coordinación (createAlertaCoordinacionRaw → selectAlertasEnviadasRaw)");
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await createAlertaCoordinacionRaw({
    Resumen: `${MARK} coord dedupe`,
    Tipo: "qa_coord_test",
    Mensaje: `${MARK} coordinacion`,
    Urgencia: "alta",
    Created_At: new Date().toISOString(),
  });
  const found = await selectAlertasEnviadasRaw({
    filterByFormula: `AND({Tipo}="qa_coord_test", IS_AFTER({Created_At}, "${desde}"))`,
    maxRecords: 5,
  });
  ok("filtro {Tipo}+IS_AFTER({Created_At}) encuentra la alerta de coordinación", found.length >= 1, `n=${found.length}`);
  ok("shim con nombres Airtable (fields.Mensaje / fields.Tipo)", found[0]?.fields?.["Mensaje"]?.startsWith?.(MARK) === true && found[0]?.fields?.["Tipo"] === "qa_coord_test");
  ok("la alerta 'leads' NO matchea {Tipo}='qa_coord_test'", !found.some((r: any) => r.id === rec.id));
  const futuro = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const none = await selectAlertasEnviadasRaw({
    filterByFormula: `AND({Tipo}="qa_coord_test", IS_AFTER({Created_At}, "${futuro}"))`,
    maxRecords: 5,
  });
  ok("con ventana futura, IS_AFTER excluye la alerta (evaluador compartido)", none.length === 0, `n=${none.length}`);
});
} finally {
  seccion("LIMPIEZA");
  await limpiar();
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Alertas VERDE sobre PG (recordAlert/cooldown/historial/coordinación) — patrón mini-dominio validado.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); await limpiar().catch(() => {}); process.exit(2); });
