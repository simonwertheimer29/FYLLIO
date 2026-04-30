// app/scripts/sprint14-backfill-pagos-paciente-recordid.ts
//
// Sprint 14a Bloque 0.2 — rellena Pagos_Paciente.Paciente_RecordId en
// los registros existentes (incluye los 132 pagos migrados desde
// Sprint 13.1 + cualquiera creado entre la creacion del campo y el
// deploy del codigo nuevo).
//
// Idempotente: skip si Paciente_RecordId ya tiene valor.
//
// Modos:
//   npx tsx app/scripts/sprint14-backfill-pagos-paciente-recordid.ts --dry-run
//   npx tsx app/scripts/sprint14-backfill-pagos-paciente-recordid.ts
//
// Guard: bloquea Prod sin --apply-prod explicito.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY_PROD = process.argv.includes("--apply-prod");
const PROD_BASE_ID = "appfUJcyGnkZ16Fhr";
const BASE_ID = process.env.AIRTABLE_BASE_ID ?? "?";

if (BASE_ID === PROD_BASE_ID && !APPLY_PROD) {
  console.error(
    `✖ AIRTABLE_BASE_ID apunta a Prod (${PROD_BASE_ID}). Requiere --apply-prod explicito.`,
  );
  process.exit(1);
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(
    `Sprint 14a Bloque 0.2 — backfill Paciente_RecordId${DRY_RUN ? " (DRY RUN)" : " (APPLY)"} · base ${BASE_ID} (${target})`,
  );
  const startedAt = Date.now();

  const recs = await fetchAll(
    base(TABLES.pagosPaciente as any).select({
      fields: ["Paciente_Link", "Paciente_RecordId"],
    }),
  );
  console.log(`  Pagos totales: ${recs.length}`);

  type ToUpdate = { id: string; pacienteId: string };
  const toUpdate: ToUpdate[] = [];
  let yaTienen = 0;
  let sinLink = 0;

  for (const r of recs) {
    const f = r.fields as any;
    const ya = String(f["Paciente_RecordId"] ?? "");
    if (ya) {
      yaTienen++;
      continue;
    }
    const links = (f["Paciente_Link"] ?? []) as string[];
    const pacienteId = links[0];
    if (!pacienteId) {
      sinLink++;
      continue;
    }
    toUpdate.push({ id: r.id, pacienteId });
  }

  console.log(`  Ya con Paciente_RecordId:   ${yaTienen}`);
  console.log(`  Sin Paciente_Link (raros):  ${sinLink}`);
  console.log(`  A rellenar:                 ${toUpdate.length}`);

  if (DRY_RUN) {
    console.log(
      `  --dry-run: would set Paciente_RecordId on ${toUpdate.length} records.`,
    );
    return;
  }

  if (toUpdate.length === 0) {
    console.log("  Nada que actualizar. Idempotente.");
    return;
  }

  // Airtable update batch limit = 10.
  let actualizados = 0;
  for (let i = 0; i < toUpdate.length; i += 10) {
    const slice = toUpdate.slice(i, i + 10);
    await base(TABLES.pagosPaciente as any).update(
      slice.map((u) => ({
        id: u.id,
        fields: { Paciente_RecordId: u.pacienteId },
      })),
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
