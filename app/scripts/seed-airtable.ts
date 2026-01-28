import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback .env

import { base, TABLES } from "../lib/airtable";

console.log("ENV BASE?", !!process.env.AIRTABLE_BASE_ID);
console.log("ENV KEY?", !!process.env.AIRTABLE_API_KEY);

/**
 * Tipos
 */
type TableName = (typeof TABLES)[keyof typeof TABLES];

/**
 * Helpers
 */
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isoLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function findByField(tableName: TableName, fieldName: string, value: string) {
  const safe = value.replace(/'/g, "\\'");
  const formula = `{${fieldName}}='${safe}'`;
  const recs = await base(tableName)
    .select({ maxRecords: 1, filterByFormula: formula })
    .firstPage();
  return recs[0] ?? null;
}

/**
 * Mezcla "solo vacíos" (default) o "forzar" (overwrite)
 */
function mergeOnlyEmpty(existingFields: any, nextFields: any, force: boolean) {
  if (force) return nextFields;
  const out: any = {};
  for (const [k, v] of Object.entries(nextFields)) {
    const current = existingFields?.[k];
    const isEmpty =
      current === undefined ||
      current === null ||
      (typeof current === "string" && current.trim() === "") ||
      (Array.isArray(current) && current.length === 0);

    if (isEmpty) out[k] = v;
  }
  return out;
}

/**
 * UPSERT genérico: si existe por (uniqueField=uniqueValue) → update, si no → create
 */
async function upsertByField(args: {
  table: TableName;
  uniqueField: string;
  uniqueValue: string;
  fields: Record<string, any>;
  force?: boolean; // si true, sobreescribe siempre
}) {
  const { table, uniqueField, uniqueValue, fields, force = false } = args;

  const existing = await findByField(table, uniqueField, uniqueValue);

  if (!existing) {
    const created = (
      await base(table).create([
        {
          fields: {
            [uniqueField]: uniqueValue,
            ...fields,
          },
        },
      ])
    )[0];
    return { record: created, action: "created" as const };
  }

  // Airtable Record: existing.fields contiene el snapshot de fields
  const patch = mergeOnlyEmpty((existing as any).fields, fields, force);

  if (Object.keys(patch).length === 0) {
    return { record: existing, action: "skipped" as const };
  }

  const updated = (
    await base(table).update([
      {
        id: existing.id,
        fields: patch,
      },
    ])
  )[0];

  return { record: updated, action: "updated" as const };
}

/**
 * Opciones EXACTAS según tus screenshots
 */
const STAFF_ROLES = ["Dentista", "Higienista", "Recepcionista"] as const;
const CITA_ESTADOS = ["Agendado", "Confirmado", "Cancelado", "No-show", "Completado"] as const;
const CITA_ORIGENES = ["IA", "Recepción", "Paciente"] as const;

const TRAT_CATEGORIAS = [
  "Revisión",
  "Limpieza",
  "Empaste",
  "Ortodoncia",
  "Endodoncia",
  "Urgencia",
  "Extracción",
  "Implante",
] as const;

/**
 * Campos (ajusta aquí si algún nombre difiere en Airtable)
 */
const FIELDS = {
  // Citas
  citaId: "Cita ID",
  citaNombre: "Nombre",
  citaClinica: "Clínica",
  citaInicio: "Hora inicio",
  citaFinal: "Hora final",
  citaEstado: "Estado",
  citaOrigen: "Origen",

  // Links en Citas
  citaPaciente: "Paciente",
  citaTratamiento: "Tratamiento",
  citaProfesional: "Profesional",
  citaSillon: "Sillón",

  // Clinicas
  clinicaId: "Clínica ID",
  clinicaNombre: "Nombre",

  // Staff
  staffId: "Staff ID",
  staffNombre: "Nombre",
  staffRol: "Rol",
  staffActivo: "Activo",

  // Pacientes
  pacienteId: "Paciente ID",
  pacienteNombre: "Nombre",
  pacienteTelefono: "Teléfono",

  // Sillones
  sillonId: "Sillón ID",
  sillonNombre: "Nombre",

  // Tratamientos
  tratId: "Tratamientos ID",
  tratCategoria: "Categoria",
  tratBuffer: "Buffer despues",
} as const;

/**
 * MAIN
 */
async function seed() {
  console.log("🌱 Seedeando Airtable (UPSERT)...");

  // Cambia esto a true si quieres que el seed SOBREESCRIBA todo (no solo vacíos)
  const FORCE_OVERWRITE = false;

  /**
   * 1) CLÍNICA (UPSERT)
   */
  const clinicIdValue = "CLINIC_001";
  const clinicUpsert = await upsertByField({
    table: TABLES.clinics as TableName,
    uniqueField: FIELDS.clinicaId,
    uniqueValue: clinicIdValue,
    fields: {
      [FIELDS.clinicaNombre]: "Clínica Demo FYLLIO",
    },
    force: FORCE_OVERWRITE,
  });

  const clinic = clinicUpsert.record;
  console.log(`✔ Clínica ${clinicUpsert.action}:`, clinic.id);

  /**
   * 2) SILLONES (UPSERT)
   */
  for (let i = 1; i <= 3; i++) {
    const sillonIdValue = `CHR_${pad2(i)}`;
    const r = await upsertByField({
      table: TABLES.sillones as TableName,
      uniqueField: FIELDS.sillonId,
      uniqueValue: sillonIdValue,
      fields: {
        [FIELDS.sillonNombre]: `Sillón ${i}`,
        [FIELDS.citaClinica]: [clinic.id],
      },
      force: FORCE_OVERWRITE,
    });
    // opcional log detallado:
    // console.log(`  - Sillón ${sillonIdValue}: ${r.action}`);
  }
  console.log("✔ Sillones OK");

  /**
   * 3) STAFF (UPSERT)
   */
  const staffRows = [
    { id: "STF_001", nombre: "Dr. Andrés Rojas", rol: "Dentista" },
    { id: "STF_002", nombre: "Dra. Paula Díaz", rol: "Dentista" },
    { id: "STF_003", nombre: "Dr. Mateo López", rol: "Higienista" },
    { id: "STF_004", nombre: "Recepción FYLLIO", rol: "Recepcionista" },
  ] as const;

  for (const s of staffRows) {
    if (!STAFF_ROLES.includes(s.rol as any)) throw new Error(`Rol inválido: ${s.rol}`);

    await upsertByField({
      table: TABLES.staff as TableName,
      uniqueField: FIELDS.staffId,
      uniqueValue: s.id,
      fields: {
        [FIELDS.staffNombre]: s.nombre,
        [FIELDS.citaClinica]: [clinic.id],
        [FIELDS.staffRol]: s.rol,
        [FIELDS.staffActivo]: true,
      },
      force: FORCE_OVERWRITE,
    });
  }
  console.log("✔ Staff OK");

  /**
   * 4) PACIENTES (UPSERT en batch update/create)
   * Para 120, hacemos uno a uno por simplicidad (y evitar armar índice grande).
   */
  const patientNames = ["Ana García", "Carlos López", "Lucía Fernández", "Diego Martín", "María Pérez", "Sofía Torres"];

  for (let i = 1; i <= 120; i++) {
    const pid = `PAT_${pad2(i)}`;

    await upsertByField({
      table: TABLES.patients as TableName,
      uniqueField: FIELDS.pacienteId,
      uniqueValue: pid,
      fields: {
        [FIELDS.pacienteNombre]: pick(patientNames),
        [FIELDS.citaClinica]: [clinic.id],
        [FIELDS.pacienteTelefono]: `+346${randInt(10000000, 99999999)}`,
      },
      // pacientes: normalmente NO quieres pisar nombre/teléfono si ya es real
      force: false,
    });
  }
  console.log("✔ Pacientes OK");

  /**
   * 5) TRATAMIENTOS (UPSERT)
   * Importante: Categoria debe ser una de TRAT_CATEGORIAS
   */
  for (let i = 1; i <= 6; i++) {
    const tid = `SRV_${pad2(i)}`;

    await upsertByField({
      table: TABLES.treatments as TableName,
      uniqueField: FIELDS.tratId,
      uniqueValue: tid,
      fields: {
        [FIELDS.tratBuffer]: 10,
        [FIELDS.tratCategoria]: pick(TRAT_CATEGORIAS),
      },
      force: FORCE_OVERWRITE,
    });
  }
  console.log("✔ Tratamientos OK");

  /**
   * 6) CARGAR IDS para links
   */
  const [patients, treatments, staff, sillones] = await Promise.all([
    base(TABLES.patients as TableName).select({ maxRecords: 500 }).firstPage(),
    base(TABLES.treatments as TableName).select({ maxRecords: 200 }).firstPage(),
    base(TABLES.staff as TableName).select({ maxRecords: 200 }).firstPage(),
    base(TABLES.sillones as TableName).select({ maxRecords: 50 }).firstPage(),
  ]);

  const profesionales = staff.filter((s: any) => {
    const rol = s.get(FIELDS.staffRol);
    return rol === "Dentista" || rol === "Higienista";
  });

  if (!patients.length) throw new Error("No hay pacientes para linkear.");
  if (!treatments.length) throw new Error("No hay tratamientos para linkear.");
  if (!profesionales.length) throw new Error("No hay profesionales (Dentista/Higienista) para linkear.");
  if (!sillones.length) throw new Error("No hay sillones para linkear.");

  /**
   * 7) CITAS + LINKS (UPSERT)
   * Aquí la magia: si la cita ya existe, la actualiza (por defecto SOLO rellena vacíos)
   */
  const today = new Date();
  today.setHours(8, 30, 0, 0);

  // Para respetar batches, acumulamos updates/creates en arrays y ejecutamos en grupos
  const toCreate: any[] = [];
  const toUpdate: any[] = [];

  for (let i = 0; i < 80; i++) {
    const citaId = `APT_${pad2(i + 1)}`;
    const existing = await findByField(TABLES.appointments as TableName, FIELDS.citaId, citaId);

    const start = new Date(today);
    start.setDate(today.getDate() + randInt(0, 14));
    start.setHours(8 + randInt(0, 10), pick([0, 10, 20, 30, 40, 50] as const));

    const end = new Date(start);
    end.setMinutes(start.getMinutes() + 30);

    const estado = pick(["Agendado", "Confirmado"] as const);
    if (!CITA_ESTADOS.includes(estado as any)) throw new Error(`Estado inválido: ${estado}`);

    const origen = pick(CITA_ORIGENES);

    const paciente = pick(patients);
    const tratamiento = pick(treatments);
    const profesional = pick(profesionales);
    const sillon = pick(sillones);

    const nextFields = {
      [FIELDS.citaNombre]: "Cita demo",
      [FIELDS.citaClinica]: [clinic.id],

      // LINKS
      [FIELDS.citaPaciente]: [paciente.id],
      [FIELDS.citaTratamiento]: [tratamiento.id],
      [FIELDS.citaProfesional]: [profesional.id],
      [FIELDS.citaSillon]: [sillon.id],

      // FECHAS
      [FIELDS.citaInicio]: isoLocal(start),
      [FIELDS.citaFinal]: isoLocal(end),

      // SELECTS
      [FIELDS.citaEstado]: estado,
      [FIELDS.citaOrigen]: origen,
    };

    if (!existing) {
      toCreate.push({
        fields: {
          [FIELDS.citaId]: citaId,
          ...nextFields,
        },
      });
      continue;
    }

    const patch = mergeOnlyEmpty((existing as any).fields, nextFields, FORCE_OVERWRITE);
    if (Object.keys(patch).length === 0) continue;

    toUpdate.push({
      id: existing.id,
      fields: patch,
    });
  }

  for (const group of chunk(toCreate, 10)) {
    if (group.length) await base(TABLES.appointments as TableName).create(group);
  }
  for (const group of chunk(toUpdate, 10)) {
    if (group.length) await base(TABLES.appointments as TableName).update(group);
  }

  console.log(`✔ Citas OK (create=${toCreate.length}, update=${toUpdate.length})`);
  console.log("✅ Seed terminado");
}

seed().catch((e) => {
  console.error("❌ Seed falló:", e);
  process.exit(1);
});
