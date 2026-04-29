// app/scripts/sprint131-migrate-pagos.ts
//
// Sprint 13.1 Bloque 0.2 — migra Pacientes.Pagado a Pagos_Paciente.
// Sprint 13.1.1 — refuerzos: dry-run completo, logging detallado por
// record, verificación explícita de idempotencia.
//
// Idempotencia: cada registro creado lleva en Nota el marker
// "[MIGRADO Sprint 13.1]". Antes de migrar, leemos los pagos ya
// migrados y los excluimos por pacienteId. Si el script se interrumpe
// a mitad, re-correrlo NO duplica registros (los ya creados se
// detectan, los pendientes se completan).
//
// Uso:
//   npx tsx app/scripts/sprint131-migrate-pagos.ts --dry-run
//     reporta cuántos pagos crearía y los detalles de cada uno; no
//     escribe nada.
//   npx tsx app/scripts/sprint131-migrate-pagos.ts
//     ejecuta la migración real.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";

const DRY_RUN = process.argv.includes("--dry-run");
const NOTA_MIGRACION = "[MIGRADO Sprint 13.1] Pago histórico migrado desde Pacientes.Pagado";
// Marker de busqueda en Nota — el espacio entre "]" y "Pago" no es
// fiable porque Airtable normaliza espacios. Buscamos por prefijo.
const NOTA_MARKER = "[MIGRADO Sprint 13.1]";

type PacienteRow = {
  id: string;
  fields: { Nombre?: string; Pagado?: number; Fecha_Cita?: string };
  createdTime?: string;
};

type PlannedRecord = {
  pacienteId: string;
  pacienteNombre: string;
  importe: number;
  fechaPagoUsada: string;
  fechaPagoSource: "Fecha_Cita" | "createdTime" | "today";
  skipReason: string | null;
};

async function main() {
  const baseId = process.env.AIRTABLE_BASE_ID ?? "?";
  console.log(
    `Sprint 13.1 — migración Pagos_Paciente${DRY_RUN ? " (DRY RUN)" : " (APPLY)"} · base ${baseId}`,
  );
  const startedAt = Date.now();

  // 1) Leer pacientes con Pagado > 0.
  const pacientes = (await fetchAll(
    base(TABLES.patients as any).select({
      filterByFormula: "{Pagado}>0",
      fields: ["Nombre", "Pagado", "Fecha_Cita"],
    }),
  )) as PacienteRow[];
  console.log(`  Pacientes con Pagado > 0: ${pacientes.length}`);

  if (pacientes.length === 0) {
    console.log("  Nada que migrar.");
    return;
  }

  // 2) Leer pagos ya migrados — verificación explícita de idempotencia.
  // Buscamos por marker exacto en Nota y conservamos el conteo de pagos
  // migrados por paciente. Si un paciente tiene >1 marker, indica una
  // re-migración previa errónea y lo flagueamos como skip por seguridad.
  const migradosExistentes = await fetchAll(
    base(TABLES.pagosPaciente as any).select({
      filterByFormula: `FIND('${NOTA_MARKER}', {Nota}&'')>0`,
      fields: ["Paciente_Link"],
    }),
  );
  const migradosCountByPaciente = new Map<string, number>();
  for (const m of migradosExistentes) {
    const links = ((m.fields as any)["Paciente_Link"] ?? []) as string[];
    const pid = links[0];
    if (!pid) continue;
    migradosCountByPaciente.set(pid, (migradosCountByPaciente.get(pid) ?? 0) + 1);
  }
  const yaMigrados = new Set(migradosCountByPaciente.keys());
  const reMigradosErroneos = Array.from(migradosCountByPaciente.entries()).filter(
    ([, n]) => n > 1,
  );
  console.log(
    `  Pacientes ya migrados anteriormente: ${yaMigrados.size}` +
      (reMigradosErroneos.length > 0
        ? ` (${reMigradosErroneos.length} con >1 marker — posible re-migración)`
        : ""),
  );

  // 3) Plan de migración con detalle por record.
  const today = new Date().toISOString().slice(0, 10);
  const planned: PlannedRecord[] = pacientes.map((p) => {
    const f = p.fields ?? {};
    const importe = Number(f.Pagado ?? 0);
    const nombre = String(f.Nombre ?? "Paciente").trim();
    let fechaPagoUsada = today;
    let fechaPagoSource: PlannedRecord["fechaPagoSource"] = "today";
    if (f.Fecha_Cita) {
      fechaPagoUsada = String(f.Fecha_Cita).slice(0, 10);
      fechaPagoSource = "Fecha_Cita";
    } else if (p.createdTime) {
      fechaPagoUsada = p.createdTime.slice(0, 10);
      fechaPagoSource = "createdTime";
    }
    let skipReason: string | null = null;
    if (yaMigrados.has(p.id)) {
      skipReason = "ya_migrado";
    } else if (importe <= 0) {
      // No deberia pasar (filterByFormula ya excluye), defensa extra.
      skipReason = "importe_no_positivo";
    } else if (!Number.isFinite(importe)) {
      skipReason = "importe_invalido";
    }
    return {
      pacienteId: p.id,
      pacienteNombre: nombre,
      importe,
      fechaPagoUsada,
      fechaPagoSource,
      skipReason,
    };
  });

  const aMigrar = planned.filter((p) => p.skipReason == null);
  const skipped = planned.filter((p) => p.skipReason != null);
  console.log(`  Pacientes a migrar en esta corrida: ${aMigrar.length}`);
  console.log(`  Pacientes saltados: ${skipped.length}`);

  // 4) Logging detallado: imprimimos TODOS los records (no truncado).
  console.log("");
  console.log(
    "  pacienteId               | importe   | fecha       | source       | acción",
  );
  console.log(
    "  -------------------------+-----------+-------------+--------------+----------",
  );
  for (const p of planned) {
    const id = p.pacienteId.padEnd(24);
    const imp = `€${p.importe.toFixed(2)}`.padStart(9);
    const fecha = p.fechaPagoUsada.padEnd(11);
    const source = p.fechaPagoSource.padEnd(12);
    const accion = p.skipReason ? `SKIP·${p.skipReason}` : DRY_RUN ? "DRY·crear" : "crear";
    console.log(`  ${id} | ${imp} | ${fecha} | ${source} | ${accion}`);
  }
  console.log("");

  if (DRY_RUN) {
    console.log(
      `  --dry-run: would create ${aMigrar.length} Pagos_Paciente records ` +
        `from ${pacientes.length} patients with Pagado>0 ` +
        `(${skipped.length} skipped).`,
    );
    return;
  }

  if (aMigrar.length === 0) {
    console.log(`  Nada que crear (${skipped.length} ya existentes/saltados).`);
    return;
  }

  // 5) Crear en batches de 10 (limite Airtable).
  let creados = 0;
  for (let i = 0; i < aMigrar.length; i += 10) {
    const slice = aMigrar.slice(i, i + 10);
    const records = slice.map((p) => ({
      fields: {
        Resumen: `Migrado · ${p.fechaPagoUsada} · ${p.importe.toFixed(2)}€ · ${p.pacienteNombre}`,
        Paciente_Link: [p.pacienteId],
        Fecha_Pago: p.fechaPagoUsada,
        Importe: p.importe,
        Metodo: "Otro",
        Tipo: "Liquidacion",
        Nota: NOTA_MIGRACION,
      },
    }));
    await base(TABLES.pagosPaciente as any).create(records);
    creados += records.length;
    process.stdout.write(`\r  Creados ${creados}/${aMigrar.length}`);
  }
  process.stdout.write("\n");

  // 6) Stats finales.
  const elapsedS = Math.round((Date.now() - startedAt) / 1000);
  console.log(`✔ Migración completa: ${creados} pagos creados en ${elapsedS}s.`);
  console.log(`  Skipped: ${skipped.length}.`);
  if (reMigradosErroneos.length > 0) {
    console.log(
      `⚠ ATENCIÓN: ${reMigradosErroneos.length} pacientes con >1 marker existían antes ` +
        `de esta corrida. Revisa Pagos_Paciente filtrando por Nota contiene "${NOTA_MARKER}" ` +
        `agrupado por Paciente_Link.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
