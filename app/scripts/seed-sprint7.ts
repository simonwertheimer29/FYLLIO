// app/scripts/seed-sprint7.ts
//
// Sprint 7 — Seed del sistema global de roles.
// Crea: 2 clínicas demo activas + 1 admin + 1 coordinación por clínica.
// Idempotente: se puede correr varias veces sin duplicar.
//
// Uso: npx tsx app/scripts/seed-sprint7.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";
import { hashPassword, hashPin } from "../lib/auth/hashing";

const DEMO_ADMIN_EMAIL = "admin@fyllio.demo";
const DEMO_ADMIN_PASSWORD = "admin-demo-2026";

const CLINICAS_DEMO = [
  { nombre: "Clínica Madrid Centro", ciudad: "Madrid", telefono: "+34 910 000 001", pin: "1234" },
  { nombre: "Clínica Barajas", ciudad: "Madrid", telefono: "+34 910 000 002", pin: "5678" },
];

function escapeFormula(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function findClinicaByNombre(nombre: string) {
  const recs = await base(TABLES.clinics)
    .select({
      filterByFormula: `{Nombre}='${escapeFormula(nombre)}'`,
      maxRecords: 1,
    })
    .firstPage();
  return recs[0] ?? null;
}

async function upsertClinica(cfg: { nombre: string; ciudad: string; telefono: string }) {
  const existing = await findClinicaByNombre(cfg.nombre);
  const fieldsToSet: Record<string, any> = {
    Activa: true,
  };
  // Solo rellenamos Ciudad/Telefono si están vacíos (no pisamos edits manuales)
  if (!existing || !existing.fields?.["Ciudad"]) fieldsToSet["Ciudad"] = cfg.ciudad;
  if (!existing || !existing.fields?.["Telefono"]) fieldsToSet["Telefono"] = cfg.telefono;

  if (existing) {
    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(fieldsToSet)) {
      if (existing.fields?.[k] !== v) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) {
      console.log(`  ✔ clínica "${cfg.nombre}" ya OK (skip)`);
      return existing;
    }
    const updated = (await base(TABLES.clinics).update([{ id: existing.id, fields: patch }]))[0];
    console.log(`  ✔ clínica "${cfg.nombre}" actualizada`);
    return updated;
  }

  const created = (
    await base(TABLES.clinics).create([{ fields: { Nombre: cfg.nombre, ...fieldsToSet } }])
  )[0];
  console.log(`  ✔ clínica "${cfg.nombre}" creada`);
  return created;
}

async function findUsuarioByEmail(email: string) {
  const recs = await base(TABLES.usuarios)
    .select({
      filterByFormula: `{Email}='${escapeFormula(email)}'`,
      maxRecords: 1,
    })
    .firstPage();
  return recs[0] ?? null;
}

async function findUsuarioByNombreYRol(nombre: string, rol: "admin" | "coordinacion") {
  const recs = await base(TABLES.usuarios)
    .select({
      filterByFormula: `AND({Nombre}='${escapeFormula(nombre)}', {Rol}='${rol}')`,
      maxRecords: 1,
    })
    .firstPage();
  return recs[0] ?? null;
}

// Filtrar junctions por record ID en memoria — FIND/ARRAYJOIN sobre link fields
// de Airtable compara contra primary field, no contra IDs.
async function ensureLink(userId: string, clinicaId: string) {
  const recs = await fetchAll(base(TABLES.usuarioClinicas).select({}));
  const exists = recs.some((rec) => {
    const users = (rec.fields?.["Usuario"] ?? []) as string[];
    const clinicas = (rec.fields?.["Clinica"] ?? []) as string[];
    return users.includes(userId) && clinicas.includes(clinicaId);
  });
  if (exists) return;
  await base(TABLES.usuarioClinicas).create([
    { fields: { Usuario: [userId], Clinica: [clinicaId] } },
  ]);
}

async function main() {
  console.log("Sprint 7 seed — inicio");
  console.log("ENV BASE?", !!process.env.AIRTABLE_BASE_ID, "KEY?", !!process.env.AIRTABLE_API_KEY);
  if (!process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_API_KEY) {
    throw new Error("Faltan AIRTABLE_BASE_ID / AIRTABLE_API_KEY en .env.local");
  }

  // 1) Clínicas demo
  console.log("\n[1/3] Clínicas");
  const clinicas = [];
  for (const c of CLINICAS_DEMO) {
    const rec = await upsertClinica(c);
    clinicas.push({ ...c, id: rec.id });
  }

  // 2) Admin demo (password plana elegida + hash bcrypt)
  console.log("\n[2/3] Admin");
  const existingAdmin = await findUsuarioByEmail(DEMO_ADMIN_EMAIL);
  let adminId: string;
  if (existingAdmin) {
    console.log(`  ✔ admin ya existe (${DEMO_ADMIN_EMAIL}) — no se re-hashea password`);
    adminId = existingAdmin.id;
  } else {
    const passwordHash = await hashPassword(DEMO_ADMIN_PASSWORD);
    const created = (
      await base(TABLES.usuarios).create([
        {
          fields: {
            Nombre: "Admin Demo",
            Email: DEMO_ADMIN_EMAIL,
            Password_hash: passwordHash,
            Rol: "admin",
            Activo: true,
          },
        },
      ])
    )[0];
    adminId = created.id;
    console.log(`  ✔ admin creado: ${DEMO_ADMIN_EMAIL} / password=${DEMO_ADMIN_PASSWORD}`);
  }

  // 3) Coordinaciones (1 por clínica, PIN hasheado)
  console.log("\n[3/3] Coordinaciones");
  for (const c of clinicas) {
    const nombre = `Coordinación ${c.nombre}`;
    const existing = await findUsuarioByNombreYRol(nombre, "coordinacion");
    let userId: string;
    if (existing) {
      console.log(`  ✔ "${nombre}" ya existe — no se re-hashea PIN`);
      userId = existing.id;
    } else {
      const pinHash = await hashPin(c.pin);
      const created = (
        await base(TABLES.usuarios).create([
          {
            fields: {
              Nombre: nombre,
              Pin_hash: pinHash,
              Rol: "coordinacion",
              Activo: true,
            },
          },
        ])
      )[0];
      userId = created.id;
      console.log(`  ✔ "${nombre}" creado / PIN=${c.pin}`);
    }
    await ensureLink(userId, c.id);
    console.log(`    └ vinculado a "${c.nombre}"`);
  }

  console.log("\n✅ Sprint 7 seed OK");
  console.log("\nCredenciales demo:");
  console.log(`  Admin:  ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
  for (const c of CLINICAS_DEMO) {
    console.log(`  ${c.nombre} → PIN ${c.pin}`);
  }
}

main().catch((err) => {
  console.error("❌ Seed falló:", err);
  process.exit(1);
});
