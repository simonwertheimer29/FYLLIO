// app/scripts/sprint-B-seed-identidad.ts
//
// Sprint B — seed SOLO de la base "Fyllio · Identidad" (usuarios/clínicas/junction).
// NO toca datos de negocio (pacientes, presupuestos, leads…): eso vive en las bases
// por cliente. Idempotente: correrlo dos veces no duplica (upsert por clave).
//
// PILOTO FICTICIO: clínicas reales de RB (Cliente=RB) + 1 independiente placeholder
// (Cliente=INDEP) + usuarios de prueba con PIN temporal 0000/000000 (bcrypt). Al
// onboardear real, se regeneran los PIN desde Ajustes.
//
// Ejecutar (necesita AIRTABLE_BASE_CENTRAL + AIRTABLE_API_KEY en el entorno):
//   npx tsx app/scripts/sprint-B-seed-identidad.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback .env

import { baseCentral, TABLES, fetchAll } from "../lib/airtable";
import { hashPin } from "../lib/auth/hashing";

type Cliente = "RB" | "INDEP";

// ── 11 clínicas ─────────────────────────────────────────────────────────────
const CLINICAS: Array<{ nombre: string; ciudad: string; cliente: Cliente }> = [
  { nombre: "RB Dental – Barajas", ciudad: "Madrid", cliente: "RB" },
  { nombre: "RB Dental – Meco", ciudad: "Madrid", cliente: "RB" },
  { nombre: "RB Dental – Colmenar Viejo", ciudad: "Madrid", cliente: "RB" },
  { nombre: "RB Dental – Toledo", ciudad: "Toledo", cliente: "RB" },
  { nombre: "RB Dental – Melilla Centro", ciudad: "Melilla", cliente: "RB" },
  { nombre: "RB Dental – Melilla Montemar", ciudad: "Melilla", cliente: "RB" },
  { nombre: "RB Dental – Melilla El Real", ciudad: "Melilla", cliente: "RB" },
  { nombre: "Karen Dental – Pinto", ciudad: "Madrid", cliente: "RB" },
  { nombre: "Karen Dental – Valdemoro 22", ciudad: "Madrid", cliente: "RB" },
  { nombre: "Karen Dental – Valdemoro 28", ciudad: "Madrid", cliente: "RB" },
  { nombre: "Clínica Independiente – Piloto", ciudad: "—", cliente: "INDEP" },
];

// ── Usuarios del piloto (ficticios) ─────────────────────────────────────────
// Admin → rol admin (ve TODAS las clínicas de su cliente, sin junction).
// Coordinación → junction con las clínicas que ve.
const USUARIOS: Array<{
  nombre: string;
  email: string;
  rol: "admin" | "coordinacion";
  cliente: Cliente;
  pin: string;
  pinLength: 4 | 6;
  clinicas: string[]; // nombres de clínica (vacío para admin)
}> = [
  {
    nombre: "Admin RB (piloto)",
    email: "admin.rb.piloto@fyllio.test",
    rol: "admin",
    cliente: "RB",
    // PIN distinto por admin: el login de admin no tiene contexto de clínica y
    // matchea al primer admin cuyo PIN coincide, así que dos admin con el mismo
    // PIN serían indistinguibles. Necesario para el QA (Escenario 4).
    pin: "111111",
    pinLength: 6,
    clinicas: [], // admin ve las 10 de RB vía rol
  },
  {
    nombre: "Coord Melilla (piloto)",
    email: "coord.melilla.piloto@fyllio.test",
    rol: "coordinacion",
    cliente: "RB",
    pin: "0000",
    pinLength: 4,
    clinicas: ["RB Dental – Melilla Centro", "RB Dental – Melilla Montemar", "RB Dental – Melilla El Real"],
  },
  {
    nombre: "Coord Madrid (piloto)",
    email: "coord.madrid.piloto@fyllio.test",
    rol: "coordinacion",
    cliente: "RB",
    pin: "0000",
    pinLength: 4,
    clinicas: ["RB Dental – Barajas", "RB Dental – Meco", "RB Dental – Colmenar Viejo"],
  },
  {
    nombre: "Admin INDEP (piloto)",
    email: "admin.indep.piloto@fyllio.test",
    rol: "admin",
    cliente: "INDEP",
    pin: "222222", // distinto de Admin RB (ver nota arriba)
    pinLength: 6,
    clinicas: [], // admin ve su clínica vía rol
  },
  {
    nombre: "Coord INDEP (piloto)",
    email: "coord.indep.piloto@fyllio.test",
    rol: "coordinacion",
    cliente: "INDEP",
    pin: "0000",
    pinLength: 4,
    clinicas: ["Clínica Independiente – Piloto"],
  },
];

// ── Upserts idempotentes ────────────────────────────────────────────────────

async function upsertClinicas(): Promise<Map<string, string>> {
  const existing = await fetchAll(baseCentral(TABLES.clinics).select({}));
  const byNombre = new Map<string, { id: string }>(
    existing.map((r) => [String(r.fields?.["Nombre"] ?? ""), r]),
  );
  const idByNombre = new Map<string, string>();
  for (const c of CLINICAS) {
    const fields = { Nombre: c.nombre, Ciudad: c.ciudad, Activa: true, Cliente: c.cliente };
    const rec = byNombre.get(c.nombre);
    if (rec) {
      await (baseCentral(TABLES.clinics) as any).update([{ id: rec.id, fields }]);
      idByNombre.set(c.nombre, rec.id);
    } else {
      const created = await (baseCentral(TABLES.clinics) as any).create([{ fields }]);
      idByNombre.set(c.nombre, created[0].id);
    }
  }
  return idByNombre;
}

async function upsertUsuarios(): Promise<Map<string, string>> {
  const existing = await fetchAll(baseCentral(TABLES.usuarios).select({}));
  const byNombre = new Map<string, { id: string }>(
    existing.map((r) => [String(r.fields?.["Nombre"] ?? ""), r]),
  );
  const idByNombre = new Map<string, string>();
  for (const u of USUARIOS) {
    const pinHash = await hashPin(u.pin);
    const fields: Record<string, unknown> = {
      Nombre: u.nombre,
      Rol: u.rol,
      Activo: true,
      Cliente: u.cliente,
      Pin_hash: pinHash,
      Pin_length: u.pinLength,
    };
    if (u.email) fields.Email = u.email;
    const rec = byNombre.get(u.nombre);
    if (rec) {
      await (baseCentral(TABLES.usuarios) as any).update([{ id: rec.id, fields }]);
      idByNombre.set(u.nombre, rec.id);
    } else {
      const created = await (baseCentral(TABLES.usuarios) as any).create([{ fields }]);
      idByNombre.set(u.nombre, created[0].id);
    }
  }
  return idByNombre;
}

async function upsertJunction(
  clinicaIds: Map<string, string>,
  usuarioIds: Map<string, string>,
): Promise<number> {
  const existing = await fetchAll(baseCentral(TABLES.usuarioClinicas).select({}));
  const existingPairs = new Set<string>();
  for (const r of existing) {
    const us = (r.fields?.["Usuario"] ?? []) as string[];
    const cs = (r.fields?.["Clinica"] ?? []) as string[];
    for (const uid of us) for (const cid of cs) existingPairs.add(`${uid}::${cid}`);
  }
  const toCreate: Array<{ fields: { Usuario: string[]; Clinica: string[] } }> = [];
  for (const u of USUARIOS) {
    const uid = usuarioIds.get(u.nombre);
    if (!uid) continue;
    for (const cn of u.clinicas) {
      const cid = clinicaIds.get(cn);
      if (!cid) throw new Error(`Clínica no encontrada para junction: ${cn}`);
      if (!existingPairs.has(`${uid}::${cid}`)) {
        toCreate.push({ fields: { Usuario: [uid], Clinica: [cid] } });
      }
    }
  }
  for (let i = 0; i < toCreate.length; i += 10) {
    await (baseCentral(TABLES.usuarioClinicas) as any).create(toCreate.slice(i, i + 10));
  }
  return toCreate.length;
}

async function main() {
  if (!process.env.AIRTABLE_BASE_CENTRAL) {
    throw new Error("Falta AIRTABLE_BASE_CENTRAL en el entorno (base Identidad).");
  }
  console.log("Seed Identidad → base central configurada ✓");
  const clinicaIds = await upsertClinicas();
  console.log(`✓ Clínicas: ${clinicaIds.size} (upsert por Nombre)`);
  const usuarioIds = await upsertUsuarios();
  console.log(`✓ Usuarios: ${usuarioIds.size} (upsert por Nombre)`);
  const nuevos = await upsertJunction(clinicaIds, usuarioIds);
  console.log(`✓ Usuario_Clinicas: ${nuevos} vínculos nuevos (idempotente)`);
  console.log("Seed Identidad completado.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
