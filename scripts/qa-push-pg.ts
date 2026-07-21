#!/usr/bin/env node
// FASE 2 — volteo mini-dominio Push (push_subscriptions): los 5 accesos a datos
// ejercitados contra PG DEMO.  npx tsx scripts/qa-push-pg.ts
// La lógica webpush queda INTACTA; se validan create/find/fetch/deactivate/update
// (shim con nombres de campo en minúscula + evaluador compartido para {activa}/{clinica}).
// El smoke de envío real (sendPushToAll/Clinica) sólo corre si VAPID está AUSENTE,
// para no mutar suscripciones reales de DEMO.
// Limpieza finally vía SUPABASE_DB_URL_APP + SET LOCAL (guard-clean, nunca URL admin).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "push";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { usaPostgres } from "../app/lib/db/data-backend";
import {
  findSuscripcionPorEndpointRaw,
  updateSuscripcionRaw,
  createSuscripcionRaw,
  sendPushToAll,
  sendPushToClinica,
} from "../app/lib/push/sender";
// fetchSubscriptions/deactivateSubscription son internos en sender.ts; sus impls PG
// (exportadas para la delegación) se prueban directo — misma ruta de lectura/escritura.
import { fetchSubscriptionsPg, deactivateSubscriptionPg } from "../app/lib/push/sender-pg";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_PUSH]";
const ENDPOINT = `${MARK} https://qa.fyllio.test/push/${Date.now()}`;

async function limpiar() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from push_subscriptions where endpoint like '[QA_PUSH]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} suscripción(es) borrada(s)`);
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ limpieza falló:", e?.message); }
  finally { await c.end(); }
}

async function main() {
console.log("═".repeat(70));
console.log("  Volteo Push (push_subscriptions) — 5 accesos ejercitados sobre Postgres (DEMO)");
console.log("═".repeat(70));

try {
await runWithCliente("DEMO", async () => {
  seccion("SANITY");
  ok("usaPostgres('push') = true en DEMO", usaPostgres("push") === true);

  seccion("CREAR (createSuscripcionRaw, delegación) → BUSCAR POR ENDPOINT");
  await createSuscripcionRaw({
    endpoint: ENDPOINT,
    p256dh: "qa-p256dh-key",
    auth: "qa-auth-key",
    activa: true,
    clinica: "", // manager (sin clínica) → clinica_id null (FK-safe)
  });
  const rec = await findSuscripcionPorEndpointRaw(ENDPOINT);
  ok("la suscripción creada se encuentra por endpoint", !!rec, rec ? `id=${rec.id}` : "no aparece");
  ok("endpoint correcto (shim con nombre de campo en minúscula)", rec?.fields?.["endpoint"] === ENDPOINT);
  ok("p256dh/auth mapeados", rec?.fields?.["p256dh"] === "qa-p256dh-key" && rec?.fields?.["auth"] === "qa-auth-key");
  ok("activa=true en el shim (boolean, no descartado)", rec?.fields?.["activa"] === true, `activa=${rec?.fields?.["activa"]}`);
  ok("clinica vacía → shim SIN {clinica} (manager)", rec?.fields?.["clinica"] === undefined);

  seccion("fetchSubscriptions ({activa}=TRUE() / {clinica}) — evaluador compartido sobre PG");
  const activas = await fetchSubscriptionsPg("{activa}=TRUE()");
  ok("aparece en {activa}=TRUE()", activas.some((r: any) => r.id === rec?.id));
  const managers = await fetchSubscriptionsPg(`AND({activa}=TRUE(), {clinica}="")`);
  ok('aparece como manager en {clinica}=""', managers.some((r: any) => r.id === rec?.id));
  const orClinica = await fetchSubscriptionsPg(`AND({activa}=TRUE(), OR({clinica}="", {clinica}="RB_clinica_inexistente"))`);
  ok('sigue en la rama manager de OR({clinica}="", {clinica}=X)', orClinica.some((r: any) => r.id === rec?.id));
  const soloOtra = await fetchSubscriptionsPg(`AND({activa}=TRUE(), {clinica}="RB_clinica_inexistente")`);
  ok("NO aparece si el filtro exige otra clínica concreta", !soloOtra.some((r: any) => r.id === rec?.id));

  seccion("DESACTIVAR (deactivateSubscription interna, best-effort) → VERIFICAR");
  if (rec) await deactivateSubscriptionPg(rec.id);
  const activasTrasDeact = await fetchSubscriptionsPg("{activa}=TRUE()");
  ok("tras deactivateSubscription, DESAPARECE de {activa}=TRUE()", !activasTrasDeact.some((r: any) => r.id === rec?.id));
  const recInactiva = await findSuscripcionPorEndpointRaw(ENDPOINT);
  ok("sigue existiendo (find por endpoint) pero activa=false", !!recInactiva && recInactiva.fields?.["activa"] === false, `activa=${recInactiva?.fields?.["activa"]}`);

  seccion("REACTIVAR / DESACTIVAR (updateSuscripcionRaw, delegación — lo que hace la ruta)");
  if (rec) await updateSuscripcionRaw(rec.id, { p256dh: "qa-p256dh-2", auth: "qa-auth-2", activa: true, user_agent: "qa-agent" });
  const activasReact = await fetchSubscriptionsPg("{activa}=TRUE()");
  ok("tras updateSuscripcionRaw(activa:true), REAPARECE en {activa}=TRUE()", activasReact.some((r: any) => r.id === rec?.id));
  const recReact = await findSuscripcionPorEndpointRaw(ENDPOINT);
  ok("keys actualizadas por el update", recReact?.fields?.["p256dh"] === "qa-p256dh-2" && recReact?.fields?.["auth"] === "qa-auth-2");
  if (rec) await updateSuscripcionRaw(rec.id, { activa: false });
  const activasFin = await fetchSubscriptionsPg("{activa}=TRUE()");
  ok("tras updateSuscripcionRaw(activa:false), DESAPARECE de {activa}=TRUE()", !activasFin.some((r: any) => r.id === rec?.id));

  seccion("SMOKE delegación sender.ts (fetchSubscriptions interna vía sendPush*)");
  const vapidAusente = !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY;
  if (vapidAusente) {
    const rAll = await sendPushToAll({ title: "QA", body: "QA", url: "/", tag: "qa" });
    ok("sendPushToAll → {enviadas:0} sin romper la query (VAPID ausente)", !!rAll && rAll.enviadas === 0, JSON.stringify(rAll));
    const rCli = await sendPushToClinica("", { title: "QA", body: "QA", url: "/", tag: "qa" });
    ok('sendPushToClinica("") → {enviadas:0} sin romper la query', !!rCli && rCli.enviadas === 0, JSON.stringify(rCli));
  } else {
    console.log("  · VAPID presente en el entorno — smoke de envío real omitido (no mutar suscripciones reales). fetchSubscriptions ya validado directo arriba.");
  }
});
} finally {
  seccion("LIMPIEZA");
  await limpiar();
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Push VERDE sobre PG (create/find/fetch/deactivate/update) — patrón mini-dominio validado.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); await limpiar().catch(() => {}); process.exit(2); });
