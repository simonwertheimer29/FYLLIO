// app/scripts/clean-all.ts
//
// ⚠️  BORRA TODOS LOS REGISTROS "SEED" creados por seed-sprint7.ts.
// Se apoya en los mismos marcadores de idempotencia para no tocar datos reales:
//   - Mensajes_WhatsApp       → WABA_message_id empieza por "SEED_M_"
//   - Presupuestos            → Presupuesto ID empieza por "SEED_P_"
//   - Pacientes               → Notas empieza por "[SEED]"
//   - Staff (Dentistas)       → Rol = "Dentista" (borra TODOS los dentistas)
//   - Usuario_Clinicas        → vinculados a usuarios del seed
//   - Usuarios (admin + coords)
//   - Clínicas                → las 10 clínicas conocidas del seed
//
// Uso:
//   npx tsx app/scripts/clean-all.ts            (dry-run, solo cuenta)
//   npx tsx app/scripts/clean-all.ts --apply    (borra de verdad)

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";

const APPLY = process.argv.includes("--apply");

const DEMO_ADMIN_NOMBRE = "Simon Wertheimer";
const CLINICAS_DEMO = [
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
];

async function deleteMany(tableName: any, ids: string[], label: string): Promise<void> {
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
  console.log(`Mode: ${APPLY ? "APPLY (borrado real)" : "DRY-RUN (solo cuenta)"}`);
  if (!APPLY) {
    console.log("Añade --apply para borrar de verdad.\n");
  }

  // 1. Mensajes
  const mensajes = await fetchAll(
    base(TABLES.mensajesWhatsApp).select({
      filterByFormula: `FIND('SEED_M_', {WABA_message_id}&'')`,
    })
  );
  await deleteMany(TABLES.mensajesWhatsApp, mensajes.map((r) => r.id), "Mensajes SEED");

  // 2. Presupuestos
  const presups = await fetchAll(
    base(TABLES.presupuestos).select({
      filterByFormula: `FIND('SEED_P_', {Presupuesto ID}&'')`,
    })
  );
  await deleteMany(TABLES.presupuestos, presups.map((r) => r.id), "Presupuestos SEED");

  // 3. Pacientes
  const pacientes = await fetchAll(
    base(TABLES.patients).select({ filterByFormula: `FIND('[SEED]', {Notas}&'')` })
  );
  await deleteMany(TABLES.patients, pacientes.map((r) => r.id), "Pacientes [SEED]");

  // 4. Staff (todos los dentistas) — NOTA: borra TODOS los dentistas activos o no.
  const staff = await fetchAll(
    base(TABLES.staff).select({ filterByFormula: `{Rol}='Dentista'` })
  );
  await deleteMany(TABLES.staff, staff.map((r) => r.id), "Staff Dentistas");

  // 5. Usuario_Clinicas (vínculos de los usuarios del seed).
  // Consideramos "del seed": cualquier admin (el admin se crea siempre por el
  // seed) + cualquier usuario cuyo Nombre empiece por "Coordinación".
  const allUsuarios = await fetchAll(base(TABLES.usuarios).select({}));
  const seedUserIds = new Set<string>(
    allUsuarios
      .filter((r) => {
        const nombre = String(r.fields?.["Nombre"] ?? "");
        const rol = String(r.fields?.["Rol"] ?? "");
        return rol === "admin" || nombre.startsWith("Coordinación ");
      })
      .map((r) => r.id)
  );
  const junctions = await fetchAll(base(TABLES.usuarioClinicas).select({}));
  const junctionIds = junctions
    .filter((r) => {
      const users = (r.fields?.["Usuario"] ?? []) as string[];
      return users.some((u) => seedUserIds.has(u));
    })
    .map((r) => r.id);
  await deleteMany(TABLES.usuarioClinicas, junctionIds, "Vínculos Usuario_Clinicas");

  // 6. Usuarios (admin + coordinaciones)
  const userIds = Array.from(seedUserIds);
  await deleteMany(TABLES.usuarios, userIds, "Usuarios (admin + coords)");

  // 7. Clínicas demo
  const clinicas = await fetchAll(base(TABLES.clinics).select({}));
  const clinicaIds = clinicas
    .filter((r) => CLINICAS_DEMO.includes(String(r.fields?.["Nombre"] ?? "")))
    .map((r) => r.id);
  await deleteMany(TABLES.clinics, clinicaIds, "Clínicas demo");

  console.log(`\n${APPLY ? "✅ Limpieza completada" : "ℹ️  Dry-run terminado. Ejecuta con --apply para borrar."}`);
}

main().catch((err) => {
  console.error("❌ Clean falló:", err);
  process.exit(1);
});
