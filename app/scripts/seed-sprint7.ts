// app/scripts/seed-sprint7.ts
//
// Sprint 7 v5 + R2b — seed demo distribuido uniformemente entre las 10
// clínicas reales de RB Dental / Karen Dental. Se ejecuta tras
// `npx tsx app/scripts/clean-legacy.ts --apply` que deja las tablas de
// datos vacías.
//
// Distribución por clínica:
//   - 4 doctores (mix de especialidades) = 40 totales
//   - 20 pacientes                        = 200 totales
//   - 30 presupuestos (6 estados)         = 300 totales
//   - ~35 mensajes WhatsApp               = ~350 totales
//   - 5 no-shows históricos (Citas)       = 50 totales
//   - 4 leads (Lista_de_espera)           = 40 totales
//
// Idempotente: marcadores estables por tabla.
// Uso: npx tsx app/scripts/seed-sprint7.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";
import { hashPassword, hashPin } from "../lib/auth/hashing";

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════

const DEMO_ADMIN_NOMBRE = "Simon Wertheimer";

const CLINICAS: Array<{ nombre: string; ciudad: string }> = [
  { nombre: "RB Dental – Barajas", ciudad: "Madrid" },
  { nombre: "RB Dental – Meco", ciudad: "Madrid" },
  { nombre: "RB Dental – Colmenar Viejo", ciudad: "Madrid" },
  { nombre: "RB Dental – Toledo", ciudad: "Toledo" },
  { nombre: "RB Dental – Melilla Centro", ciudad: "Melilla" },
  { nombre: "RB Dental – Melilla Montemar", ciudad: "Melilla" },
  { nombre: "RB Dental – Melilla El Real", ciudad: "Melilla" },
  { nombre: "Karen Dental – Pinto", ciudad: "Madrid" },
  { nombre: "Karen Dental – Valdemoro 22", ciudad: "Madrid" },
  { nombre: "Karen Dental – Valdemoro 28", ciudad: "Madrid" },
];

const NOMBRES_PERSONAS = [
  "María", "Carmen", "Ana", "Laura", "Isabel", "Paula", "Cristina", "Elena",
  "Sara", "Lucía", "Marta", "Patricia", "Sofía", "Beatriz", "Raquel", "Claudia",
  "Carlos", "Javier", "David", "José", "Antonio", "Manuel", "Francisco", "Alberto",
  "Pablo", "Sergio", "Rubén", "Jorge", "Álvaro", "Daniel", "Adrián", "Roberto",
  "Nuria", "Silvia", "Eva", "Rocío", "Andrea", "Alba", "Irene", "Marina",
];
const APELLIDOS = [
  "García", "Martínez", "López", "Rodríguez", "Sánchez", "Pérez", "Fernández", "Gómez",
  "Jiménez", "Ruiz", "Hernández", "Díaz", "Moreno", "Álvarez", "Muñoz", "Romero",
  "Alonso", "Gutiérrez", "Navarro", "Torres", "Domínguez", "Vázquez", "Ramos", "Gil",
  "Serrano", "Blanco", "Molina", "Morales", "Suárez", "Ortega", "Delgado", "Castro",
];

const ESPECIALIDADES = ["General", "Prostodoncista", "Implantólogo", "Endodoncista", "Ortodoncia"] as const;

type EstadoPresupuesto = "PRESENTADO" | "INTERESADO" | "EN_DUDA" | "EN_NEGOCIACION" | "ACEPTADO" | "PERDIDO";
const ESTADOS: EstadoPresupuesto[] = ["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION", "ACEPTADO", "PERDIDO"];

const TRATAMIENTOS: Array<{ nombre: string; importeMin: number; importeMax: number }> = [
  { nombre: "Ortodoncia invisible (Invisalign)", importeMin: 3000, importeMax: 5500 },
  { nombre: "Implante dental", importeMin: 2500, importeMax: 3800 },
  { nombre: "Blanqueamiento dental", importeMin: 350, importeMax: 650 },
  { nombre: "Limpieza dental", importeMin: 50, importeMax: 90 },
  { nombre: "Empaste compuesto", importeMin: 70, importeMax: 120 },
  { nombre: "Endodoncia", importeMin: 200, importeMax: 400 },
  { nombre: "Corona cerámica", importeMin: 700, importeMax: 1100 },
  { nombre: "Revisión y limpieza", importeMin: 45, importeMax: 80 },
];

const ORIGENES: Array<"google_ads" | "seo_organico" | "referido_paciente" | "redes_sociales" | "walk_in" | "otro"> = [
  "google_ads", "seo_organico", "referido_paciente", "redes_sociales", "walk_in", "otro",
];
const TIPO_PACIENTE = ["Privado", "Adeslas"] as const;
const TIPO_VISITA = ["Primera Visita", "Paciente con Historia"] as const;
const CANAL_PREFERIDO = ["Whatsapp", "SMS", "Call"] as const;

// Distribución de estados por presupuesto para cada clínica (30 presupuestos):
// PRESENTADO 5, INTERESADO 6, EN_DUDA 5, EN_NEGOCIACION 4, ACEPTADO 5, PERDIDO 5.
const ESTADO_DISTRIBUTION: EstadoPresupuesto[] = [
  "PRESENTADO", "PRESENTADO", "PRESENTADO", "PRESENTADO", "PRESENTADO",
  "INTERESADO", "INTERESADO", "INTERESADO", "INTERESADO", "INTERESADO", "INTERESADO",
  "EN_DUDA", "EN_DUDA", "EN_DUDA", "EN_DUDA", "EN_DUDA",
  "EN_NEGOCIACION", "EN_NEGOCIACION", "EN_NEGOCIACION", "EN_NEGOCIACION",
  "ACEPTADO", "ACEPTADO", "ACEPTADO", "ACEPTADO", "ACEPTADO",
  "PERDIDO", "PERDIDO", "PERDIDO", "PERDIDO", "PERDIDO",
];

const CONV_TEMPLATES = [
  [
    { dir: "Saliente", text: "Hola {nombre}! Te escribo desde {clinica}. Tienes el presupuesto de {tratamiento} por {importe}€. ¿Quieres que te lo explique?" },
    { dir: "Entrante",  text: "Hola! Sí, me interesa. Me podrías decir si aceptáis Adeslas?" },
    { dir: "Saliente", text: "Sí, trabajamos con Adeslas. La cobertura depende del tratamiento. ¿Te paso detalles?" },
    { dir: "Entrante",  text: "Vale, perfecto. Espero info." },
  ],
  [
    { dir: "Saliente", text: "Buenos días {nombre}, te escribo de {clinica} para confirmar tu presupuesto de {tratamiento}." },
    { dir: "Entrante",  text: "Hola, lo estaba revisando. El precio me parece un poco alto, ¿hay posibilidad de financiar?" },
    { dir: "Saliente", text: "Sí, ofrecemos financiación hasta 24 meses sin intereses. ¿Te calculo la cuota?" },
  ],
  [
    { dir: "Saliente", text: "Hola {nombre}, soy de {clinica}. ¿Has tenido oportunidad de valorar el presupuesto que te enviamos?" },
    { dir: "Entrante",  text: "Sí, aún estoy pensándolo. ¿Cuánto tiempo es válido?" },
    { dir: "Saliente", text: "Es válido 30 días. Si necesitas asesoramiento, agenda una visita sin compromiso." },
    { dir: "Entrante",  text: "Ok, te confirmo en unos días." },
  ],
  [
    { dir: "Saliente", text: "Hola {nombre}, recordatorio de {clinica}: tienes pendiente aceptar el presupuesto de {tratamiento}." },
    { dir: "Entrante",  text: "Me lo voy a pensar, gracias." },
  ],
  [
    { dir: "Saliente", text: "{nombre}, te confirmo que hemos reservado el inicio del tratamiento. ¿Prefieres mañana o tarde?" },
    { dir: "Entrante",  text: "Tarde, mejor después de las 17h." },
    { dir: "Saliente", text: "Perfecto, te agendo el jueves 17:30. Confírmame si te va bien." },
    { dir: "Entrante",  text: "Genial, confirmado." },
  ],
];

// Cantidades por clínica
const DOCTORES_POR_CLINICA   = 4;   // 10×4  = 40
const PACIENTES_POR_CLINICA  = 20;  // 10×20 = 200
const PRESUPUESTOS_POR_CLI   = 30;  // 10×30 = 300
const MENSAJES_POR_CLINICA   = 35;  // 10×35 = 350
const NOSHOWS_POR_CLINICA    = 5;   // 10×5  = 50
const LEADS_POR_CLINICA      = 4;   // 10×4  = 40

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randChoice<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function randPhone(): string { return `+346${randInt(10000000, 99999999)}`; }
function randPin4(): string { return String(randInt(1000, 9999)); }
function randPin6(): string { return String(randInt(100000, 999999)); }
function randFullName(): string { return `${randChoice(NOMBRES_PERSONAS)} ${randChoice(APELLIDOS)} ${randChoice(APELLIDOS)}`; }
function daysAgo(d: number): Date { const t = new Date(); t.setDate(t.getDate() - d); return t; }
function toIsoDateOnly(d: Date): string { return d.toISOString().slice(0, 10); }
function toIsoDateTime(d: Date): string { return d.toISOString(); }
function pad4(n: number): string { return String(n).padStart(4, "0"); }
function escapeFormula(value: string): string { return value.replace(/'/g, "\\'"); }
async function chunkedCreate(tableName: any, records: Array<{ fields: Record<string, any> }>): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < records.length; i += 10) {
    const slice = records.slice(i, i + 10);
    const created = await base(tableName).create(slice);
    out.push(...created);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 1) CLÍNICAS
// ═══════════════════════════════════════════════════════════════════════

async function upsertClinicas(): Promise<Array<{ id: string; nombre: string }>> {
  console.log("\n[1/7] Clínicas");
  const existing = await fetchAll(base(TABLES.clinics).select({}));
  const byNombre = new Map<string, any>(existing.map((r) => [String(r.fields?.["Nombre"] ?? ""), r]));
  const out: Array<{ id: string; nombre: string }> = [];
  const toCreate: Array<{ fields: Record<string, any> }> = [];

  for (const c of CLINICAS) {
    const rec = byNombre.get(c.nombre);
    if (rec) {
      const patch: Record<string, any> = { Activa: true };
      if (!rec.fields?.["Ciudad"]) patch["Ciudad"] = c.ciudad;
      await base(TABLES.clinics).update([{ id: rec.id, fields: patch }]);
      out.push({ id: rec.id, nombre: c.nombre });
      console.log(`  ✔ ${c.nombre} (existente, activada)`);
    } else {
      toCreate.push({ fields: { Nombre: c.nombre, Ciudad: c.ciudad, Activa: true } });
    }
  }
  if (toCreate.length) {
    const created = await chunkedCreate(TABLES.clinics, toCreate);
    for (const rec of created) {
      out.push({ id: rec.id, nombre: String(rec.fields?.["Nombre"] ?? "") });
      console.log(`  ✔ ${rec.fields?.["Nombre"]} (creada)`);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 2) USUARIOS (admin + coords)
// ═══════════════════════════════════════════════════════════════════════

type UsuariosSeeded = {
  admin: { id: string; pin: string };
  coordinaciones: Array<{ id: string; nombre: string; clinicaId: string; pin: string }>;
};

async function upsertUsuarios(
  clinicas: Array<{ id: string; nombre: string }>
): Promise<UsuariosSeeded> {
  console.log("\n[2/7] Admin + coordinaciones");

  // ADMIN
  let admin: { id: string; pin: string };
  const adminExisting = await base(TABLES.usuarios)
    .select({
      filterByFormula: `AND({Nombre}='${escapeFormula(DEMO_ADMIN_NOMBRE)}', {Rol}='admin')`,
      maxRecords: 1,
    })
    .firstPage();
  if (adminExisting.length) {
    const rec = adminExisting[0]!;
    if (rec.fields?.["Pin_length"] !== 6) {
      const pin = randPin6();
      const pinHash = await hashPin(pin);
      await base(TABLES.usuarios).update([
        { id: rec.id, fields: { Pin_hash: pinHash, Pin_length: 6, Password_hash: "" } },
      ]);
      admin = { id: rec.id, pin };
      console.log(`  ↻ admin ${DEMO_ADMIN_NOMBRE} — regenerado PIN 6 dígitos`);
    } else {
      admin = { id: rec.id, pin: "(ya existente — PIN guardado previamente)" };
      console.log(`  ✔ admin ${DEMO_ADMIN_NOMBRE} (existente, PIN no se muestra)`);
    }
  } else {
    const pin = randPin6();
    const pinHash = await hashPin(pin);
    const created = (
      await base(TABLES.usuarios).create([
        { fields: { Nombre: DEMO_ADMIN_NOMBRE, Pin_hash: pinHash, Pin_length: 6, Rol: "admin", Activo: true } },
      ])
    )[0]!;
    admin = { id: created.id, pin };
    console.log(`  ✔ admin ${DEMO_ADMIN_NOMBRE} (creado)`);
  }

  // COORDINACIONES
  const coords: UsuariosSeeded["coordinaciones"] = [];
  for (const cli of clinicas) {
    const nombreCoord = `Coordinación ${cli.nombre}`;
    const existing = await base(TABLES.usuarios)
      .select({
        filterByFormula: `AND({Nombre}='${escapeFormula(nombreCoord)}', {Rol}='coordinacion')`,
        maxRecords: 1,
      })
      .firstPage();

    if (existing.length) {
      const rec = existing[0]!;
      if (rec.fields?.["Pin_length"] !== 4) {
        await base(TABLES.usuarios).update([{ id: rec.id, fields: { Pin_length: 4 } }]);
      }
      coords.push({ id: rec.id, nombre: nombreCoord, clinicaId: cli.id, pin: "(existente — PIN previo)" });
      console.log(`  ✔ ${nombreCoord} (existente)`);
    } else {
      const pin = randPin4();
      const pinHash = await hashPin(pin);
      const created = (
        await base(TABLES.usuarios).create([
          { fields: { Nombre: nombreCoord, Pin_hash: pinHash, Pin_length: 4, Rol: "coordinacion", Activo: true } },
        ])
      )[0]!;
      coords.push({ id: created.id, nombre: nombreCoord, clinicaId: cli.id, pin });
      console.log(`  ✔ ${nombreCoord} (creado)`);
    }
  }

  // Vínculos coord→clínica (idempotente)
  const junctions = await fetchAll(base(TABLES.usuarioClinicas).select({}));
  const linked = new Set<string>(
    junctions.map((r) => {
      const u = (r.fields?.["Usuario"] ?? []) as string[];
      const c = (r.fields?.["Clinica"] ?? []) as string[];
      return `${u[0] ?? ""}|${c[0] ?? ""}`;
    })
  );
  const newLinks: Array<{ fields: Record<string, any> }> = [];
  for (const c of coords) {
    if (!linked.has(`${c.id}|${c.clinicaId}`)) {
      newLinks.push({ fields: { Usuario: [c.id], Clinica: [c.clinicaId] } });
    }
  }
  if (newLinks.length) {
    await chunkedCreate(TABLES.usuarioClinicas, newLinks);
    console.log(`  ✔ ${newLinks.length} vínculos coord→clínica creados`);
  }

  return { admin, coordinaciones: coords };
}

// ═══════════════════════════════════════════════════════════════════════
// 3) DOCTORES — distribución fija N por clínica
// ═══════════════════════════════════════════════════════════════════════

type DoctorSeed = { id: string; nombre: string; especialidad: string; clinicaId: string };

async function upsertDoctores(
  clinicas: Array<{ id: string; nombre: string }>
): Promise<DoctorSeed[]> {
  console.log(`\n[3/7] Doctores (${DOCTORES_POR_CLINICA} por clínica)`);
  const out: DoctorSeed[] = [];

  for (const cli of clinicas) {
    // ¿Cuántos dentistas ya hay vinculados a esta clínica?
    const existing = await fetchAll(
      base(TABLES.staff).select({
        filterByFormula: `AND({Rol}='Dentista', FIND('${cli.id}', ARRAYJOIN({Clínica}))>0)`,
      })
    );
    // Como FIND sobre ARRAYJOIN de un link compara vs primary field, filtramos en memoria.
    const matched = existing.filter((r) => ((r.fields?.["Clínica"] ?? []) as string[]).includes(cli.id));

    for (const r of matched) {
      out.push({
        id: r.id,
        nombre: String(r.fields?.["Nombre"] ?? ""),
        especialidad: "General",
        clinicaId: cli.id,
      });
    }
    const needed = Math.max(0, DOCTORES_POR_CLINICA - matched.length);
    if (needed === 0) {
      console.log(`  ✔ ${cli.nombre}: ya tiene ${matched.length} dentistas`);
      continue;
    }
    const toCreate: Array<{ fields: Record<string, any> }> = [];
    for (let i = 0; i < needed; i++) {
      toCreate.push({
        fields: {
          Nombre: `Dr. ${randFullName()}`,
          Clínica: [cli.id],
          Rol: "Dentista",
          Activo: true,
          "Horario laboral": "08:30-19:00",
        },
      });
    }
    const created = await chunkedCreate(TABLES.staff, toCreate);
    for (const r of created) {
      out.push({
        id: r.id,
        nombre: String(r.fields?.["Nombre"] ?? ""),
        especialidad: "General",
        clinicaId: cli.id,
      });
    }
    console.log(`  ✔ ${cli.nombre}: +${needed} dentistas`);
  }

  // Especialidad virtual (no vive en Airtable; solo para seed de presupuestos)
  for (let i = 0; i < out.length; i++) {
    out[i]!.especialidad = ESPECIALIDADES[i % ESPECIALIDADES.length]!;
  }
  console.log(`  Total doctores: ${out.length}`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 4) PACIENTES — N por clínica
// ═══════════════════════════════════════════════════════════════════════

type PacienteSeed = { id: string; nombre: string; telefono: string; clinicaId: string };
const PAC_MARK = "[SEED]";

async function upsertPacientes(
  clinicas: Array<{ id: string; nombre: string }>
): Promise<PacienteSeed[]> {
  console.log(`\n[4/7] Pacientes (${PACIENTES_POR_CLINICA} por clínica)`);
  const all = await fetchAll(
    base(TABLES.patients).select({ filterByFormula: `FIND('${PAC_MARK}', {Notas}&'')` })
  );
  const porClinica = new Map<string, PacienteSeed[]>();
  for (const r of all) {
    const clis = (r.fields?.["Clínica"] ?? []) as string[];
    if (!clis[0]) continue;
    const p: PacienteSeed = {
      id: r.id,
      nombre: String(r.fields?.["Nombre"] ?? ""),
      telefono: String(r.fields?.["Teléfono"] ?? ""),
      clinicaId: clis[0],
    };
    if (!porClinica.has(clis[0])) porClinica.set(clis[0], []);
    porClinica.get(clis[0])!.push(p);
  }

  const out: PacienteSeed[] = [];
  for (const cli of clinicas) {
    const existing = porClinica.get(cli.id) ?? [];
    out.push(...existing);
    const needed = Math.max(0, PACIENTES_POR_CLINICA - existing.length);
    if (needed === 0) { console.log(`  ✔ ${cli.nombre}: ya tiene ${existing.length} pacientes`); continue; }

    const toCreate: Array<{ fields: Record<string, any> }> = [];
    for (let i = 0; i < needed; i++) {
      toCreate.push({
        fields: {
          Nombre: randFullName(),
          Clínica: [cli.id],
          "Teléfono": randPhone(),
          "Canal preferido": randChoice(CANAL_PREFERIDO),
          "Consentimiento Whatsapp": Math.random() > 0.25,
          "Consentimiento SMS": Math.random() > 0.5,
          Activo: Math.random() > 0.1,
          Notas: `${PAC_MARK} Paciente demo R2b`,
        },
      });
    }
    const created = await chunkedCreate(TABLES.patients, toCreate);
    for (const r of created) {
      out.push({
        id: r.id,
        nombre: String(r.fields?.["Nombre"] ?? ""),
        telefono: String(r.fields?.["Teléfono"] ?? ""),
        clinicaId: cli.id,
      });
    }
    console.log(`  ✔ ${cli.nombre}: +${needed} pacientes`);
  }
  console.log(`  Total pacientes: ${out.length}`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 5) PRESUPUESTOS — 30 por clínica, distribución fija entre 6 estados
// ═══════════════════════════════════════════════════════════════════════

const PRES_PREFIX = "SEED_P_";

type PresupuestoSeed = { id: string; airtableId: string; clinicaNombre: string; pacienteId: string; tratamiento: string; importe: number; fecha: Date };

async function upsertPresupuestos(
  clinicas: Array<{ id: string; nombre: string }>,
  pacientes: PacienteSeed[],
  doctores: DoctorSeed[]
): Promise<PresupuestoSeed[]> {
  console.log(`\n[5/7] Presupuestos (${PRESUPUESTOS_POR_CLI} por clínica)`);

  const existing = await fetchAll(
    base(TABLES.presupuestos).select({ filterByFormula: `FIND('${PRES_PREFIX}', {Presupuesto ID}&'')` })
  );
  const existingIds = new Set<string>(existing.map((r) => String(r.fields?.["Presupuesto ID"] ?? "")));

  const out: PresupuestoSeed[] = [];
  let nextSeq = (() => {
    let n = 1;
    while (existingIds.has(`${PRES_PREFIX}${pad4(n)}`)) n++;
    return n;
  })();

  for (const cli of clinicas) {
    const pacientesCli = pacientes.filter((p) => p.clinicaId === cli.id);
    const doctoresCli = doctores.filter((d) => d.clinicaId === cli.id);
    if (!pacientesCli.length || !doctoresCli.length) {
      console.log(`  ! ${cli.nombre}: sin pacientes/doctores — salto`);
      continue;
    }

    const cliPresups = existing.filter((r) => String(r.fields?.["Clinica"] ?? "") === cli.nombre);
    const cliExistentes = cliPresups.length;
    const needed = Math.max(0, PRESUPUESTOS_POR_CLI - cliExistentes);
    if (needed === 0) {
      console.log(`  ✔ ${cli.nombre}: ya tiene ${cliExistentes} presupuestos`);
      continue;
    }

    const toCreate: Array<{ fields: Record<string, any> }> = [];
    for (let i = 0; i < needed; i++) {
      const seq = nextSeq++;
      const id = `${PRES_PREFIX}${pad4(seq)}`;
      const estado = ESTADO_DISTRIBUTION[(cliExistentes + i) % ESTADO_DISTRIBUTION.length]!;
      const paciente = pacientesCli[Math.floor(Math.random() * pacientesCli.length)]!;
      const doctor   = doctoresCli[Math.floor(Math.random() * doctoresCli.length)]!;
      const trat     = randChoice(TRATAMIENTOS);
      const importe  = randInt(trat.importeMin, trat.importeMax);
      // Distribuir entre los últimos 6 meses; los más recientes tienden a ACEPTADO/ACTIVOS,
      // los más viejos a PERDIDO.
      const isActivo = !["ACEPTADO", "PERDIDO"].includes(estado);
      const diasAtras = isActivo ? randInt(0, 45) : randInt(30, 180);
      const fecha = daysAgo(diasAtras);

      const fields: Record<string, any> = {
        "Presupuesto ID": id,
        Paciente: [paciente.id],
        Tratamiento_nombre: trat.nombre,
        Importe: importe,
        Estado: estado,
        Fecha: toIsoDateOnly(fecha),
        FechaAlta: toIsoDateOnly(fecha),
        Doctor: doctor.nombre,
        Doctor_Especialidad: doctor.especialidad,
        Clinica: cli.nombre,
        TipoPaciente: randChoice(TIPO_PACIENTE),
        TipoVisita: randChoice(TIPO_VISITA),
        ContactCount: randInt(0, 5),
        CreadoPor: estado === "PRESENTADO" ? "IA" : "Recepción",
        Paciente_Telefono: paciente.telefono,
        OrigenLead: randChoice(ORIGENES),
      };
      if (estado === "PERDIDO") {
        fields["MotivoPerdida"] = randChoice([
          "precio_alto", "otra_clinica", "sin_urgencia", "necesita_financiacion",
          "miedo_tratamiento", "no_responde", "otro",
        ]);
      }
      if (estado === "EN_DUDA") {
        fields["MotivoDuda"] = randChoice([
          "precio", "otra_clinica", "sin_urgencia", "financiacion",
          "miedo", "comparando_opciones", "otro",
        ]);
      }
      toCreate.push({ fields });
    }

    const created = await chunkedCreate(TABLES.presupuestos, toCreate);
    for (let i = 0; i < created.length; i++) {
      const r = created[i]!;
      const f = r.fields ?? {};
      out.push({
        id: String(f["Presupuesto ID"] ?? ""),
        airtableId: r.id,
        clinicaNombre: cli.nombre,
        pacienteId: ((f["Paciente"] ?? []) as string[])[0] ?? "",
        tratamiento: String(f["Tratamiento_nombre"] ?? ""),
        importe: Number(f["Importe"] ?? 0),
        fecha: new Date(String(f["Fecha"] ?? "")),
      });
    }
    console.log(`  ✔ ${cli.nombre}: +${needed} presupuestos`);
  }

  // Sumar los existentes que ya estaban a `out` para poder construir mensajes.
  for (const r of existing) {
    const f = r.fields ?? {};
    out.push({
      id: String(f["Presupuesto ID"] ?? ""),
      airtableId: r.id,
      clinicaNombre: String(f["Clinica"] ?? ""),
      pacienteId: ((f["Paciente"] ?? []) as string[])[0] ?? "",
      tratamiento: String(f["Tratamiento_nombre"] ?? ""),
      importe: Number(f["Importe"] ?? 0),
      fecha: new Date(String(f["Fecha"] ?? "")),
    });
  }

  console.log(`  Total presupuestos: ${out.length}`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 6) MENSAJES WHATSAPP
// ═══════════════════════════════════════════════════════════════════════

const MENS_PREFIX = "SEED_M_";

async function upsertMensajes(
  clinicas: Array<{ id: string; nombre: string }>,
  pacientes: PacienteSeed[],
  presupuestos: PresupuestoSeed[]
): Promise<number> {
  console.log(`\n[6/7] Mensajes WhatsApp (${MENSAJES_POR_CLINICA} por clínica)`);
  if (!presupuestos.length) { console.log("  ! Sin presupuestos — salto"); return 0; }

  const pacienteById = new Map(pacientes.map((p) => [p.id, p]));
  const presupPorCli = new Map<string, PresupuestoSeed[]>();
  for (const p of presupuestos) {
    if (!presupPorCli.has(p.clinicaNombre)) presupPorCli.set(p.clinicaNombre, []);
    presupPorCli.get(p.clinicaNombre)!.push(p);
  }

  const existing = await fetchAll(
    base(TABLES.mensajesWhatsApp).select({ filterByFormula: `FIND('${MENS_PREFIX}', {WABA_message_id}&'')` })
  );
  const existingIds = new Set<string>(existing.map((r) => String(r.fields?.["WABA_message_id"] ?? "")));
  let nextSeq = (() => { let n = 1; while (existingIds.has(`${MENS_PREFIX}${pad4(n)}`)) n++; return n; })();

  let totalCreados = 0;

  for (const cli of clinicas) {
    const presupsCli = presupPorCli.get(cli.nombre) ?? [];
    if (!presupsCli.length) continue;

    const toCreate: Array<{ fields: Record<string, any> }> = [];
    while (toCreate.length < MENSAJES_POR_CLINICA) {
      const presup = presupsCli[Math.floor(Math.random() * presupsCli.length)]!;
      const paciente = pacienteById.get(presup.pacienteId);
      if (!paciente) continue;
      const tpl = randChoice(CONV_TEMPLATES);

      for (let m = 0; m < tpl.length && toCreate.length < MENSAJES_POR_CLINICA; m++) {
        const msg = tpl[m]!;
        const ts = new Date(presup.fecha);
        ts.setHours(ts.getHours() + m * randInt(1, 18));
        const texto = msg.text
          .replace("{nombre}", paciente.nombre.split(" ")[0] ?? "")
          .replace("{clinica}", cli.nombre)
          .replace("{tratamiento}", presup.tratamiento)
          .replace("{importe}", String(presup.importe));

        toCreate.push({
          fields: {
            Paciente: paciente.nombre,
            Presupuesto: presup.airtableId,
            Telefono: paciente.telefono,
            Direccion: msg.dir,
            Contenido: texto,
            Timestamp: toIsoDateTime(ts),
            Fuente: msg.dir === "Saliente" ? "Modo_B_WABA" : "Modo_A_manual",
            Procesado_por_IA: Math.random() > 0.3,
            WABA_message_id: `${MENS_PREFIX}${pad4(nextSeq++)}`,
          },
        });
      }
    }
    await chunkedCreate(TABLES.mensajesWhatsApp, toCreate);
    totalCreados += toCreate.length;
    console.log(`  ✔ ${cli.nombre}: +${toCreate.length} mensajes`);
  }
  console.log(`  Total mensajes: ${totalCreados}`);
  return totalCreados;
}

// ═══════════════════════════════════════════════════════════════════════
// 7) NO-SHOWS HISTÓRICOS (Citas Estado="No-show") + LEADS (Lista_de_espera)
// ═══════════════════════════════════════════════════════════════════════

async function upsertNoShows(
  clinicas: Array<{ id: string; nombre: string }>,
  pacientes: PacienteSeed[],
  doctores: DoctorSeed[]
): Promise<number> {
  console.log(`\n[7a/7] No-shows históricos (${NOSHOWS_POR_CLINICA} por clínica)`);
  const existing = await fetchAll(
    base(TABLES.appointments).select({ filterByFormula: `AND({Estado}='No-show', FIND('[SEED]', {Notas}&'')>0)` })
  );
  const byClinicaCount = new Map<string, number>();
  for (const r of existing) {
    const clis = (r.fields?.["Clínica"] ?? []) as string[];
    if (clis[0]) byClinicaCount.set(clis[0], (byClinicaCount.get(clis[0]) ?? 0) + 1);
  }

  let total = 0;
  for (const cli of clinicas) {
    const existentes = byClinicaCount.get(cli.id) ?? 0;
    const needed = Math.max(0, NOSHOWS_POR_CLINICA - existentes);
    if (needed === 0) continue;

    const pacientesCli = pacientes.filter((p) => p.clinicaId === cli.id);
    const doctoresCli = doctores.filter((d) => d.clinicaId === cli.id);
    if (!pacientesCli.length || !doctoresCli.length) continue;

    const toCreate: Array<{ fields: Record<string, any> }> = [];
    for (let i = 0; i < needed; i++) {
      const paciente = pacientesCli[Math.floor(Math.random() * pacientesCli.length)]!;
      const doctor = doctoresCli[Math.floor(Math.random() * doctoresCli.length)]!;
      const diasAtras = randInt(7, 120);
      const start = daysAgo(diasAtras);
      start.setHours(9 + randInt(0, 8), randInt(0, 3) * 15, 0, 0);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + 30);
      toCreate.push({
        fields: {
          Nombre: `No-show ${paciente.nombre.split(" ")[0]}`,
          Clínica: [cli.id],
          Paciente: [paciente.id],
          Profesional: [doctor.id],
          "Hora inicio": toIsoDateTime(start),
          "Hora final": toIsoDateTime(end),
          Estado: "No-show",
          Origen: randChoice(["IA", "Recepción", "Paciente", "WhatsApp"]),
          Notas: "[SEED] no-show histórico",
        },
      });
    }
    await chunkedCreate(TABLES.appointments, toCreate);
    total += toCreate.length;
    console.log(`  ✔ ${cli.nombre}: +${needed} no-shows`);
  }
  console.log(`  Total no-shows: ${total}`);
  return total;
}

async function upsertLeads(
  clinicas: Array<{ id: string; nombre: string }>,
  pacientes: PacienteSeed[]
): Promise<number> {
  console.log(`\n[7b/7] Leads (${LEADS_POR_CLINICA} por clínica)`);
  const ESTADOS_LEAD = ["ACTIVE", "OFFERED", "EXPIRED", "PAUSED", "BOOKED"] as const;

  const existing = await fetchAll(
    base(TABLES.waitlist).select({ filterByFormula: `FIND('[SEED]', {Notas}&'')>0` })
  );
  const byClinicaCount = new Map<string, number>();
  for (const r of existing) {
    const clis = (r.fields?.["Clínica"] ?? []) as string[];
    if (clis[0]) byClinicaCount.set(clis[0], (byClinicaCount.get(clis[0]) ?? 0) + 1);
  }

  let total = 0;
  for (const cli of clinicas) {
    const existentes = byClinicaCount.get(cli.id) ?? 0;
    const needed = Math.max(0, LEADS_POR_CLINICA - existentes);
    if (needed === 0) continue;

    const pacientesCli = pacientes.filter((p) => p.clinicaId === cli.id);
    if (!pacientesCli.length) continue;

    const toCreate: Array<{ fields: Record<string, any> }> = [];
    for (let i = 0; i < needed; i++) {
      const paciente = pacientesCli[Math.floor(Math.random() * pacientesCli.length)]!;
      const hoy = new Date();
      const endRange = new Date(hoy);
      endRange.setDate(endRange.getDate() + randInt(3, 21));
      toCreate.push({
        fields: {
          Clínica: [cli.id],
          Paciente: [paciente.id],
          "Preferencia de horario": randChoice(["Mañana", "Tarde", "Indiferente"]),
          Rango_Deseado_Start: toIsoDateTime(hoy),
          Rango_Deseado_End: toIsoDateTime(endRange),
          Estado: randChoice(ESTADOS_LEAD),
          Prioridad: randChoice(["Alta", "Media", " Baja"]),
          Notas: "[SEED] lead demo R2b",
        },
      });
    }
    await chunkedCreate(TABLES.waitlist, toCreate);
    total += toCreate.length;
    console.log(`  ✔ ${cli.nombre}: +${needed} leads`);
  }
  console.log(`  Total leads: ${total}`);
  return total;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log("Sprint 7 seed (v5 + R2b distribuido) — inicio");
  if (!process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_API_KEY) {
    throw new Error("Faltan AIRTABLE_BASE_ID / AIRTABLE_API_KEY en .env.local");
  }

  const clinicas = await upsertClinicas();
  const usuarios = await upsertUsuarios(clinicas);
  const doctores = await upsertDoctores(clinicas);
  const pacientes = await upsertPacientes(clinicas);
  const presupuestos = await upsertPresupuestos(clinicas, pacientes, doctores);
  const nMensajes = await upsertMensajes(clinicas, pacientes, presupuestos);
  const nNoShows = await upsertNoShows(clinicas, pacientes, doctores);
  const nLeads = await upsertLeads(clinicas, pacientes);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("✅ SEED SPRINT 7 R2b COMPLETO");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Clínicas:        ${clinicas.length}`);
  console.log(`Admin:           ${DEMO_ADMIN_NOMBRE} — PIN ${usuarios.admin.pin}`);
  console.log(`Coordinaciones:  ${usuarios.coordinaciones.length}`);
  console.log(`Doctores:        ${doctores.length}`);
  console.log(`Pacientes:       ${pacientes.length}`);
  console.log(`Presupuestos:    ${presupuestos.length}`);
  console.log(`Mensajes:        ${nMensajes} creados esta corrida`);
  console.log(`No-shows:        ${nNoShows}`);
  console.log(`Leads:           ${nLeads}`);
  console.log("\nPINs coordinación:");
  for (const c of usuarios.coordinaciones) {
    console.log(`  ${c.nombre.padEnd(55)} PIN ${c.pin}`);
  }
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("❌ Seed falló:", err);
  process.exit(1);
});
