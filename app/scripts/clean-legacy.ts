// app/scripts/clean-legacy.ts
//
// ⚠️  SOLO PARA BASE DEVELOPMENT. Borra todos los datos que NO pertenecen a
// las 10 clínicas R2b (RB Dental / Karen Dental) para dejar Dev con un
// dataset limpio y distribuido. Un re-seed posterior (seed-sprint7.ts)
// rellena las 10 clínicas con distribución realista.
//
// Estrategia: las tablas de datos (Mensajes_WhatsApp, Presupuestos,
// Pacientes, Citas, Lista_de_espera) quedan completamente vacías — más
// simple y garantiza estado consistente que filtrar por relaciones.
// La tabla Staff pierde todos los Rol=Dentista. Se conservan intactas:
//   - Las 10 clínicas R2b (activas).
//   - Las clínicas legacy NO-R2b (se desactivan).
//   - Usuarios (admin + coordinaciones) y Usuario_Clinicas.
//
// Uso:
//   npx tsx app/scripts/clean-legacy.ts            (dry-run)
//   npx tsx app/scripts/clean-legacy.ts --apply    (borra de verdad)

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";

const APPLY = process.argv.includes("--apply");

const CLINICAS_R2B = new Set([
  "RB Dental – Barajas",
  "RB Dental – Meco",
  "RB Dental – Colmenar Viejo",
  "RB Dental – Toledo",
  "RB Dental – Melilla Centro",
  "RB Dental – Melilla Montemar",
  "RB Dental – Melilla El Real",
  "Karen Dental – Pinto",
  "Karen Dental – Valdemoro 22",
  "Karen Dental – Valdemoro 28",
]);

async function deleteAll(tableName: any, label: string): Promise<void> {
  const recs = await fetchAll(base(tableName).select({}));
  const ids = recs.map((r) => r.id);
  if (!ids.length) {
    console.log(`  (vacío) ${label}`);
    return;
  }
  if (!APPLY) {
    console.log(`  [dry-run] ${label}: ${ids.length} registros`);
    return;
  }
  let done = 0;
  for (let i = 0; i < ids.length; i += 10) {
    await base(tableName).destroy(ids.slice(i, i + 10));
    done += Math.min(10, ids.length - i);
    process.stdout.write(`\r  ${label}: ${done}/${ids.length}`);
  }
  process.stdout.write("\n");
}

async function deleteByIds(tableName: any, ids: string[], label: string): Promise<void> {
  if (!ids.length) {
    console.log(`  (vacío) ${label}`);
    return;
  }
  if (!APPLY) {
    console.log(`  [dry-run] ${label}: ${ids.length} registros`);
    return;
  }
  let done = 0;
  for (let i = 0; i < ids.length; i += 10) {
    await base(tableName).destroy(ids.slice(i, i + 10));
    done += Math.min(10, ids.length - i);
    process.stdout.write(`\r  ${label}: ${done}/${ids.length}`);
  }
  process.stdout.write("\n");
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (borrado real)" : "DRY-RUN"}`);
  if (!APPLY) console.log("Añade --apply para borrar de verdad.\n");

  // 1. Wipe tablas de datos puros
  await deleteAll(TABLES.mensajesWhatsApp, "Mensajes_WhatsApp");
  await deleteAll(TABLES.presupuestos, "Presupuestos");
  await deleteAll(TABLES.appointments, "Citas");
  await deleteAll(TABLES.waitlist, "Lista_de_espera");
  await deleteAll(TABLES.patients, "Pacientes");

  // 2. Staff: borrar dentistas. Mantener recepcionistas/higienistas existentes.
  const staffAll = await fetchAll(
    base(TABLES.staff).select({ filterByFormula: `{Rol}='Dentista'` })
  );
  await deleteByIds(TABLES.staff, staffAll.map((r) => r.id), "Staff Dentistas");

  // 3. Clínicas NO-R2b → desactivar (NO borrar; DEMO_CLINIC_RECORD_ID
  //    puede apuntar a alguna y los env vars de integraciones quedarían rotos).
  const clinicas = await fetchAll(base(TABLES.clinics).select({}));
  const toDeactivate = clinicas.filter((r) => {
    const nombre = String(r.fields?.["Nombre"] ?? "");
    return !CLINICAS_R2B.has(nombre) && r.fields?.["Activa"];
  });
  if (toDeactivate.length) {
    if (!APPLY) {
      console.log(`  [dry-run] Clínicas legacy a desactivar: ${toDeactivate.length}`);
      for (const r of toDeactivate) console.log(`    - ${r.fields?.["Nombre"]}`);
    } else {
      for (let i = 0; i < toDeactivate.length; i += 10) {
        const slice = toDeactivate
          .slice(i, i + 10)
          .map((r) => ({ id: r.id, fields: { Activa: false } }));
        await base(TABLES.clinics).update(slice);
      }
      console.log(`  ↓ ${toDeactivate.length} clínica(s) legacy desactivadas`);
    }
  } else {
    console.log("  (sin clínicas legacy activas que desactivar)");
  }

  // 4. Asegurar que las 10 R2b quedan activas.
  const r2bActive = clinicas.filter(
    (r) => CLINICAS_R2B.has(String(r.fields?.["Nombre"] ?? "")) && !r.fields?.["Activa"]
  );
  if (r2bActive.length && APPLY) {
    for (let i = 0; i < r2bActive.length; i += 10) {
      const slice = r2bActive
        .slice(i, i + 10)
        .map((r) => ({ id: r.id, fields: { Activa: true } }));
      await base(TABLES.clinics).update(slice);
    }
    console.log(`  ↑ ${r2bActive.length} clínica(s) R2b reactivadas`);
  }

  console.log(
    `\n${APPLY ? "✅ Limpieza completa." : "ℹ️  Dry-run terminado."} Ejecuta seed-sprint7.ts a continuación para repoblar.`
  );
}

main().catch((err) => {
  console.error("❌ Clean-legacy falló:", err);
  process.exit(1);
});
