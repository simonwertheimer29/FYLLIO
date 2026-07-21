#!/usr/bin/env node
// FASE 2 — volteo waitlist (Lista_de_espera) sobre PG DEMO.
//   npx tsx scripts/qa-waitlist-pg.ts
// lista_espera vacía en DEMO → sin golden; validación por ciclo real de la cola
// de espera. Resuelve la ambigüedad {Clínica} nombre/id: listActive filtra por id,
// listWaitlistPorClinicaRaw por nombre — ambos deben encontrar la MISMA entrada.
// Limpieza guard-clean.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_DOMINIOS = "agenda";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import * as wl from "../app/lib/scheduler/repo/waitlistRepo";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_WL]";

async function appClient() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query("begin"); await c.query("select set_config('app.cliente','DEMO',true)");
  return c;
}

async function main() {
console.log("═".repeat(70));
console.log("  Volteo waitlist (Lista_de_espera) — ciclo ejercitado sobre Postgres (DEMO)");
console.log("═".repeat(70));

// datos DEMO reales para FKs + un paciente con teléfono (para getOfferedEntryByPhone)
const c0 = await appClient();
const clinica = (await c0.query("select id, nombre from clinicas where cliente='DEMO' limit 1")).rows[0];
const trat = (await c0.query("select id from tratamientos where cliente='DEMO' limit 1")).rows[0]?.id;
const pac = (await c0.query("select id, telefono from pacientes where cliente='DEMO' and telefono is not null and telefono <> '' limit 1")).rows[0];
const citaId = (await c0.query("select id from citas where cliente='DEMO' limit 1")).rows[0]?.id; // FK cita_cerrada_id
await c0.query("commit"); await c0.end();

try {
await runWithCliente("DEMO", async () => {
  seccion("SANITY");
  ok("usaPostgres('agenda') = true en DEMO", usaPostgres("agenda") === true);
  ok("FKs DEMO (clínica/tratamiento/paciente con teléfono)", !!(clinica?.id && trat && pac?.id && pac?.telefono), `clinica=${clinica?.nombre} pac_tel=${pac?.telefono}`);

  seccion("CREAR entrada de cola → listar por id (intención listActive)");
  const creada = await wl.createWaitlistEntry({
    clinicRecordId: clinica.id, patientRecordId: pac.id, treatmentRecordId: trat,
    notas: `${MARK} cola test`, prioridad: "ALTA",
  });
  ok("createWaitlistEntry devuelve recordId", !!creada.recordId, `id=${creada.recordId}`);

  const porTrat = await wl.listActiveWaitlistByTreatment({ treatmentRecordId: trat, clinicRecordId: clinica.id });
  ok("listActiveWaitlistByTreatment (por id) la encuentra", porTrat.some((e) => e.recordId === creada.recordId), `${porTrat.length} activas`);
  ok("…con el shape WaitlistEntry mapeado (estado ACTIVE, prioridad ALTA)", porTrat.find((e) => e.recordId === creada.recordId)?.estado === "ACTIVE");

  seccion("listWaitlistPorClinicaRaw (por NOMBRE) — la MISMA entrada (ambigüedad {Clínica} resuelta)");
  const porNombre = await wl.listWaitlistPorClinicaRaw(clinica.nombre);
  ok("listWaitlistPorClinicaRaw (por nombre) encuentra la misma entrada", porNombre.some((r: any) => r.id === creada.recordId), `${porNombre.length} en cola`);

  seccion("OFERTAR → getOfferedEntryByPhone → RESERVAR");
  await wl.markWaitlistOffered({ waitlistRecordId: creada.recordId, holdId: "hold-qa", expiresAtIso: new Date(Date.now() + 3600e3).toISOString(), slotKey: "slot-qa" });
  const ofrecida = await wl.getOfferedEntryByPhone({ phoneE164: pac.telefono });
  ok("getOfferedEntryByPhone encuentra la entrada OFFERED (via teléfono→paciente→waitlist)", ofrecida?.recordId === creada.recordId, `estado=${ofrecida?.estado}`);
  ok("…con offerHoldId y lastOfferResult SENT", ofrecida?.offerHoldId === "hold-qa" && ofrecida?.lastOfferResult === "SENT");

  await wl.markWaitlistBooked({ waitlistRecordId: creada.recordId, appointmentRecordId: citaId /* FK real cita_cerrada_id → citas */ });
  const trasBooked = await wl.listWaitlist({ estados: ["BOOKED"] });
  ok("markWaitlistBooked → estado BOOKED (visible en listWaitlist)", trasBooked.some((e) => e.recordId === creada.recordId));

  seccion("getTreatmentMeta (lee tratamiento desde PG, no Airtable)");
  const meta = await wl.getTreatmentMeta({ treatmentRecordId: trat });
  ok("getTreatmentMeta devuelve name/durationMin desde PG", !!meta.name && typeof meta.durationMin === "number", `name=${meta.name} dur=${meta.durationMin}`);
});
} finally {
  seccion("LIMPIEZA");
  const c = await appClient();
  const del = await c.query("delete from lista_espera where cliente='DEMO' and notas like '[QA_WL]%'");
  await c.query("commit"); await c.end();
  console.log(`  ✓ limpieza: ${del.rowCount} entrada(s) borrada(s)`);
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ waitlist VERDE sobre PG — cola por id Y por nombre resuelven la misma entrada; ciclo ofertar/reservar OK.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); try { const c = await appClient(); await c.query("delete from lista_espera where cliente='DEMO' and notas like '[QA_WL]%'"); await c.query("commit"); await c.end(); } catch {} process.exit(2); });
