// scripts/metricas-backfill.mts
//
// Rellena `metricas_diarias` hacia atrás (MEJORAS 172) para un cliente: la red y
// cada clínica activa, día a día. Lo usa `demo:reset` (la demo tiene que poder
// comparar sedes) y sirve para el histórico real cuando haya clientes.
//
//   tsx scripts/metricas-backfill.mts --cliente DEMO --dias 45
//   tsx scripts/metricas-backfill.mts --cliente RB --desde 2026-06-01 --hasta 2026-06-30

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { DateTime } from "luxon";
import { runWithCliente, type Cliente } from "../app/lib/airtable";
import { backfill, ayerISO } from "../app/lib/metricas/diarias";
import { TZ_CLINICA } from "../app/lib/time";

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const cliente = (arg("cliente") ?? "DEMO") as Cliente;
  if (!["RB", "INDEP", "DEMO"].includes(cliente)) {
    console.error(`✗ cliente desconocido: ${cliente}`);
    process.exit(2);
  }
  const hasta = arg("hasta") ?? ayerISO();
  const dias = Number(arg("dias") ?? 45);
  const desde = arg("desde") ?? DateTime.fromISO(hasta, { zone: TZ_CLINICA }).minus({ days: Math.max(1, dias) - 1 }).toISODate() ?? hasta;
  console.log(`metricas backfill ${cliente}: ${desde} → ${hasta}`);
  const t0 = Date.now();
  let total = 0;
  let cursor = DateTime.fromISO(desde, { zone: TZ_CLINICA });
  const fin = DateTime.fromISO(hasta, { zone: TZ_CLINICA });
  while (cursor <= fin) {
    const tramoFin = DateTime.min(cursor.plus({ days: 30 }), fin);
    const r = await runWithCliente(cliente, () => backfill({ cliente, desde: cursor.toISODate() ?? "", hasta: tramoFin.toISODate() ?? "", tope: 31 }));
    total += r.escritas;
    console.log(`  ${cursor.toISODate()} → ${tramoFin.toISODate()}: ${r.dias} días, ${r.escritas} filas`);
    cursor = tramoFin.plus({ days: 1 });
  }
  console.log(`✓ ${total} filas en ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(0);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
