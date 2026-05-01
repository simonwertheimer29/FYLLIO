// app/scripts/sprint14-backfill-tipo-legacy.ts
//
// Sprint 14a Bloque 6 — backfill mapeo legacy del enum Pagos_Paciente.Tipo:
//   Pago_Unico → Liquidacion (asumimos pago al contado = liquidacion).
//   Cuota      → Primer_Pago_Plan (asumimos primera cuota visible).
//
// El typecast:true al hacer update permite que Airtable extienda el
// enum con "Primer_Pago_Plan" la primera vez (Metadata API no permite
// añadir choices a singleSelect existente).
//
// Idempotente: skip si ya esta mapeado (no hay registros con Pago_Unico
// ni Cuota).
//
// Modos:
//   --dry-run
//   (sin flag)  apply
//   --apply-prod   permite Prod

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY_PROD = process.argv.includes("--apply-prod");
const PROD_BASE_ID = "appfUJcyGnkZ16Fhr";
const BASE_ID = process.env.AIRTABLE_BASE_ID ?? "?";

if (BASE_ID === PROD_BASE_ID && !APPLY_PROD) {
  console.error(`✖ Prod requiere --apply-prod explicito.`);
  process.exit(1);
}

const MAPEO: Record<string, string> = {
  Pago_Unico: "Liquidacion",
  Cuota: "Primer_Pago_Plan",
};

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(
    `Sprint 14a Bloque 6 — backfill Tipo legacy${DRY_RUN ? " (DRY RUN)" : " (APPLY)"} · base ${BASE_ID} (${target})`,
  );
  const startedAt = Date.now();

  const recs = await fetchAll(
    base(TABLES.pagosPaciente as any).select({ fields: ["Tipo"] }),
  );
  console.log(`  Pagos totales: ${recs.length}`);

  type ToUpdate = { id: string; tipoNuevo: string; tipoAntes: string };
  const toUpdate: ToUpdate[] = [];
  const conteo: Record<string, number> = {};
  for (const r of recs) {
    const tipo = String((r.fields as any)["Tipo"] ?? "");
    conteo[tipo] = (conteo[tipo] ?? 0) + 1;
    const nuevo = MAPEO[tipo];
    if (nuevo) toUpdate.push({ id: r.id, tipoNuevo: nuevo, tipoAntes: tipo });
  }
  console.log(`  Distribucion actual:`);
  for (const [t, n] of Object.entries(conteo).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t.padEnd(20)} ${n}`);
  }
  console.log(`  A mapear: ${toUpdate.length}`);

  if (toUpdate.length === 0) {
    console.log("  Nada que mapear (ya estaba migrado o no hay legacy). Idempotente.");
    return;
  }
  if (DRY_RUN) {
    console.log("  --dry-run: nada escrito.");
    return;
  }

  // Update batches de 10 con typecast (Airtable crea Primer_Pago_Plan
  // la primera vez que llega).
  let actualizados = 0;
  for (let i = 0; i < toUpdate.length; i += 10) {
    const slice = toUpdate.slice(i, i + 10);
    await base(TABLES.pagosPaciente as any).update(
      slice.map((u) => ({ id: u.id, fields: { Tipo: u.tipoNuevo } })),
      { typecast: true },
    );
    actualizados += slice.length;
    process.stdout.write(`\r  Actualizados ${actualizados}/${toUpdate.length}`);
  }
  process.stdout.write("\n");

  const elapsedS = Math.round((Date.now() - startedAt) / 1000);
  console.log(`✔ Backfill completo: ${actualizados} pagos en ${elapsedS}s.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
