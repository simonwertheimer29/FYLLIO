#!/usr/bin/env node
// FASE 2 — volteo mini-dominio Notificaciones: escritura ejercitada contra PG DEMO.
//   npx tsx scripts/qa-notificaciones-pg.ts
// Tabla vacía en DEMO → sin golden; la validación es el ciclo real crear→leer→
// marcar-leída→verificar a través del repo (delegado por flag) sobre Postgres.
// Limpieza vía SUPABASE_DB_URL_APP + SET LOCAL (guard-clean, nunca la URL admin).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "notificaciones";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { crearNotificacion, selectNotificacionesRaw, updateNotificacionesBatchRaw } from "../app/lib/presupuestos/notificaciones";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_NOTIF]";

async function limpiar() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from notificaciones where titulo like '[QA_NOTIF]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} notificación(es) borrada(s)`);
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ limpieza falló:", e?.message); }
  finally { await c.end(); }
}

async function main() {
console.log("═".repeat(70));
console.log("  Volteo Notificaciones — escritura ejercitada sobre Postgres (DEMO)");
console.log("═".repeat(70));

try {
await runWithCliente("DEMO", async () => {
  seccion("SANITY");
  ok("usaPostgres('notificaciones') = true en DEMO", usaPostgres("notificaciones") === true);

  seccion("CREAR → LEER");
  await crearNotificacion({ usuario: "todos", tipo: "Sistema" as any, titulo: `${MARK} respuesta paciente`, mensaje: "Bruno respondió", link: "/presupuestos" });
  const frag = `OR({Usuario}='todos', {Usuario}='qa@fyllio.test')`;
  const lista = await selectNotificacionesRaw({ fields: ["Usuario", "Tipo", "Titulo", "Mensaje", "Link", "Leida", "Fecha_creacion"], filterByFormula: frag, sort: [{ field: "Fecha_creacion", direction: "desc" }], maxRecords: 50 });
  const creada = lista.find((r: any) => r.fields?.["Titulo"] === `${MARK} respuesta paciente`);
  ok("la notificación creada se lee de vuelta", !!creada, creada ? `id=${creada.id}` : "no aparece");
  ok("llega como NO leída (Leida=false)", creada?.fields?.["Leida"] === false, `Leida=${creada?.fields?.["Leida"]}`);
  ok("Usuario='todos' y Titulo correctos (shim con nombres Airtable)", creada?.fields?.["Usuario"] === "todos");

  seccion("FILTRO {Leida}=FALSE() (evaluador compartido) — antes de marcar");
  const noLeidasAntes = await selectNotificacionesRaw({ filterByFormula: `AND(OR({Usuario}='todos', {Usuario}='qa@fyllio.test'), {Leida}=FALSE())`, maxRecords: 200 });
  ok("la no-leída aparece en el filtro {Leida}=FALSE()", noLeidasAntes.some((r: any) => r.id === creada?.id));

  seccion("MARCAR LEÍDA → VERIFICAR");
  if (creada) await updateNotificacionesBatchRaw([{ id: creada.id, fields: { Leida: true } }]);
  const noLeidasDespues = await selectNotificacionesRaw({ filterByFormula: `AND(OR({Usuario}='todos', {Usuario}='qa@fyllio.test'), {Leida}=FALSE())`, maxRecords: 200 });
  ok("tras marcar, DESAPARECE del filtro {Leida}=FALSE()", !noLeidasDespues.some((r: any) => r.id === creada?.id));
  const todas = await selectNotificacionesRaw({ filterByFormula: frag, maxRecords: 50 });
  const ahora = todas.find((r: any) => r.id === creada?.id);
  ok("sigue existiendo pero con Leida=true", ahora?.fields?.["Leida"] === true, `Leida=${ahora?.fields?.["Leida"]}`);
});
} finally {
  seccion("LIMPIEZA");
  await limpiar();
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Notificaciones VERDE sobre PG (crear/leer/filtro/marcar) — patrón mini-dominio validado.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); await limpiar().catch(() => {}); process.exit(2); });
