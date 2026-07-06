// app/scripts/sprint-B-seed-negocio-qa.ts
//
// Sprint B — mini-seed de DATOS DE NEGOCIO de prueba para el QA de aislamiento.
// SOLO datos de prueba, marcados con "[SEED_QA]" y "Presupuesto ID" = SEED_QA_*.
// Idempotente: reejecutar no duplica (salta lo que ya existe por su Presupuesto ID).
//
// Qué crea:
//  - En la base de RB: pacientes+presupuestos reconocibles en Melilla y en Madrid.
//  - En la base de INDEP: pacientes+presupuestos con nombre claramente distinto
//    ("PACIENTE INDEP TEST …"), para el Escenario 1 (buscar el dato INDEP estando
//    en RB y confirmar que NO aparece).
//
// Por qué así (según el esquema real de la base):
//  - Presupuestos.Clinica es TEXTO → escribimos el nombre exacto de la clínica
//    central; ése es el que decide el filtro por clínica del QA.
//  - Presupuestos.Paciente_nombre es un LOOKUP a través del link {Paciente} → para
//    que el nombre reconocible aparezca en la UI y en la búsqueda por nombre,
//    creamos un Paciente y enlazamos el Presupuesto a él.
//  - Pacientes.Clínica es un LINK → resolvemos el record ID de la clínica por
//    nombre en la propia base. Si no está, el paciente se crea sin ese link (el
//    Presupuesto igualmente lleva Clinica=texto, que es lo que filtra el QA).
//
// Requiere en el entorno: AIRTABLE_API_KEY + AIRTABLE_BASE_RB + AIRTABLE_BASE_INDEP.
// (AIRTABLE_BASE_INDEP solo para la parte INDEP.)
//
// Uso:
//   npx tsx app/scripts/sprint-B-seed-negocio-qa.ts --dry           # no escribe, solo muestra
//   npx tsx app/scripts/sprint-B-seed-negocio-qa.ts                 # escribe RB + INDEP
//   npx tsx app/scripts/sprint-B-seed-negocio-qa.ts --cliente=RB    # solo RB
//   npx tsx app/scripts/sprint-B-seed-negocio-qa.ts --dry --cliente=DEMO  # validar lógica contra la base DEMO

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { runWithCliente, base, baseCentral, TABLES, fetchAll, type Cliente } from "../lib/airtable";

const DRY = process.argv.includes("--dry");
const CLEAN = process.argv.includes("--clean");
const CLIENTE_ARG = (process.argv.find((a) => a.startsWith("--cliente=")) ?? "").split("=")[1] as
  | Cliente
  | undefined;

const HOY = new Date().toISOString().slice(0, 10);

type SeedRow = {
  presupuestoId: string; // "Presupuesto ID" (clave idempotente), prefijo SEED_QA_
  pacienteNombre: string; // nombre reconocible (sube por el lookup Paciente_nombre)
  clinica: string; // nombre EXACTO de la clínica central (texto en Presupuestos.Clinica)
  tratamiento: string;
  estado: string; // PRESENTADO | INTERESADO | EN_DUDA | EN_NEGOCIACION | ACEPTADO | PERDIDO
  importe: number;
};

const RB_ROWS: SeedRow[] = [
  { presupuestoId: "SEED_QA_RB_MEL_1", pacienteNombre: "QA MELILLA · Ana Prueba Uno", clinica: "RB Dental – Melilla Centro", tratamiento: "Implante dental", estado: "PRESENTADO", importe: 2800 },
  { presupuestoId: "SEED_QA_RB_MEL_2", pacienteNombre: "QA MELILLA · Beto Prueba Dos", clinica: "RB Dental – Melilla Montemar", tratamiento: "Ortodoncia invisible", estado: "INTERESADO", importe: 3500 },
  { presupuestoId: "SEED_QA_RB_MAD_1", pacienteNombre: "QA MADRID · Carla Prueba Uno", clinica: "RB Dental – Barajas", tratamiento: "Corona cerámica", estado: "EN_NEGOCIACION", importe: 950 },
  { presupuestoId: "SEED_QA_RB_MAD_2", pacienteNombre: "QA MADRID · Dario Prueba Dos", clinica: "RB Dental – Meco", tratamiento: "Empaste compuesto", estado: "PRESENTADO", importe: 120 },
];

const INDEP_ROWS: SeedRow[] = [
  { presupuestoId: "SEED_QA_INDEP_1", pacienteNombre: "PACIENTE INDEP TEST UNO", clinica: "Clínica Independiente – Piloto", tratamiento: "Implante dental", estado: "PRESENTADO", importe: 2600 },
  { presupuestoId: "SEED_QA_INDEP_2", pacienteNombre: "PACIENTE INDEP TEST DOS", clinica: "Clínica Independiente – Piloto", tratamiento: "Blanqueamiento dental", estado: "INTERESADO", importe: 300 },
];

function esc(s: string): string {
  return s.replace(/'/g, "\\'");
}

async function findClinicaRecId(nombre: string): Promise<string | null> {
  const recs = await base(TABLES.clinics)
    .select({ filterByFormula: `{Nombre}='${esc(nombre)}'`, maxRecords: 1 })
    .firstPage();
  return recs[0]?.id ?? null;
}

/**
 * Puebla la tabla Clínicas de la base de NEGOCIO del cliente con TODAS sus
 * clínicas (nombres desde la base central), para que Pacientes/Citas/Leads
 * puedan enlazar su clínica y el filtro por clínica del coord funcione. Corre
 * dentro de runWithCliente(cliente). Idempotente (upsert por Nombre). Escribe
 * solo el campo Nombre (el enlace solo necesita que el registro exista).
 */
async function ensureClinicasNegocio(cliente: Cliente): Promise<void> {
  const centralRecs = await fetchAll(
    baseCentral(TABLES.clinics).select({
      filterByFormula: `{Cliente}='${cliente}'`,
      fields: ["Nombre"],
    }),
  );
  const centralNombres = centralRecs
    .map((r) => String((r.fields as any)?.["Nombre"] ?? ""))
    .filter(Boolean);

  const negocioRecs = await fetchAll(base(TABLES.clinics).select({ fields: ["Nombre"] }));
  const negocioNombres = new Set(
    negocioRecs.map((r) => String((r.fields as any)?.["Nombre"] ?? "")),
  );

  const faltan = centralNombres.filter((n) => !negocioNombres.has(n));
  if (faltan.length === 0) {
    console.log(`   clínicas de negocio: ${centralNombres.length} ya presentes (idempotente)`);
    return;
  }
  if (DRY) {
    console.log(`   [dry] crearía ${faltan.length} clínicas de negocio: ${faltan.join(", ")}`);
    return;
  }
  for (let i = 0; i < faltan.length; i += 10) {
    await (base(TABLES.clinics) as any).create(
      faltan.slice(i, i + 10).map((nombre) => ({ fields: { Nombre: nombre } })),
    );
  }
  console.log(`   + creadas ${faltan.length} clínicas de negocio: ${faltan.join(", ")}`);
}

async function findPresupuestoBySeedId(seedId: string): Promise<string | null> {
  const recs = await base(TABLES.presupuestos)
    .select({ filterByFormula: `{Presupuesto ID}='${esc(seedId)}'`, maxRecords: 1 })
    .firstPage();
  return recs[0]?.id ?? null;
}

async function findPacienteByNombre(nombre: string): Promise<string | null> {
  const recs = await base(TABLES.patients)
    .select({ filterByFormula: `{Nombre}='${esc(nombre)}'`, maxRecords: 1 })
    .firstPage();
  return recs[0]?.id ?? null;
}

async function upsertPaciente(nombre: string, clinicaRecId: string | null): Promise<string | null> {
  const existing = await findPacienteByNombre(nombre);
  if (existing) {
    console.log(`     · paciente ya existe: "${nombre}"`);
    return existing;
  }
  if (DRY) {
    console.log(`     · [dry] crearía Paciente "${nombre}"${clinicaRecId ? " (con link de clínica)" : " (SIN link de clínica)"}`);
    return "dry";
  }
  const fields: Record<string, unknown> = { Nombre: nombre, Activo: true, Notas: "[SEED_QA]" };
  if (clinicaRecId) fields["Clínica"] = [clinicaRecId];
  const created = await (base(TABLES.patients) as any).create([{ fields }]);
  return created[0].id as string;
}

async function seedRow(row: SeedRow): Promise<"created" | "skipped" | "error"> {
  const exists = await findPresupuestoBySeedId(row.presupuestoId);
  if (exists) {
    console.log(`   = ${row.presupuestoId} ya existe (skip)`);
    return "skipped";
  }
  const clinicaRecId = await findClinicaRecId(row.clinica);
  if (!clinicaRecId) {
    console.log(`   ! clínica "${row.clinica}" NO está en Clínicas de esta base → paciente sin link (el Presupuesto igual lleva Clinica=texto).`);
  }
  const pacienteRecId = await upsertPaciente(row.pacienteNombre, clinicaRecId);

  if (DRY) {
    console.log(`   [dry] crearía Presupuesto ${row.presupuestoId} · ${row.clinica} · ${row.pacienteNombre}`);
    return "created";
  }
  const fields: Record<string, unknown> = {
    "Presupuesto ID": row.presupuestoId,
    Tratamiento_nombre: row.tratamiento,
    Estado: row.estado,
    Fecha: HOY,
    Importe: row.importe,
    Clinica: row.clinica,
    Notas: "[SEED_QA]",
  };
  if (pacienteRecId && pacienteRecId !== "dry") fields["Paciente"] = [pacienteRecId];
  await (base(TABLES.presupuestos) as any).create([{ fields }]);
  console.log(`   + creado ${row.presupuestoId} · ${row.clinica} · ${row.pacienteNombre}`);
  return "created";
}

async function cleanCliente(cliente: Cliente): Promise<void> {
  console.log(`\n=== LIMPIEZA base del cliente ${cliente} (borra solo [SEED_QA]) ===`);
  await runWithCliente(cliente, async () => {
    // Presupuestos con Presupuesto ID SEED_QA_*
    const presRecs = await base(TABLES.presupuestos)
      .select({ filterByFormula: `FIND('SEED_QA_', {Presupuesto ID}&'') = 1`, fields: ["Presupuesto ID"] })
      .all();
    // Pacientes marcados [SEED_QA]
    const pacRecs = await base(TABLES.patients)
      .select({ filterByFormula: `{Notas}='[SEED_QA]'`, fields: ["Nombre"] })
      .all();
    console.log(`   encontrados: ${presRecs.length} presupuestos + ${pacRecs.length} pacientes [SEED_QA]`);
    if (DRY) {
      console.log("   [dry] no se borra nada");
      return;
    }
    for (const group of [
      { tbl: TABLES.presupuestos, ids: presRecs.map((r) => r.id) },
      { tbl: TABLES.patients, ids: pacRecs.map((r) => r.id) },
    ]) {
      for (let i = 0; i < group.ids.length; i += 10) {
        await (base(group.tbl) as any).destroy(group.ids.slice(i, i + 10));
      }
    }
    console.log(`   borrados: ${presRecs.length} presupuestos + ${pacRecs.length} pacientes`);
  });
}

async function seedCliente(cliente: Cliente, rows: SeedRow[]): Promise<void> {
  console.log(`\n=== Base del cliente ${cliente} (${rows.length} filas de prueba) ===`);
  await runWithCliente(cliente, async () => {
    // 1) Asegurar que las clínicas existen en la base de negocio (para el enlace).
    await ensureClinicasNegocio(cliente);
    // 2) Sembrar pacientes+presupuestos de prueba.
    const counts = { created: 0, skipped: 0, error: 0 };
    for (const row of rows) {
      try {
        counts[await seedRow(row)]++;
      } catch (e) {
        counts.error++;
        console.log(`   ✗ error en ${row.presupuestoId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`   → creados: ${counts.created}, saltados: ${counts.skipped}, errores: ${counts.error}`);
  });
}

async function main() {
  const action = CLEAN ? cleanCliente : null;
  console.log(
    CLEAN
      ? (DRY ? "MODO CLEAN + DRY (no borra, solo cuenta)\n" : "CLEAN — borra SOLO los datos [SEED_QA]\n")
      : (DRY ? "MODO DRY-RUN (no escribe nada)\n" : "SEED — escribe datos de PRUEBA marcados [SEED_QA]\n"),
  );

  const run = async (cliente: Cliente, rows: SeedRow[]) =>
    action ? action(cliente) : seedCliente(cliente, rows);

  if (CLIENTE_ARG === "DEMO") {
    // Validación contra la base DEMO (accesible localmente): usa las filas de RB
    // porque la base DEMO contiene las clínicas RB por nombre.
    await run("DEMO", RB_ROWS);
  } else if (CLIENTE_ARG === "RB") {
    await run("RB", RB_ROWS);
  } else if (CLIENTE_ARG === "INDEP") {
    await run("INDEP", INDEP_ROWS);
  } else {
    await run("RB", RB_ROWS);
    await run("INDEP", INDEP_ROWS);
  }

  console.log(
    CLEAN
      ? "\nLimpieza terminada."
      : "\nListo. Reejecutar es idempotente (salta lo ya creado por su Presupuesto ID).",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
