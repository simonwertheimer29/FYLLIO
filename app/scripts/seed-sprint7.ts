// app/scripts/seed-sprint7.ts
//
// Sprint 7 (v5) — Seed demo completo para piloto R2b.
// Pobla Airtable con:
//   - 10 clínicas específicas (RB Dental + Karen Dental)
//   - 1 admin (Simon Wertheimer) + 10 coordinaciones (una por clínica)
//   - 22 doctores distribuidos
//   - 50 pacientes
//   - 250 presupuestos (80-100 "leads" recientes + 150-200 históricos)
//   - 250 mensajes WhatsApp en conversaciones
//
// Idempotente. Los datos creados llevan marcadores estables:
//   - Usuarios: Nombre único (admin "Simon Wertheimer", coord "Coordinación {Clínica}")
//   - Staff: Nombre + clínica único
//   - Pacientes: Notas empieza con "[SEED]"
//   - Presupuestos: Presupuesto ID con formato "SEED_P_XXXX"
//   - Mensajes: WABA_message_id con formato "SEED_M_XXXX"
// El seed no duplica — si ya hay N registros marcados, crea solo los que faltan.
//
// Uso: npx tsx app/scripts/seed-sprint7.ts
// Limpieza: npx tsx app/scripts/clean-all.ts

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

// Pools demo (datos ficticios, NO de negocio)
const NOMBRES_PERSONAS = [
  "María", "Carmen", "Ana", "Laura", "Isabel", "Paula", "Cristina", "Elena",
  "Sara", "Lucía", "Marta", "Patricia", "Sofía", "Beatriz", "Raquel", "Claudia",
  "Carlos", "Javier", "David", "José", "Antonio", "Manuel", "Francisco", "Alberto",
  "Pablo", "Sergio", "Rubén", "Jorge", "Álvaro", "Daniel", "Adrián", "Roberto",
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
  { nombre: "Ortodoncia Invisalign", importeMin: 2800, importeMax: 4500 },
  { nombre: "Ortodoncia brackets", importeMin: 1800, importeMax: 3000 },
  { nombre: "Implante dental unitario", importeMin: 900, importeMax: 1500 },
  { nombre: "Implante + corona zirconio", importeMin: 1400, importeMax: 2100 },
  { nombre: "Endodoncia molar", importeMin: 300, importeMax: 550 },
  { nombre: "Empaste compuesto", importeMin: 80, importeMax: 180 },
  { nombre: "Limpieza + revisión", importeMin: 60, importeMax: 120 },
  { nombre: "Blanqueamiento dental", importeMin: 350, importeMax: 700 },
  { nombre: "Carillas porcelana (x6)", importeMin: 2400, importeMax: 4200 },
  { nombre: "Extracción muela juicio", importeMin: 150, importeMax: 350 },
  { nombre: "Corona porcelana", importeMin: 450, importeMax: 750 },
  { nombre: "Puente de 3 piezas", importeMin: 1200, importeMax: 1900 },
  { nombre: "Férula descarga", importeMin: 200, importeMax: 380 },
  { nombre: "Periodoncia profunda", importeMin: 400, importeMax: 800 },
  { nombre: "Prótesis removible", importeMin: 650, importeMax: 1100 },
];

const ORIGENES: Array<"google_ads" | "seo_organico" | "referido_paciente" | "redes_sociales" | "walk_in" | "otro"> = [
  "google_ads", "seo_organico", "referido_paciente", "redes_sociales", "walk_in", "otro",
];

const TIPO_PACIENTE = ["Privado", "Adeslas"] as const;
const TIPO_VISITA = ["Primera Visita", "Paciente con Historia"] as const;
const CANAL_PREFERIDO = ["Whatsapp", "SMS", "Call"] as const;

// Textos de conversaciones WhatsApp típicas (input y respuesta alternadas)
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

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
function randPhone(): string {
  return `+346${randInt(10000000, 99999999)}`;
}
function randPin4(): string {
  return String(randInt(1000, 9999));
}
function randPin6(): string {
  return String(randInt(100000, 999999));
}
function randFullName(): string {
  return `${randChoice(NOMBRES_PERSONAS)} ${randChoice(APELLIDOS)} ${randChoice(APELLIDOS)}`;
}
function daysAgo(d: number): Date {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t;
}
function toIsoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toIsoDateTime(d: Date): string {
  return d.toISOString();
}
function pad4(n: number): string {
  return String(n).padStart(4, "0");
}
function escapeFormula(value: string): string {
  return value.replace(/'/g, "\\'");
}
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

async function upsertClinicas(): Promise<Map<string, { id: string; nombre: string }>> {
  console.log("\n[1/7] Clínicas");
  const existing = await fetchAll(base(TABLES.clinics).select({}));
  const byNombre = new Map<string, any>(
    existing.map((r) => [String(r.fields?.["Nombre"] ?? ""), r])
  );
  const out = new Map<string, { id: string; nombre: string }>();
  const toCreate: Array<{ fields: Record<string, any> }> = [];

  for (const c of CLINICAS) {
    const rec = byNombre.get(c.nombre);
    if (rec) {
      const patch: Record<string, any> = {};
      if (!rec.fields?.["Activa"]) patch["Activa"] = true;
      if (!rec.fields?.["Ciudad"]) patch["Ciudad"] = c.ciudad;
      if (Object.keys(patch).length) {
        await base(TABLES.clinics).update([{ id: rec.id, fields: patch }]);
      }
      out.set(c.nombre, { id: rec.id, nombre: c.nombre });
      console.log(`  ✔ ${c.nombre} (existente)`);
    } else {
      toCreate.push({ fields: { Nombre: c.nombre, Ciudad: c.ciudad, Activa: true } });
    }
  }
  if (toCreate.length) {
    const created = await chunkedCreate(TABLES.clinics, toCreate);
    for (const rec of created) {
      const nombre = String(rec.fields?.["Nombre"] ?? "");
      out.set(nombre, { id: rec.id, nombre });
      console.log(`  ✔ ${nombre} (creada)`);
    }
  }

  // Desactiva cualquier clínica existente que no esté en la lista demo.
  // No las borramos (podrían ser referenciadas por env vars legacy, ej.
  // DEMO_CLINIC_RECORD_ID). Solo `Activa=false` para que no aparezcan en /login.
  const demoNombres = new Set(CLINICAS.map((c) => c.nombre));
  const toDeactivate = existing.filter(
    (r) => !demoNombres.has(String(r.fields?.["Nombre"] ?? "")) && r.fields?.["Activa"]
  );
  if (toDeactivate.length) {
    for (let i = 0; i < toDeactivate.length; i += 10) {
      const slice = toDeactivate.slice(i, i + 10).map((r) => ({
        id: r.id,
        fields: { Activa: false },
      }));
      await base(TABLES.clinics).update(slice);
    }
    console.log(`  ↓ ${toDeactivate.length} clínica(s) fuera de la lista demo desactivadas`);
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 2) ADMIN + COORDINACIONES
// ═══════════════════════════════════════════════════════════════════════

type UsuariosSeeded = {
  admin: { id: string; pin: string };
  coordinaciones: Array<{ id: string; nombre: string; clinicaId: string; pin: string }>;
};

async function upsertUsuarios(
  clinicas: Map<string, { id: string; nombre: string }>
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
      // Migración v5: admin existente sin Pin_length=6 → regenera PIN 6 y pisa.
      const pin = randPin6();
      const pinHash = await hashPin(pin);
      await base(TABLES.usuarios).update([
        {
          id: rec.id,
          fields: { Pin_hash: pinHash, Pin_length: 6, Password_hash: "" },
        },
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
        {
          fields: {
            Nombre: DEMO_ADMIN_NOMBRE,
            Pin_hash: pinHash,
            Pin_length: 6,
            Rol: "admin",
            Activo: true,
          },
        },
      ])
    )[0]!;
    admin = { id: created.id, pin };
    console.log(`  ✔ admin ${DEMO_ADMIN_NOMBRE} (creado)`);
  }

  // COORDINACIONES (1 por clínica)
  const coords: UsuariosSeeded["coordinaciones"] = [];
  for (const [nombreClinica, cli] of clinicas) {
    const nombreCoord = `Coordinación ${nombreClinica}`;
    const existing = await base(TABLES.usuarios)
      .select({
        filterByFormula: `AND({Nombre}='${escapeFormula(nombreCoord)}', {Rol}='coordinacion')`,
        maxRecords: 1,
      })
      .firstPage();

    if (existing.length) {
      const rec = existing[0]!;
      // Asegura Pin_length=4 en coords (v4/v5 migración)
      if (rec.fields?.["Pin_length"] !== 4) {
        await base(TABLES.usuarios).update([{ id: rec.id, fields: { Pin_length: 4 } }]);
      }
      coords.push({
        id: rec.id,
        nombre: nombreCoord,
        clinicaId: cli.id,
        pin: "(existente — PIN previo)",
      });
      console.log(`  ✔ ${nombreCoord} (existente)`);
    } else {
      const pin = randPin4();
      const pinHash = await hashPin(pin);
      const created = (
        await base(TABLES.usuarios).create([
          {
            fields: {
              Nombre: nombreCoord,
              Pin_hash: pinHash,
              Pin_length: 4,
              Rol: "coordinacion",
              Activo: true,
            },
          },
        ])
      )[0]!;
      coords.push({ id: created.id, nombre: nombreCoord, clinicaId: cli.id, pin });
      console.log(`  ✔ ${nombreCoord} (creado)`);
    }
  }

  // VÍNCULOS coord→clinica
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
// 3) DOCTORES (Staff rol Dentista)
// ═══════════════════════════════════════════════════════════════════════

const DOCTORES_TARGET = 22;

async function upsertDoctores(
  clinicas: Array<{ id: string; nombre: string }>
): Promise<Array<{ id: string; nombre: string; especialidad: string; clinicaId: string }>> {
  console.log("\n[3/7] Doctores (Staff)");
  const existing = await fetchAll(
    base(TABLES.staff).select({ filterByFormula: "{Rol}='Dentista'" })
  );
  const out: Array<{ id: string; nombre: string; especialidad: string; clinicaId: string }> = [];
  const seen = new Set<string>();
  for (const r of existing) {
    const nombre = String(r.fields?.["Nombre"] ?? "");
    const clis = (r.fields?.["Clínica"] ?? []) as string[];
    if (clis[0]) {
      out.push({
        id: r.id,
        nombre,
        especialidad: "General",
        clinicaId: clis[0],
      });
      seen.add(`${nombre}|${clis[0]}`);
    }
  }
  const needed = Math.max(0, DOCTORES_TARGET - out.length);
  console.log(`  Ya hay ${out.length} doctores. Necesito ${needed} más.`);

  const toCreate: Array<{ fields: Record<string, any> }> = [];
  while (toCreate.length < needed) {
    const clinica = randChoice(clinicas);
    const nombre = `Dr. ${randFullName()}`;
    const combo = `${nombre}|${clinica.id}`;
    if (seen.has(combo)) continue;
    seen.add(combo);
    toCreate.push({
      fields: {
        Nombre: nombre,
        Clínica: [clinica.id],
        Rol: "Dentista",
        Activo: true,
        "Horario laboral": "08:30-19:00",
      },
    });
  }
  if (toCreate.length) {
    const created = await chunkedCreate(TABLES.staff, toCreate);
    for (const r of created) {
      const nombre = String(r.fields?.["Nombre"] ?? "");
      const clis = (r.fields?.["Clínica"] ?? []) as string[];
      out.push({ id: r.id, nombre, especialidad: "General", clinicaId: clis[0]! });
    }
    console.log(`  ✔ ${toCreate.length} doctores creados`);
  }

  // Asigna especialidad "virtual" para presupuestos (Staff no tiene ese campo)
  for (let i = 0; i < out.length; i++) {
    out[i]!.especialidad = ESPECIALIDADES[i % ESPECIALIDADES.length]!;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 4) PACIENTES
// ═══════════════════════════════════════════════════════════════════════

const PACIENTES_TARGET = 50;
const PACIENTES_MARK = "[SEED]";

async function upsertPacientes(
  clinicas: Array<{ id: string; nombre: string }>
): Promise<Array<{ id: string; nombre: string; telefono: string; clinicaId: string }>> {
  console.log("\n[4/7] Pacientes");
  const existing = await fetchAll(
    base(TABLES.patients).select({ filterByFormula: `FIND('${PACIENTES_MARK}', {Notas}&'')` })
  );
  const out: Array<{ id: string; nombre: string; telefono: string; clinicaId: string }> = [];
  for (const r of existing) {
    const clis = (r.fields?.["Clínica"] ?? []) as string[];
    if (clis[0]) {
      out.push({
        id: r.id,
        nombre: String(r.fields?.["Nombre"] ?? ""),
        telefono: String(r.fields?.["Teléfono"] ?? ""),
        clinicaId: clis[0],
      });
    }
  }
  const needed = Math.max(0, PACIENTES_TARGET - out.length);
  console.log(`  Ya hay ${out.length} pacientes [SEED]. Necesito ${needed} más.`);

  const toCreate: Array<{ fields: Record<string, any> }> = [];
  for (let i = 0; i < needed; i++) {
    const clinica = randChoice(clinicas);
    const nombre = randFullName();
    const tel = randPhone();
    toCreate.push({
      fields: {
        Nombre: nombre,
        Clínica: [clinica.id],
        "Teléfono": tel,
        "Canal preferido": randChoice(CANAL_PREFERIDO),
        "Consentimiento Whatsapp": Math.random() > 0.25,
        "Consentimiento SMS": Math.random() > 0.5,
        Activo: Math.random() > 0.1, // 90% activos
        Notas: `${PACIENTES_MARK} Paciente demo para piloto R2b`,
      },
    });
  }
  if (toCreate.length) {
    const created = await chunkedCreate(TABLES.patients, toCreate);
    for (const r of created) {
      const clis = (r.fields?.["Clínica"] ?? []) as string[];
      out.push({
        id: r.id,
        nombre: String(r.fields?.["Nombre"] ?? ""),
        telefono: String(r.fields?.["Teléfono"] ?? ""),
        clinicaId: clis[0]!,
      });
    }
    console.log(`  ✔ ${toCreate.length} pacientes creados`);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 5) PRESUPUESTOS (leads recientes + históricos)
// ═══════════════════════════════════════════════════════════════════════

const LEADS_TARGET = 90;           // leads activos (últimos 30 días)
const PRESUPUESTOS_TARGET = 180;   // históricos (últimos 6 meses)
const PRESUPUESTO_PREFIX = "SEED_P_";

// Estados "kanban activo" para los leads recientes (sin PERDIDO)
const ESTADOS_LEAD: EstadoPresupuesto[] = ["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION", "ACEPTADO"];

async function upsertPresupuestos(
  clinicas: Map<string, { id: string; nombre: string }>,
  pacientes: Array<{ id: string; nombre: string; telefono: string; clinicaId: string }>,
  doctores: Array<{ id: string; nombre: string; especialidad: string; clinicaId: string }>
): Promise<string[]> {
  console.log("\n[5/7] Presupuestos (leads + históricos)");
  if (!pacientes.length || !doctores.length) {
    console.log("  ! Sin pacientes o doctores — saltando presupuestos.");
    return [];
  }
  const clinicaNombreById = new Map<string, string>();
  for (const [, c] of clinicas) clinicaNombreById.set(c.id, c.nombre);

  const existing = await fetchAll(
    base(TABLES.presupuestos).select({ filterByFormula: `FIND('${PRESUPUESTO_PREFIX}', {Presupuesto ID}&'')` })
  );
  const existingIds = new Set<string>(
    existing.map((r) => String(r.fields?.["Presupuesto ID"] ?? ""))
  );
  const existingRecIds = existing.map((r) => r.id);

  const target = LEADS_TARGET + PRESUPUESTOS_TARGET;
  const needed = Math.max(0, target - existingIds.size);
  console.log(`  Ya hay ${existingIds.size} presupuestos SEED. Necesito ${needed} más.`);

  const toCreate: Array<{ fields: Record<string, any> }> = [];
  const nextSeq = (() => {
    let n = 1;
    while (existingIds.has(`${PRESUPUESTO_PREFIX}${pad4(n)}`)) n++;
    return n;
  })();

  for (let i = 0; i < needed; i++) {
    const isLead = i < LEADS_TARGET - (LEADS_TARGET * existingIds.size) / target;
    // Distribución simple: primero leads, luego históricos.
    const actuallyLead = i < Math.max(0, LEADS_TARGET - Math.min(existingIds.size, LEADS_TARGET));

    const seq = nextSeq + i;
    const id = `${PRESUPUESTO_PREFIX}${pad4(seq)}`;
    const paciente = randChoice(pacientes);
    // Doctor de la misma clínica si es posible
    const docsDeClinica = doctores.filter((d) => d.clinicaId === paciente.clinicaId);
    const doctor = docsDeClinica.length ? randChoice(docsDeClinica) : randChoice(doctores);
    const trat = randChoice(TRATAMIENTOS);
    const importe = randInt(trat.importeMin, trat.importeMax);
    const estado: EstadoPresupuesto = actuallyLead
      ? randChoice(ESTADOS_LEAD)
      : randChoice(ESTADOS);
    const fechaDate = actuallyLead ? daysAgo(randInt(0, 30)) : daysAgo(randInt(31, 180));

    const fields: Record<string, any> = {
      "Presupuesto ID": id,
      Paciente: [paciente.id],
      Tratamiento_nombre: trat.nombre,
      Importe: importe,
      Estado: estado,
      Fecha: toIsoDateOnly(fechaDate),
      FechaAlta: toIsoDateOnly(fechaDate),
      Doctor: doctor.nombre,
      Doctor_Especialidad: doctor.especialidad,
      Clinica: clinicaNombreById.get(paciente.clinicaId) ?? "",
      TipoPaciente: randChoice(TIPO_PACIENTE),
      TipoVisita: randChoice(TIPO_VISITA),
      ContactCount: randInt(0, 5),
      CreadoPor: actuallyLead ? "IA" : "Recepción",
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

  const createdIds: string[] = [...existingRecIds];
  if (toCreate.length) {
    const created = await chunkedCreate(TABLES.presupuestos, toCreate);
    for (const r of created) createdIds.push(r.id);
    console.log(`  ✔ ${toCreate.length} presupuestos creados`);
  }
  return createdIds;
}

// ═══════════════════════════════════════════════════════════════════════
// 6) MENSAJES WHATSAPP (conversaciones realistas)
// ═══════════════════════════════════════════════════════════════════════

const MENSAJES_TARGET = 250;
const MENSAJE_PREFIX = "SEED_M_";

async function upsertMensajes(
  presupuestosRecIds: string[],
  clinicas: Map<string, { id: string; nombre: string }>,
  pacientes: Array<{ id: string; nombre: string; telefono: string; clinicaId: string }>
): Promise<number> {
  console.log("\n[6/7] Mensajes WhatsApp");
  if (!presupuestosRecIds.length) {
    console.log("  ! Sin presupuestos — saltando mensajes.");
    return 0;
  }
  const clinicaNombreById = new Map<string, string>();
  for (const [, c] of clinicas) clinicaNombreById.set(c.id, c.nombre);

  const existing = await fetchAll(
    base(TABLES.mensajesWhatsApp).select({
      filterByFormula: `FIND('${MENSAJE_PREFIX}', {WABA_message_id}&'')`,
    })
  );
  const existingIds = new Set<string>(
    existing.map((r) => String(r.fields?.["WABA_message_id"] ?? ""))
  );
  const needed = Math.max(0, MENSAJES_TARGET - existingIds.size);
  console.log(`  Ya hay ${existingIds.size} mensajes SEED. Necesito ${needed} más.`);

  const toCreate: Array<{ fields: Record<string, any> }> = [];
  const nextSeq = (() => {
    let n = 1;
    while (existingIds.has(`${MENSAJE_PREFIX}${pad4(n)}`)) n++;
    return n;
  })();

  const pacienteById = new Map(pacientes.map((p) => [p.id, p]));

  // Cargar info mínima de los presupuestos existentes para poblar mensajes
  const presupuestos = await fetchAll(
    base(TABLES.presupuestos).select({
      filterByFormula: `FIND('${PRESUPUESTO_PREFIX}', {Presupuesto ID}&'')`,
    })
  );

  let seqOffset = 0;
  while (toCreate.length < needed) {
    const presup = randChoice(presupuestos);
    const presupId = presup.id;
    const pacLinks = (presup.fields?.["Paciente"] ?? []) as string[];
    const paciente = pacLinks[0] ? pacienteById.get(pacLinks[0]) : undefined;
    if (!paciente) continue;

    const clinicaNombre = clinicaNombreById.get(paciente.clinicaId) ?? "clínica";
    const tratNombre = String(presup.fields?.["Tratamiento_nombre"] ?? "tratamiento");
    const importe = Number(presup.fields?.["Importe"] ?? 0);
    const tpl = randChoice(CONV_TEMPLATES);

    // Base timestamp de la conversación: fecha del presupuesto + offset días
    const fechaBase = presup.fields?.["Fecha"]
      ? new Date(String(presup.fields["Fecha"]))
      : daysAgo(randInt(1, 60));

    for (let m = 0; m < tpl.length && toCreate.length < needed; m++) {
      const msg = tpl[m]!;
      const seq = nextSeq + seqOffset++;
      const ts = new Date(fechaBase);
      ts.setHours(ts.getHours() + m * randInt(1, 18));

      const texto = msg.text
        .replace("{nombre}", paciente.nombre.split(" ")[0] ?? "")
        .replace("{clinica}", clinicaNombre)
        .replace("{tratamiento}", tratNombre)
        .replace("{importe}", String(importe));

      toCreate.push({
        fields: {
          Paciente: paciente.nombre,
          Presupuesto: presupId,
          Telefono: paciente.telefono,
          Direccion: msg.dir,
          Contenido: texto,
          Timestamp: toIsoDateTime(ts),
          Fuente: msg.dir === "Saliente" ? "Modo_B_WABA" : "Modo_A_manual",
          Procesado_por_IA: Math.random() > 0.3,
          WABA_message_id: `${MENSAJE_PREFIX}${pad4(seq)}`,
        },
      });
    }
  }
  if (toCreate.length) {
    await chunkedCreate(TABLES.mensajesWhatsApp, toCreate);
    console.log(`  ✔ ${toCreate.length} mensajes creados`);
  }
  return toCreate.length;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log("Sprint 7 seed (v5) — inicio");
  console.log("ENV BASE?", !!process.env.AIRTABLE_BASE_ID, "KEY?", !!process.env.AIRTABLE_API_KEY);
  if (!process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_API_KEY) {
    throw new Error("Faltan AIRTABLE_BASE_ID / AIRTABLE_API_KEY en .env.local");
  }

  const clinicas = await upsertClinicas();
  const usuarios = await upsertUsuarios(clinicas);
  const clinicasArr = Array.from(clinicas.values());
  const doctores = await upsertDoctores(clinicasArr);
  const pacientes = await upsertPacientes(clinicasArr);
  const presupuestosIds = await upsertPresupuestos(clinicas, pacientes, doctores);
  const nMensajes = await upsertMensajes(presupuestosIds, clinicas, pacientes);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("✅ SEED SPRINT 7 COMPLETO");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Clínicas:        ${clinicasArr.length}`);
  console.log(`Admin:           ${DEMO_ADMIN_NOMBRE} — PIN ${usuarios.admin.pin}`);
  console.log(`Coordinaciones:  ${usuarios.coordinaciones.length}`);
  console.log(`Doctores:        ${doctores.length}`);
  console.log(`Pacientes:       ${pacientes.length}`);
  console.log(`Presupuestos:    ${presupuestosIds.length}`);
  console.log(`Mensajes:        ${nMensajes} creados esta corrida`);
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
