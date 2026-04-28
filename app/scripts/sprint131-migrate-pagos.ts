// app/scripts/sprint131-migrate-pagos.ts
//
// Sprint 13.1 Bloque 0.2 — migra Pacientes.Pagado a Pagos_Paciente.
// Idempotente: si un paciente ya tiene un registro en Pagos_Paciente
// con la nota "[MIGRADO Sprint 13.1]", lo saltamos.
//
// Uso: npx tsx app/scripts/sprint131-migrate-pagos.ts
//      npx tsx app/scripts/sprint131-migrate-pagos.ts --apply (default; el
//        script ya escribe; el flag --dry-run lo previene).
//      npx tsx app/scripts/sprint131-migrate-pagos.ts --dry-run

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";

const DRY_RUN = process.argv.includes("--dry-run");
const NOTA_MIGRACION = "[MIGRADO Sprint 13.1] Pago histórico migrado desde Pacientes.Pagado";

async function main() {
  console.log(`Sprint 13.1 — migración Pagos_Paciente${DRY_RUN ? " (DRY RUN)" : ""}`);

  // 1) Leer pacientes con Pagado > 0.
  const pacientes = await fetchAll(
    base(TABLES.patients as any).select({
      filterByFormula: "{Pagado}>0",
      fields: ["Nombre", "Pagado", "Fecha_Cita"],
    }),
  );
  console.log(`  Pacientes con Pagado > 0: ${pacientes.length}`);

  if (pacientes.length === 0) {
    console.log("  Nada que migrar.");
    return;
  }

  // 2) Leer pagos ya migrados para evitar duplicados.
  const migradosExistentes = await fetchAll(
    base(TABLES.pagosPaciente as any).select({
      filterByFormula: `FIND('${NOTA_MIGRACION.split("]")[0]}]', {Nota}&'')>0`,
      fields: ["Paciente_Link"],
    }),
  );
  const yaMigrados = new Set<string>();
  for (const m of migradosExistentes) {
    const links = ((m.fields as any)["Paciente_Link"] ?? []) as string[];
    if (links[0]) yaMigrados.add(links[0]);
  }
  console.log(`  Pacientes ya migrados anteriormente: ${yaMigrados.size}`);

  // 3) Construir batches de creación (10 por batch — limite Airtable).
  const today = new Date().toISOString().slice(0, 10);
  const aMigrar = pacientes.filter((p) => !yaMigrados.has(p.id));
  console.log(`  Pacientes a migrar en esta corrida: ${aMigrar.length}`);

  if (DRY_RUN) {
    console.log("  --dry-run: no se crearán registros.");
    for (const p of aMigrar.slice(0, 10)) {
      const f = p.fields as any;
      const fecha = f["Fecha_Cita"] ? String(f["Fecha_Cita"]).slice(0, 10) : today;
      const nombre = String(f["Nombre"] ?? "");
      const importe = Number(f["Pagado"] ?? 0);
      console.log(`    [DRY] ${nombre.padEnd(35)} ${fecha} ${importe.toFixed(2)}€`);
    }
    if (aMigrar.length > 10) console.log(`    … (${aMigrar.length - 10} más)`);
    return;
  }

  let creados = 0;
  for (let i = 0; i < aMigrar.length; i += 10) {
    const slice = aMigrar.slice(i, i + 10);
    const records = slice.map((p) => {
      const f = p.fields as any;
      const fecha = f["Fecha_Cita"] ? String(f["Fecha_Cita"]).slice(0, 10) : today;
      const importe = Number(f["Pagado"] ?? 0);
      const nombre = String(f["Nombre"] ?? "Paciente");
      return {
        fields: {
          Resumen: `Migrado · ${fecha} · ${importe.toFixed(2)}€ · ${nombre}`,
          Paciente_Link: [p.id],
          Fecha_Pago: fecha,
          Importe: importe,
          Metodo: "Otro",
          Tipo: "Liquidacion",
          Nota: NOTA_MIGRACION,
        },
      };
    });
    await base(TABLES.pagosPaciente as any).create(records);
    creados += records.length;
    process.stdout.write(`\r  Creados ${creados}/${aMigrar.length}`);
  }
  process.stdout.write("\n");
  console.log(`✔ Migración completa: ${creados} pagos creados.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
