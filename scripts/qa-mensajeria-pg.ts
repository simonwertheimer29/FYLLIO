#!/usr/bin/env node
// FASE 2 — volteo del LOG Mensajes_WhatsApp (mensajeria) sobre PG DEMO.
//   npx tsx scripts/qa-mensajeria-pg.ts
// Ejercita SOLO el registro del mensaje (crear via enviar/recibir manual, leer via
// historial y selectRaw). Idempotencia/WABA no se tocan. Incluye prueba de FK (§8):
// un presupuesto inexistente → INSERT rechazado en voz alta (no texto libre como Airtable).
// Limpieza vía SUPABASE_DB_URL_APP + SET LOCAL (guard-clean).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "mensajes";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { getServicioMensajeria, selectMensajesWhatsAppRaw } from "../app/lib/presupuestos/mensajeria";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_MSG]";

async function appClient() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}
async function limpiar() {
  const c = await appClient();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from mensajes_whatsapp where contenido like '[QA_MSG]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} mensaje(s) borrado(s)`);
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ limpieza falló:", e?.message); }
  finally { await c.end(); }
}

async function main() {
console.log("═".repeat(70));
console.log("  Volteo Mensajes_WhatsApp (log) — escritura ejercitada sobre Postgres (DEMO)");
console.log("═".repeat(70));

// un presupuesto DEMO real (para la FK compuesta presupuesto_id → presupuestos)
const c0 = await appClient();
await c0.query("begin");
await c0.query("select set_config('app.cliente','DEMO',true)");
const presRow = (await c0.query("select id from presupuestos where cliente='DEMO' limit 1")).rows[0];
await c0.query("commit"); await c0.end();
const presupuestoId = presRow?.id as string | undefined;

try {
await runWithCliente("DEMO", async () => {
  seccion("SANITY");
  ok("usaPostgres('mensajes') = true en DEMO", usaPostgres("mensajes") === true);
  ok("hay un presupuesto DEMO para la FK", !!presupuestoId, `id=${presupuestoId}`);

  const svc = getServicioMensajeria("manual");

  seccion("ENVIAR (Saliente) → HISTORIAL");
  const env = await svc.enviarMensaje({ presupuestoId, telefono: "600111222", contenido: `${MARK} hola paciente` });
  ok("enviarMensaje devuelve ok + mensajeId (uuid PG)", env.ok && !!env.mensajeId, `id=${env.mensajeId}`);
  ok("enviarMensaje genera urlWhatsApp (wa.me)", !!env.urlWhatsApp);

  seccion("RECIBIR (Entrante) → HISTORIAL ordenado");
  const rec = await svc.recibirMensaje({ presupuestoId, telefono: "600111222", contenido: `${MARK} respuesta` });
  ok("recibirMensaje devuelve ok + mensajeId", rec.ok && !!rec.mensajeId);

  const hist = await svc.getHistorialConversacion({ presupuestoId });
  const mios = hist.filter((m) => m.contenido.startsWith(MARK));
  ok("el historial trae los 2 mensajes del presupuesto", mios.length === 2, `n=${mios.length}`);
  ok("orden por Timestamp asc: Saliente antes que Entrante", mios[0]?.direccion === "Saliente" && mios[1]?.direccion === "Entrante");
  ok("mapeo de campos correcto (contenido/telefono/presupuestoId)", mios[0]?.telefono === "600111222" && mios[0]?.presupuestoId === presupuestoId);

  seccion("selectMensajesWhatsAppRaw (filtro por Presupuesto)");
  const raw = await selectMensajesWhatsAppRaw({ filterByFormula: `{Presupuesto}='${presupuestoId}'` });
  ok("selectRaw encuentra los mensajes del presupuesto", raw.filter((r: any) => String(r.fields?.["Contenido"] ?? "").startsWith(MARK)).length === 2);

  seccion("FK (§8) — presupuesto inexistente RECHAZADO en voz alta");
  let threw = false;
  try {
    await svc.enviarMensaje({ presupuestoId: "recNoExisteQA0001", telefono: "600111222", contenido: `${MARK} fantasma` });
  } catch { threw = true; }
  ok("enviarMensaje con presupuesto inexistente → lanza (FK compuesta, no texto libre)", threw);
});
} finally {
  seccion("LIMPIEZA");
  await limpiar();
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Mensajes_WhatsApp VERDE sobre PG (enviar/recibir/historial/FK) — idempotencia y WABA intactos.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); await limpiar().catch(() => {}); process.exit(2); });
