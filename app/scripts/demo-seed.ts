// app/scripts/demo-seed.ts
//
// Tenant DEMO — siembra un inquilino de demostración AISLADO como uno más:
//   · Identidad (base CENTRAL): 4 clínicas Cliente=DEMO + 3 usuarios Cliente=DEMO
//     (1 admin, 1 coord con 4 clínicas, 1 coord con 1 clínica) + junction.
//   · Negocio (base DEMO = AIRTABLE_BASE_ID): datos ficticios coherentes para que
//     ninguna pantalla salga vacía (pacientes, presupuestos, leads, acciones, pagos).
//
// Aislamiento: los usuarios entran por el MISMO login seguro (email+PIN+rate-limit).
// `runWithCliente("DEMO")` los ata a la base DEMO; el fail-closed del Sprint B impide
// que alcancen RB o INDEP (mismo candado que separa RB de INDEP).
//
// SEGURIDAD:
//   · PINs bcrypt-hasheados. NUNCA literales en el repo: se leen de env vars
//     DEMO_ADMIN_PIN (6 dígitos) y DEMO_COORD_PIN (4 dígitos).
//   · Todo lo de negocio va etiquetado "[SEED_DEMO]" para poder limpiarlo.
//
// Uso:
//   npx tsx app/scripts/demo-seed.ts --dry            # simula, no escribe
//   DEMO_ADMIN_PIN=246810 DEMO_COORD_PIN=1234 \
//     npx tsx app/scripts/demo-seed.ts --wipe          # limpia negocio viejo y siembra
//   npx tsx app/scripts/demo-seed.ts --clean           # borra solo lo [SEED_DEMO]
//
// Requiere env: AIRTABLE_API_KEY, AIRTABLE_BASE_CENTRAL, AIRTABLE_BASE_ID.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { runWithCliente, base, baseCentral, TABLES, fetchAll } from "../lib/airtable";
import { hashPin } from "../lib/auth/hashing";

const DRY = process.argv.includes("--dry");
const WIPE = process.argv.includes("--wipe");
const CLEAN = process.argv.includes("--clean");
const TAG = "[SEED_DEMO]";
const HOY = new Date().toISOString().slice(0, 10);

// ── Clínicas DEMO (nombres propios que no chocan con los datos viejos) ───────
const C_CENTRO = "Clínica Demo Centro";
const C_NORTE = "Clínica Demo Norte";
const C_SUR = "Clínica Demo Sur";
const C_ESTE = "Clínica Demo Este";
const CLINICAS_DEMO: Array<{ nombre: string; ciudad: string }> = [
  { nombre: C_CENTRO, ciudad: "Madrid" },
  { nombre: C_NORTE, ciudad: "Madrid" },
  { nombre: C_SUR, ciudad: "Toledo" },
  { nombre: C_ESTE, ciudad: "Guadalajara" },
];

// ── Usuarios DEMO ────────────────────────────────────────────────────────────
const USUARIOS_DEMO: Array<{
  nombre: string;
  email: string;
  rol: "admin" | "coordinacion";
  pinKind: "admin" | "coord";
  pinLength: 4 | 6;
  clinicas: string[];
}> = [
  { nombre: "Demo · Administración", email: "demo@fyllio.com", rol: "admin", pinKind: "admin", pinLength: 6, clinicas: [] },
  { nombre: "Demo · Coordinación (4 clínicas)", email: "demo-coord4@fyllio.com", rol: "coordinacion", pinKind: "coord", pinLength: 4, clinicas: [C_CENTRO, C_NORTE, C_SUR, C_ESTE] },
  { nombre: "Demo · Coordinación (1 clínica)", email: "demo-coord1@fyllio.com", rol: "coordinacion", pinKind: "coord", pinLength: 4, clinicas: [C_CENTRO] },
];

// ── Datos de negocio ficticios ───────────────────────────────────────────────
const PACIENTES: Array<{ nombre: string; clinica: string }> = [
  { nombre: "DEMO · Ana Ruiz", clinica: C_CENTRO },
  { nombre: "DEMO · Bruno Gil", clinica: C_CENTRO },
  { nombre: "DEMO · Carmen Vega", clinica: C_NORTE },
  { nombre: "DEMO · Diego Mora", clinica: C_SUR },
  { nombre: "DEMO · Elena Sanz", clinica: C_ESTE },
  { nombre: "DEMO · Félix Otero", clinica: C_NORTE },
];

const PRESUPUESTOS: Array<{
  seedId: string;
  paciente: string;
  clinica: string;
  tratamiento: string;
  estado: string;
  importe: number;
}> = [
  { seedId: "SEED_DEMO_P1", paciente: "DEMO · Ana Ruiz", clinica: C_CENTRO, tratamiento: "Implante dental", estado: "PRESENTADO", importe: 2800 },
  { seedId: "SEED_DEMO_P2", paciente: "DEMO · Bruno Gil", clinica: C_CENTRO, tratamiento: "Ortodoncia invisible", estado: "EN_NEGOCIACION", importe: 3500 },
  { seedId: "SEED_DEMO_P3", paciente: "DEMO · Carmen Vega", clinica: C_NORTE, tratamiento: "Corona cerámica", estado: "ACEPTADO", importe: 950 },
  { seedId: "SEED_DEMO_P4", paciente: "DEMO · Diego Mora", clinica: C_SUR, tratamiento: "Empaste compuesto", estado: "INTERESADO", importe: 120 },
  { seedId: "SEED_DEMO_P5", paciente: "DEMO · Elena Sanz", clinica: C_ESTE, tratamiento: "Blanqueamiento", estado: "PRESENTADO", importe: 300 },
  { seedId: "SEED_DEMO_P6", paciente: "DEMO · Félix Otero", clinica: C_NORTE, tratamiento: "Endodoncia", estado: "PERDIDO", importe: 480 },
  { seedId: "SEED_DEMO_P7", paciente: "DEMO · Ana Ruiz", clinica: C_CENTRO, tratamiento: "Limpieza + revisión", estado: "ACEPTADO", importe: 90 },
  { seedId: "SEED_DEMO_P8", paciente: "DEMO · Carmen Vega", clinica: C_NORTE, tratamiento: "Férula de descarga", estado: "PRESENTADO", importe: 220 },
];

const LEADS: Array<{
  nombre: string;
  clinica: string;
  estado: string;
  telefono: string;
  canal: string;
  tratamiento: string;
  citaHoy?: boolean;
}> = [
  { nombre: "DEMO · Gloria Pérez", clinica: C_CENTRO, estado: "Nuevo", telefono: "600 000 001", canal: "Instagram", tratamiento: "Ortodoncia" },
  { nombre: "DEMO · Hugo Ramos", clinica: C_CENTRO, estado: "Citado", telefono: "600 000 002", canal: "Web", tratamiento: "Implante", citaHoy: true },
  { nombre: "DEMO · Irene Blanco", clinica: C_NORTE, estado: "Contactado", telefono: "600 000 003", canal: "Recomendación", tratamiento: "Blanqueamiento" },
  { nombre: "DEMO · Javier Nieto", clinica: C_SUR, estado: "Nuevo", telefono: "600 000 004", canal: "Google", tratamiento: "Revisión" },
  { nombre: "DEMO · Laura Prieto", clinica: C_ESTE, estado: "Convertido", telefono: "600 000 005", canal: "Instagram", tratamiento: "Corona" },
  { nombre: "DEMO · Marco Díaz", clinica: C_NORTE, estado: "Citado", telefono: "600 000 006", canal: "Web", tratamiento: "Endodoncia", citaHoy: true },
  { nombre: "DEMO · Nadia Soler", clinica: C_CENTRO, estado: "No interesado", telefono: "600 000 007", canal: "Google", tratamiento: "Ortodoncia" },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function requirePins(): { admin: string; coord: string } {
  const admin = process.env.DEMO_ADMIN_PIN ?? "";
  const coord = process.env.DEMO_COORD_PIN ?? "";
  if (!/^\d{6}$/.test(admin)) {
    throw new Error("Falta DEMO_ADMIN_PIN (6 dígitos) en el entorno.");
  }
  if (!/^\d{4}$/.test(coord)) {
    throw new Error("Falta DEMO_COORD_PIN (4 dígitos) en el entorno.");
  }
  return { admin, coord };
}

// ── Identidad (base central) ─────────────────────────────────────────────────

async function seedIdentidad(): Promise<void> {
  console.log("\n=== IDENTIDAD (base central) ===");
  const pins = DRY ? null : requirePins();

  // Clínicas DEMO (upsert por Nombre).
  const existingCl = await fetchAll(baseCentral(TABLES.clinics).select({}));
  const clByNombre = new Map<string, string>(
    existingCl.map((r) => [String(r.fields?.["Nombre"] ?? ""), r.id]),
  );
  const clinicaId = new Map<string, string>();
  for (const c of CLINICAS_DEMO) {
    const fields = { Nombre: c.nombre, Ciudad: c.ciudad, Activa: true, Cliente: "DEMO" };
    const existing = clByNombre.get(c.nombre);
    if (DRY) {
      console.log(`  [dry] ${existing ? "actualizaría" : "crearía"} clínica ${c.nombre}`);
      clinicaId.set(c.nombre, existing ?? "dry");
      continue;
    }
    if (existing) {
      await (baseCentral(TABLES.clinics) as any).update([{ id: existing, fields }]);
      clinicaId.set(c.nombre, existing);
    } else {
      const created = await (baseCentral(TABLES.clinics) as any).create([{ fields }]);
      clinicaId.set(c.nombre, created[0].id);
    }
  }
  console.log(`  ✓ ${CLINICAS_DEMO.length} clínicas DEMO (Cliente=DEMO)`);

  // Usuarios DEMO (upsert por Email).
  const existingUs = await fetchAll(baseCentral(TABLES.usuarios).select({}));
  const usByEmail = new Map<string, string>(
    existingUs
      .filter((r) => r.fields?.["Email"])
      .map((r) => [String(r.fields["Email"]).toLowerCase(), r.id]),
  );
  const usuarioId = new Map<string, string>();
  for (const u of USUARIOS_DEMO) {
    const fields: Record<string, unknown> = {
      Nombre: u.nombre,
      Email: u.email,
      Rol: u.rol,
      Activo: true,
      Cliente: "DEMO",
      Pin_length: u.pinLength,
    };
    if (!DRY && pins) {
      fields["Pin_hash"] = await hashPin(u.pinKind === "admin" ? pins.admin : pins.coord);
    }
    const existing = usByEmail.get(u.email.toLowerCase());
    if (DRY) {
      console.log(`  [dry] ${existing ? "actualizaría" : "crearía"} usuario ${u.email} (${u.rol})`);
      usuarioId.set(u.email, existing ?? "dry");
      continue;
    }
    if (existing) {
      await (baseCentral(TABLES.usuarios) as any).update([{ id: existing, fields }]);
      usuarioId.set(u.email, existing);
    } else {
      const created = await (baseCentral(TABLES.usuarios) as any).create([{ fields }]);
      usuarioId.set(u.email, created[0].id);
    }
  }
  console.log(`  ✓ ${USUARIOS_DEMO.length} usuarios DEMO (PIN bcrypt desde env)`);

  // Junction Usuario_Clinicas (idempotente).
  if (DRY) {
    for (const u of USUARIOS_DEMO) {
      if (u.clinicas.length) console.log(`  [dry] vincularía ${u.email} → ${u.clinicas.join(", ")}`);
    }
    return;
  }
  const existingJ = await fetchAll(baseCentral(TABLES.usuarioClinicas).select({}));
  const pairs = new Set<string>();
  for (const r of existingJ) {
    const us = (r.fields?.["Usuario"] ?? []) as string[];
    const cs = (r.fields?.["Clinica"] ?? []) as string[];
    for (const uid of us) for (const cid of cs) pairs.add(`${uid}::${cid}`);
  }
  const toCreate: Array<{ fields: { Usuario: string[]; Clinica: string[] } }> = [];
  for (const u of USUARIOS_DEMO) {
    const uid = usuarioId.get(u.email);
    if (!uid) continue;
    for (const cn of u.clinicas) {
      const cid = clinicaId.get(cn);
      if (cid && !pairs.has(`${uid}::${cid}`)) {
        toCreate.push({ fields: { Usuario: [uid], Clinica: [cid] } });
      }
    }
  }
  for (let i = 0; i < toCreate.length; i += 10) {
    await (baseCentral(TABLES.usuarioClinicas) as any).create(toCreate.slice(i, i + 10));
  }
  console.log(`  ✓ ${toCreate.length} vínculos nuevos de junction`);
}

// ── Negocio (base DEMO) ──────────────────────────────────────────────────────

async function wipeTabla(tabla: string): Promise<void> {
  const recs = await fetchAll(base(tabla as any).select({ fields: [] }));
  console.log(`  · ${tabla}: ${recs.length} registros a borrar`);
  if (DRY || recs.length === 0) return;
  const ids = recs.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 10) {
    await (base(tabla as any) as any).destroy(ids.slice(i, i + 10));
  }
}

async function cleanTaggedTabla(tabla: string, campo: string): Promise<void> {
  const recs = await fetchAll(
    base(tabla as any).select({ filterByFormula: `FIND('${TAG}', {${campo}}&'')>0`, fields: [] }),
  );
  console.log(`  · ${tabla}: ${recs.length} registros ${TAG}`);
  if (DRY || recs.length === 0) return;
  const ids = recs.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 10) {
    await (base(tabla as any) as any).destroy(ids.slice(i, i + 10));
  }
}

async function ensureClinicasNegocio(): Promise<Map<string, string>> {
  const negocioRecs = await fetchAll(base(TABLES.clinics).select({ fields: ["Nombre"] }));
  const idByNombre = new Map<string, string>(
    negocioRecs.map((r) => [String(r.fields?.["Nombre"] ?? ""), r.id]),
  );
  for (const c of CLINICAS_DEMO) {
    if (idByNombre.has(c.nombre)) continue;
    if (DRY) {
      console.log(`  [dry] crearía clínica de negocio ${c.nombre}`);
      idByNombre.set(c.nombre, "dry");
      continue;
    }
    const created = await (base(TABLES.clinics) as any).create([{ fields: { Nombre: c.nombre } }]);
    idByNombre.set(c.nombre, created[0].id);
  }
  return idByNombre;
}

async function seedNegocio(): Promise<void> {
  console.log("\n=== NEGOCIO (base DEMO) ===");
  await runWithCliente("DEMO", async () => {
    if (WIPE) {
      console.log("  Limpieza de datos de negocio viejos (--wipe):");
      for (const t of [TABLES.presupuestos, TABLES.patients, TABLES.leads, TABLES.clinics]) {
        await wipeTabla(t);
      }
      // Tablas de KPI (best-effort: pueden no existir en la base demo vieja).
      for (const t of [TABLES.accionesLead, TABLES.pagosPaciente]) {
        try { await wipeTabla(t); } catch (e) { console.log(`  · ${t}: omitida (${(e as Error).message.slice(0, 60)})`); }
      }
    }

    const clinicaNegId = await ensureClinicasNegocio();
    console.log(`  ✓ clínicas de negocio: ${clinicaNegId.size}`);

    // Pacientes (link Clínica por record id de la base de negocio).
    const pacienteId = new Map<string, string>();
    for (const p of PACIENTES) {
      const cid = clinicaNegId.get(p.clinica);
      const fields: Record<string, unknown> = { Nombre: p.nombre, Activo: true, Notas: TAG };
      if (cid && cid !== "dry") fields["Clínica"] = [cid];
      if (DRY) { console.log(`  [dry] paciente ${p.nombre}`); pacienteId.set(p.nombre, "dry"); continue; }
      const created = await (base(TABLES.patients) as any).create([{ fields }]);
      pacienteId.set(p.nombre, created[0].id);
    }
    console.log(`  ✓ ${PACIENTES.length} pacientes`);

    // Presupuestos (Clinica = NOMBRE en texto; Paciente = link).
    for (const pr of PRESUPUESTOS) {
      const fields: Record<string, unknown> = {
        "Presupuesto ID": pr.seedId,
        Tratamiento_nombre: pr.tratamiento,
        Estado: pr.estado,
        Fecha: HOY,
        Importe: pr.importe,
        Clinica: pr.clinica,
        Notas: TAG,
      };
      const pid = pacienteId.get(pr.paciente);
      if (pid && pid !== "dry") fields["Paciente"] = [pid];
      if (DRY) { console.log(`  [dry] presupuesto ${pr.seedId} (${pr.estado})`); continue; }
      await (base(TABLES.presupuestos) as any).create([{ fields }]);
    }
    console.log(`  ✓ ${PRESUPUESTOS.length} presupuestos`);

    // Leads (Clinica = link).
    const leadId: string[] = [];
    for (const l of LEADS) {
      const cid = clinicaNegId.get(l.clinica);
      const fields: Record<string, unknown> = {
        Nombre: l.nombre,
        Estado: l.estado,
        Telefono: l.telefono,
        Canal_Captacion: l.canal,
        Tratamiento_Interes: l.tratamiento,
        Notas: TAG,
      };
      if (cid && cid !== "dry") fields["Clinica"] = [cid];
      if (l.citaHoy) fields["Fecha_Cita"] = HOY;
      if (DRY) { console.log(`  [dry] lead ${l.nombre} (${l.estado})`); continue; }
      const created = await (base(TABLES.leads) as any).create([{ fields }]);
      leadId.push(created[0].id);
    }
    console.log(`  ✓ ${LEADS.length} leads`);

    // Acciones_Lead (para el KPI de tiempo de respuesta) — best-effort.
    try {
      const rows = leadId.slice(0, 3).map((lid) => ({
        fields: { Lead: [lid], Tipo_Accion: "Primer contacto", Timestamp: new Date().toISOString() },
      }));
      if (!DRY && rows.length) await (base(TABLES.accionesLead) as any).create(rows);
      console.log(`  ✓ ${DRY ? "(dry) " : ""}${rows.length} acciones de lead`);
    } catch (e) {
      console.log(`  ! acciones de lead omitidas: ${(e as Error).message.slice(0, 80)}`);
    }

    // Pagos_Paciente (para el KPI de cobros) — best-effort, sobre presupuestos ACEPTADOS.
    try {
      const aceptados = PRESUPUESTOS.filter((p) => p.estado === "ACEPTADO");
      const rows = aceptados
        .map((p) => {
          const pid = pacienteId.get(p.paciente);
          if (!pid || pid === "dry") return null;
          return {
            fields: {
              Paciente_RecordId: pid,
              Paciente: [pid],
              Importe: p.importe,
              Fecha_Pago: HOY,
              Tipo: "Cobro",
              Metodo: "Tarjeta",
            },
          };
        })
        .filter(Boolean) as Array<{ fields: Record<string, unknown> }>;
      if (!DRY && rows.length) await (base(TABLES.pagosPaciente) as any).create(rows);
      console.log(`  ✓ ${DRY ? "(dry) " : ""}${rows.length} pagos de paciente`);
    } catch (e) {
      console.log(`  ! pagos de paciente omitidos: ${(e as Error).message.slice(0, 80)}`);
    }
  });
}

async function cleanNegocio(): Promise<void> {
  console.log("\n=== CLEAN negocio DEMO (solo [SEED_DEMO]) ===");
  await runWithCliente("DEMO", async () => {
    await cleanTaggedTabla(TABLES.presupuestos, "Notas");
    await cleanTaggedTabla(TABLES.patients, "Notas");
    await cleanTaggedTabla(TABLES.leads, "Notas");
  });
}

async function main() {
  for (const v of ["AIRTABLE_API_KEY", "AIRTABLE_BASE_CENTRAL", "AIRTABLE_BASE_ID"]) {
    if (!process.env[v]) throw new Error(`Falta ${v} en el entorno.`);
  }
  console.log(
    CLEAN ? "MODO CLEAN — borra solo lo [SEED_DEMO]" : DRY ? "MODO DRY — no escribe nada" : WIPE ? "SEED + WIPE — limpia negocio viejo y siembra DEMO" : "SEED — siembra DEMO (sin limpiar lo viejo)",
  );

  if (CLEAN) {
    await cleanNegocio();
    console.log("\nLimpieza [SEED_DEMO] terminada.");
    return;
  }

  await seedIdentidad();
  await seedNegocio();
  console.log("\nListo. Tenant DEMO sembrado. Reejecutar es idempotente en identidad;");
  console.log("usa --wipe para re-seed limpio de negocio, o --clean para borrar lo [SEED_DEMO].");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n✗ Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
