// app/scripts/sprint17-seed-paciente-test.ts
//
// Sprint 17 — seed paciente "Test Vapi" + cita test asociada para
// validar el flujo Voice IA end-to-end.
//
// Idempotente: si ya existe un paciente con nombre "Test Vapi" y
// teléfono +34667188097, NO duplica. Igual con la cita: si ya hay
// una cita asociada a ese paciente con Notas que incluye la marca
// "[seed-test-vapi]", la reutiliza.
//
// Uso: npx tsx app/scripts/sprint17-seed-paciente-test.ts [--apply-prod]

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import Airtable from "airtable";

const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const KEY = process.env.AIRTABLE_API_KEY!;
const APPLY_PROD = process.argv.includes("--apply-prod");
const PROD_BASE_ID = "appfUJcyGnkZ16Fhr";

if (!BASE_ID || !KEY) {
  console.error("Faltan AIRTABLE_BASE_ID / AIRTABLE_API_KEY en .env.local");
  process.exit(1);
}
if (BASE_ID === PROD_BASE_ID && !APPLY_PROD) {
  console.error("✖ Prod requiere --apply-prod explicito.");
  process.exit(1);
}

const base = new Airtable({ apiKey: KEY }).base(BASE_ID);

const NOMBRE_TEST = "Test Vapi";
const TELEFONO_TEST = "+34667188097";
const SEED_MARK = "[seed-test-vapi]";

async function findClinicaActiva(): Promise<{ id: string; nombre: string }> {
  const recs = await base("Clínicas")
    .select({
      filterByFormula: "{Activa}",
      maxRecords: 1,
    })
    .firstPage();
  if (recs.length === 0) {
    // Si no hay activa, coger cualquiera.
    const fallback = await base("Clínicas").select({ maxRecords: 1 }).firstPage();
    if (fallback.length === 0) throw new Error("No hay clínicas en la base.");
    return {
      id: fallback[0]!.id,
      nombre: String(fallback[0]!.fields["Nombre"] ?? "(sin nombre)"),
    };
  }
  return {
    id: recs[0]!.id,
    nombre: String(recs[0]!.fields["Nombre"] ?? "(sin nombre)"),
  };
}

async function findStaffActivoEnClinica(
  clinicaId: string,
): Promise<{ id: string; nombre: string } | null> {
  const recs = await base("Staff")
    .select({
      filterByFormula: `AND({Activo}, FIND("${clinicaId}", ARRAYJOIN({Clínica}, ",")))`,
      maxRecords: 1,
    })
    .firstPage();
  if (recs.length === 0) {
    // Fallback sin filtro de clínica.
    const any = await base("Staff")
      .select({ filterByFormula: "{Activo}", maxRecords: 1 })
      .firstPage();
    if (any.length === 0) return null;
    return {
      id: any[0]!.id,
      nombre: String(any[0]!.fields["Nombre"] ?? "(sin nombre)"),
    };
  }
  return {
    id: recs[0]!.id,
    nombre: String(recs[0]!.fields["Nombre"] ?? "(sin nombre)"),
  };
}

async function findTratamientoEnClinica(
  clinicaId: string,
): Promise<{ id: string; nombre: string } | null> {
  const recs = await base("Tratamientos")
    .select({
      filterByFormula: `FIND("${clinicaId}", ARRAYJOIN({Clínica}, ","))`,
      maxRecords: 1,
    })
    .firstPage();
  if (recs.length === 0) {
    const any = await base("Tratamientos").select({ maxRecords: 1 }).firstPage();
    if (any.length === 0) return null;
    return {
      id: any[0]!.id,
      nombre: String(any[0]!.fields["Nombre"] ?? "(sin nombre)"),
    };
  }
  return {
    id: recs[0]!.id,
    nombre: String(recs[0]!.fields["Nombre"] ?? "(sin nombre)"),
  };
}

async function findPacienteTest(): Promise<string | null> {
  const recs = await base("Pacientes")
    .select({
      filterByFormula: `AND({Nombre} = "${NOMBRE_TEST}", {Teléfono} = "${TELEFONO_TEST}")`,
      maxRecords: 1,
    })
    .firstPage();
  return recs[0]?.id ?? null;
}

async function findCitaTestPara(pacienteId: string): Promise<string | null> {
  // Nota: ARRAYJOIN({Paciente}) devuelve nombres (lookup display), NO
  // recordIds — el FIND combinado fallaba siempre. Búsqueda en JS:
  // traemos las citas con marca seed y filtramos por Paciente link.
  const recs = await base("Citas")
    .select({
      filterByFormula: `FIND("${SEED_MARK}", {Notas})`,
      maxRecords: 50,
    })
    .firstPage();
  for (const r of recs) {
    const ps = r.fields["Paciente"];
    if (Array.isArray(ps) && ps.includes(pacienteId)) return r.id;
  }
  return null;
}

function isoMananaA10h(): { inicio: string; fin: string } {
  const m = new Date();
  m.setDate(m.getDate() + 1);
  m.setHours(10, 0, 0, 0);
  const fin = new Date(m.getTime() + 30 * 60 * 1000);
  return { inicio: m.toISOString(), fin: fin.toISOString() };
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(`Sprint 17 seed paciente test · base ${BASE_ID} (${target})`);

  // ── Clínica ──
  const clinica = await findClinicaActiva();
  console.log(`  · clínica: ${clinica.nombre} (${clinica.id})`);

  // ── Staff (doctor) ──
  const staff = await findStaffActivoEnClinica(clinica.id);
  if (staff) console.log(`  · doctor: ${staff.nombre} (${staff.id})`);
  else console.log("  · doctor: ninguno disponible (la cita irá sin Profesional)");

  // ── Tratamiento ──
  const tratamiento = await findTratamientoEnClinica(clinica.id);
  if (tratamiento)
    console.log(`  · tratamiento: ${tratamiento.nombre} (${tratamiento.id})`);
  else console.log("  · tratamiento: ninguno disponible (la cita irá sin link Tratamiento)");

  // ── Paciente test ──
  let pacienteId = await findPacienteTest();
  if (pacienteId) {
    console.log(`  · paciente: existe (${pacienteId})`);
  } else {
    const created = await base("Pacientes").create(
      [
        {
          fields: {
            Nombre: NOMBRE_TEST,
            Teléfono: TELEFONO_TEST,
            Clínica: [clinica.id],
            Activo: true,
            "Canal preferido": "Whatsapp",
            "Consentimiento Whatsapp": true,
            Optout_Automatizaciones: false,
            Notas: `${SEED_MARK} paciente sintético creado por sprint17-seed-paciente-test.ts`,
            CreatedAt: new Date().toISOString(),
          },
        },
      ],
      { typecast: true },
    );
    pacienteId = created[0]!.id;
    console.log(`✅ Paciente test creado: ${pacienteId}`);
  }

  // ── Cita test ──
  let citaId = await findCitaTestPara(pacienteId);
  if (citaId) {
    console.log(`  · cita: existe (${citaId})`);
  } else {
    const { inicio, fin } = isoMananaA10h();
    const fields: Record<string, any> = {
      Nombre: `Test confirmación ${NOMBRE_TEST}`,
      Paciente: [pacienteId],
      Clínica: [clinica.id],
      "Hora inicio": inicio,
      "Hora final": fin,
      Estado: "Pendiente",
      Origen_Sistema: "fyllio_native",
      Duracion_Min: 30,
      Notas: `${SEED_MARK} Test confirmación llamada — cita sintética creada por sprint17-seed-paciente-test.ts`,
      Created_At: new Date().toISOString(),
    };
    if (staff) fields.Profesional = [staff.id];
    if (tratamiento) fields.Tratamiento = [tratamiento.id];

    const created = await base("Citas").create([{ fields }], { typecast: true });
    citaId = created[0]!.id;
    console.log(`✅ Cita test creada: ${citaId}`);
    console.log(`     Hora inicio: ${inicio} (mañana 10:00 local)`);
  }

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Para test call, usar pacienteId=${pacienteId} y citaId=${citaId}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
