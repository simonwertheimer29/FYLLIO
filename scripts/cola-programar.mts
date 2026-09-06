// scripts/cola-programar.mts
//
// Crea (o actualiza) en QStash el disparador periódico de /api/cron/reevaluar
// (MEJORAS 163/164): Vercel Hobby solo permite dos crons diarios, así que el
// suelo «cada pocos minutos» del barrido lo pone la cola. Cada 10 minutos:
// 144 mensajes/día, dentro del plan gratuito de QStash (500/día) con margen
// para los turnos.
//
//   COLA_URL_BASE=https://<producción> npm run cola:programar
//
// Necesita QSTASH_TOKEN y CRON_SECRET (viaja como cabecera x-cron-secret,
// guardada en QStash — el mismo proveedor que ya tiene nuestro token).

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { Client } from "@upstash/qstash";

const SCHEDULE_ID = "fyllio-reevaluar";
const CRON = "*/10 * * * *";

async function main() {
  const token = process.env.QSTASH_TOKEN;
  const secret = process.env.CRON_SECRET;
  const base = process.env.COLA_URL_BASE?.trim().replace(/\/+$/, "");
  if (!token || !secret || !base) {
    console.error("✗ faltan variables: QSTASH_TOKEN, CRON_SECRET y COLA_URL_BASE (la URL pública de producción)");
    process.exit(2);
  }
  if (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) {
    console.error(`✗ COLA_URL_BASE tiene que ser una URL pública https (recibido: ${base})`);
    process.exit(2);
  }
  const client = new Client({ token });
  const destination = `${base}/api/cron/reevaluar?tope=10`;
  const r = await client.schedules.create({
    destination,
    cron: CRON,
    scheduleId: SCHEDULE_ID,
    headers: { "x-cron-secret": secret },
    retries: 1,
  });
  console.log(`✓ programado ${SCHEDULE_ID} (${CRON}) → ${destination}`);
  console.log(`  id: ${r.scheduleId}`);
  const todas = await client.schedules.list();
  for (const s of todas) console.log(`  · ${s.scheduleId} ${s.cron} → ${s.destination}`);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
