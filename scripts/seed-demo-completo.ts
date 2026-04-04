/**
 * scripts/seed-demo-completo.ts
 * Seed completo y realista para demo:
 *   - ~950 presupuestos en 10 clínicas
 *   - Objetivos mensuales para el mes actual
 *   - 10 secuencias de automatización pendientes
 *
 * Uso:
 *   npx tsx scripts/seed-demo-completo.ts
 *
 * Limpia previamente todos los registros seed (Notas contiene "[SEED").
 */

import Airtable from "airtable";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eqIdx = t.indexOf("=");
    if (eqIdx < 0) continue;
    const k = t.slice(0, eqIdx).trim();
    const v = t.slice(eqIdx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

const SEED_TAG = "[SEED_DEMO]";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type Estado = "PRESENTADO" | "INTERESADO" | "EN_DUDA" | "EN_NEGOCIACION" | "ACEPTADO" | "PERDIDO";
type Tier = "estrella" | "medio" | "bajo";

interface DoctorDef {
  nombre: string;
  especialidad: string;
  tier: Tier;
}

// ── Datos estáticos ────────────────────────────────────────────────────────────

const CLINICA_TARGETS: [string, number][] = [
  ["Clínica Madrid Centro",      180],
  ["Clínica Madrid Norte",       120],
  ["Clínica Madrid Sur",         100],
  ["Clínica Salamanca",           80],
  ["Clínica Barcelona Eixample", 150],
  ["Clínica Barcelona Gràcia",    90],
  ["Clínica Valencia Centro",    100],
  ["Clínica Sevilla",             70],
  ["Clínica Bilbao",              60],
  ["Clínica Málaga",              50],
];

// Objetivos mes actual — distribuidos para mostrar variedad en Command Center
// verde: ~85% completado, naranja: ~50%, rojo: ~15%
const OBJETIVOS_MES: [string, number][] = [
  ["Clínica Madrid Centro",      45],
  ["Clínica Madrid Norte",       30],
  ["Clínica Madrid Sur",         25],
  ["Clínica Salamanca",          20],
  ["Clínica Barcelona Eixample", 38],
  ["Clínica Barcelona Gràcia",   22],
  ["Clínica Valencia Centro",    25],
  ["Clínica Sevilla",            18],
  ["Clínica Bilbao",             15],
  ["Clínica Málaga",             12],
];

// Semáforo Command Center: qué % del objetivo tiene la clínica en el mes actual
// verde: 0.75+, naranja: 0.35-0.74, rojo: <0.35
const CLINICA_COMPLETADO_PCT: Record<string, number> = {
  "Clínica Madrid Centro":      0.87,
  "Clínica Barcelona Eixample": 0.90,
  "Clínica Sevilla":            0.78,
  "Clínica Madrid Norte":       0.52,
  "Clínica Madrid Sur":         0.48,
  "Clínica Valencia Centro":    0.44,
  "Clínica Bilbao":             0.50,
  "Clínica Salamanca":          0.18,
  "Clínica Barcelona Gràcia":   0.22,
  "Clínica Málaga":             0.14,
};

const DOCTORES_POR_CLINICA: Record<string, DoctorDef[]> = {
  "Clínica Madrid Centro": [
    { nombre: "Dr. Alejandro García",    especialidad: "Implantólogo",   tier: "estrella" },
    { nombre: "Dra. Carmen Martínez",    especialidad: "Ortodoncia",     tier: "medio" },
    { nombre: "Dr. Pablo López",         especialidad: "General",        tier: "medio" },
    { nombre: "Dra. Isabel Sánchez",     especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dr. Marcos Fernández",    especialidad: "Prostodoncista", tier: "bajo" },
  ],
  "Clínica Madrid Norte": [
    { nombre: "Dra. Lucía Torres",       especialidad: "Ortodoncia",     tier: "estrella" },
    { nombre: "Dr. Miguel Ruiz",         especialidad: "Implantólogo",   tier: "medio" },
    { nombre: "Dra. Ana González",       especialidad: "General",        tier: "medio" },
    { nombre: "Dr. Javier Moreno",       especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dra. Sara Díaz",          especialidad: "General",        tier: "bajo" },
  ],
  "Clínica Madrid Sur": [
    { nombre: "Dr. Roberto Navarro",     especialidad: "Implantólogo",   tier: "estrella" },
    { nombre: "Dra. Marta Jiménez",      especialidad: "Ortodoncia",     tier: "medio" },
    { nombre: "Dr. Víctor Romero",       especialidad: "General",        tier: "medio" },
    { nombre: "Dra. Elena Vega",         especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dr. Daniel Castro",       especialidad: "Prostodoncista", tier: "bajo" },
  ],
  "Clínica Salamanca": [
    { nombre: "Dra. Patricia Blanco",    especialidad: "Ortodoncia",     tier: "estrella" },
    { nombre: "Dr. Sergio Molina",       especialidad: "Implantólogo",   tier: "medio" },
    { nombre: "Dra. Cristina Ortega",    especialidad: "General",        tier: "medio" },
    { nombre: "Dr. Alberto Ramírez",     especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dra. Laura Serrano",      especialidad: "General",        tier: "bajo" },
  ],
  "Clínica Barcelona Eixample": [
    { nombre: "Dr. Adrián Vargas",       especialidad: "Implantólogo",   tier: "estrella" },
    { nombre: "Dra. Nuria Delgado",      especialidad: "Ortodoncia",     tier: "medio" },
    { nombre: "Dr. Andrés Méndez",       especialidad: "General",        tier: "medio" },
    { nombre: "Dra. Silvia Ibáñez",      especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dr. Óscar Ramos",         especialidad: "Prostodoncista", tier: "bajo" },
  ],
  "Clínica Barcelona Gràcia": [
    { nombre: "Dra. Irene Pascual",      especialidad: "Ortodoncia",     tier: "estrella" },
    { nombre: "Dr. Francisco Gil",       especialidad: "Implantólogo",   tier: "medio" },
    { nombre: "Dra. Rosa Herrero",       especialidad: "General",        tier: "medio" },
    { nombre: "Dr. Enrique Santos",      especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dra. Pilar Guerrero",     especialidad: "General",        tier: "bajo" },
  ],
  "Clínica Valencia Centro": [
    { nombre: "Dr. Fernando Peña",       especialidad: "Implantólogo",   tier: "estrella" },
    { nombre: "Dra. María Cano",         especialidad: "Ortodoncia",     tier: "medio" },
    { nombre: "Dr. Raúl Lozano",         especialidad: "General",        tier: "medio" },
    { nombre: "Dra. Sofía Medina",       especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dr. José Campos",         especialidad: "Prostodoncista", tier: "bajo" },
  ],
  "Clínica Sevilla": [
    { nombre: "Dra. Beatriz Alonso",     especialidad: "Ortodoncia",     tier: "estrella" },
    { nombre: "Dr. Manuel Flores",       especialidad: "Implantólogo",   tier: "medio" },
    { nombre: "Dra. Teresa Ríos",        especialidad: "General",        tier: "medio" },
    { nombre: "Dr. Carlos Aguilar",      especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dra. Esperanza Fuentes",  especialidad: "General",        tier: "bajo" },
  ],
  "Clínica Bilbao": [
    { nombre: "Dr. Ignacio Prieto",      especialidad: "Implantólogo",   tier: "estrella" },
    { nombre: "Dra. Verónica Cabrera",   especialidad: "Ortodoncia",     tier: "medio" },
    { nombre: "Dr. Álvaro Cortés",       especialidad: "General",        tier: "medio" },
    { nombre: "Dra. Natalia Reyes",      especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dr. Hugo Espinosa",       especialidad: "General",        tier: "bajo" },
  ],
  "Clínica Málaga": [
    { nombre: "Dra. Claudia Benítez",    especialidad: "Ortodoncia",     tier: "estrella" },
    { nombre: "Dr. Salvador León",       especialidad: "Implantólogo",   tier: "medio" },
    { nombre: "Dra. Amparo Suárez",      especialidad: "General",        tier: "medio" },
    { nombre: "Dr. Emilio Nieto",        especialidad: "Endodoncista",   tier: "bajo" },
    { nombre: "Dra. Alicia Herrera",     especialidad: "Prostodoncista", tier: "bajo" },
  ],
};

// Tratamientos con pesos y rangos de precio
const TRATAMIENTOS: { nombre: string; peso: number; min: number; max: number }[] = [
  { nombre: "Ortodoncia invisible",   peso: 20, min: 3500, max: 5500 },
  { nombre: "Implante dental",        peso: 18, min: 2000, max: 4000 },
  { nombre: "Revisión y limpieza",    peso: 15, min: 80,   max: 150  },
  { nombre: "Carillas de porcelana",  peso: 10, min: 3000, max: 5000 },
  { nombre: "Blanqueamiento dental",  peso: 8,  min: 300,  max: 600  },
  { nombre: "Endodoncia",             peso: 8,  min: 500,  max: 1200 },
  { nombre: "Ortodoncia brackets",    peso: 7,  min: 2500, max: 4000 },
  { nombre: "Corona cerámica",        peso: 6,  min: 800,  max: 1500 },
  { nombre: "Prótesis removible",     peso: 5,  min: 1200, max: 2500 },
  { nombre: "Periodoncia",            peso: 3,  min: 400,  max: 800  },
];
const TRAT_ACUM = (() => {
  let acc = 0;
  return TRATAMIENTOS.map((t) => { acc += t.peso; return acc; });
})();
const TRAT_TOTAL = TRAT_ACUM[TRAT_ACUM.length - 1];

// Orígenes con pesos
const ORIGENES: { v: string; peso: number }[] = [
  { v: "seo_organico",        peso: 25 },
  { v: "redes_sociales",      peso: 22 },
  { v: "referido_paciente",   peso: 20 },
  { v: "walk_in",             peso: 15 },
  { v: "google_ads",          peso: 12 },
  { v: "otro",                peso: 6  },
];
const ORIGEN_ACUM = (() => {
  let acc = 0;
  return ORIGENES.map((o) => { acc += o.peso; return acc; });
})();
const ORIGEN_TOTAL = ORIGEN_ACUM[ORIGEN_ACUM.length - 1];

const MOTIVOS_PERDIDA: { v: string; peso: number }[] = [
  { v: "precio_alto",   peso: 30 },
  { v: "sin_urgencia",  peso: 28 },
  { v: "otra_clinica",  peso: 18 },
  { v: "no_responde",   peso: 14 },
  { v: "otro",          peso: 10 },
];
const MPERD_ACUM = (() => { let acc = 0; return MOTIVOS_PERDIDA.map((m) => { acc += m.peso; return acc; }); })();
const MPERD_TOTAL = MPERD_ACUM[MPERD_ACUM.length - 1];

const MOTIVOS_DUDA = ["precio", "otra_clinica", "sin_urgencia", "financiacion", "miedo", "comparando_opciones", "otro"] as const;

const MOTIVOS_PERDIDA_TEXTO: Record<string, string> = {
  precio_alto:   "El paciente comentó que el presupuesto estaba fuera de su rango",
  sin_urgencia:  "Dice que lo pospondrá para más adelante, sin fecha concreta",
  otra_clinica:  "Decidió atenderse en otra clínica más cercana a su domicilio",
  no_responde:   "Tres intentos de contacto sin respuesta en 15 días",
  otro:          "Motivo no especificado por el paciente",
};

const NOTAS_POOL = [
  "Muy interesado, pendiente de confirmar financiación",
  "Quiere comparar con otra clínica antes de decidir",
  "Referido por un paciente satisfecho de la clínica",
  "Tiene boda en 3 meses, muy motivado",
  "Solicita pago fraccionado sin intereses",
  "Primera visita muy positiva, pidió tiempo para pensarlo",
  "Lleva meses con dolor, tiene urgencia real",
  "Habló con la encargada, quedó muy satisfecha de la explicación",
  "Le enviamos el presupuesto por email, pendiente de respuesta",
  "Tiene miedo al dentista pero quiere superarlo",
  "Paciente de toda la vida, quiere renovar el trabajo anterior",
  "Preguntó por opciones de seguro dental",
  "Habló con su pareja, a la espera de consenso familiar",
  "Presupuesto competitivo según él mismo comparó online",
];

// Pool de pacientes demo (80 nombres)
const PACIENTES_DEMO: { nombre: string; telefono: string }[] = [
  { nombre: "María García López",           telefono: "+34 612 111 001" },
  { nombre: "José Martínez Fernández",      telefono: "+34 612 111 002" },
  { nombre: "Carmen Rodríguez Sánchez",     telefono: "+34 612 111 003" },
  { nombre: "Antonio González Pérez",       telefono: "+34 612 111 004" },
  { nombre: "Isabel López Martínez",        telefono: "+34 612 111 005" },
  { nombre: "Manuel Sánchez Torres",        telefono: "+34 612 111 006" },
  { nombre: "Dolores Fernández Ruiz",       telefono: "+34 612 111 007" },
  { nombre: "Francisco García García",      telefono: "+34 612 111 008" },
  { nombre: "Pilar Martínez González",      telefono: "+34 612 111 009" },
  { nombre: "Juan López Rodríguez",         telefono: "+34 612 111 010" },
  { nombre: "Ana Sánchez López",            telefono: "+34 612 111 011" },
  { nombre: "Luis González Martínez",       telefono: "+34 612 111 012" },
  { nombre: "Rosa Pérez Fernández",         telefono: "+34 612 111 013" },
  { nombre: "Carlos Fernández García",      telefono: "+34 612 111 014" },
  { nombre: "Elena García Rodríguez",       telefono: "+34 612 111 015" },
  { nombre: "Miguel Martínez López",        telefono: "+34 612 111 016" },
  { nombre: "Teresa López Sánchez",         telefono: "+34 612 111 017" },
  { nombre: "Pedro González Torres",        telefono: "+34 612 111 018" },
  { nombre: "Laura Sánchez Ruiz",           telefono: "+34 612 111 019" },
  { nombre: "Rafael Fernández López",       telefono: "+34 612 111 020" },
  { nombre: "Concepción García Martínez",   telefono: "+34 612 111 021" },
  { nombre: "Julio Martínez Pérez",         telefono: "+34 612 111 022" },
  { nombre: "Rocío López González",         telefono: "+34 612 111 023" },
  { nombre: "Alberto Sánchez García",       telefono: "+34 612 111 024" },
  { nombre: "Marta González López",         telefono: "+34 612 111 025" },
  { nombre: "Enrique Pérez Martínez",       telefono: "+34 612 111 026" },
  { nombre: "Beatriz Fernández Torres",     telefono: "+34 612 111 027" },
  { nombre: "Fernando García Sánchez",      telefono: "+34 612 111 028" },
  { nombre: "Cristina Martínez Ruiz",       telefono: "+34 612 111 029" },
  { nombre: "Diego López Pérez",            telefono: "+34 612 111 030" },
  { nombre: "Patricia González García",     telefono: "+34 612 111 031" },
  { nombre: "Sergio Sánchez Martínez",      telefono: "+34 612 111 032" },
  { nombre: "Natalia Fernández López",      telefono: "+34 612 111 033" },
  { nombre: "Javier García González",       telefono: "+34 612 111 034" },
  { nombre: "Silvia Martínez Sánchez",      telefono: "+34 612 111 035" },
  { nombre: "Pablo López García",           telefono: "+34 612 111 036" },
  { nombre: "Verónica González Pérez",      telefono: "+34 612 111 037" },
  { nombre: "Alejandro Sánchez Fernández",  telefono: "+34 612 111 038" },
  { nombre: "Lucía García López",           telefono: "+34 612 111 039" },
  { nombre: "Roberto Martínez González",    telefono: "+34 612 111 040" },
  { nombre: "Nuria López Martínez",         telefono: "+34 612 111 041" },
  { nombre: "Adrián Fernández Sánchez",     telefono: "+34 612 111 042" },
  { nombre: "Irene García García",          telefono: "+34 612 111 043" },
  { nombre: "Víctor Martínez Pérez",        telefono: "+34 612 111 044" },
  { nombre: "Claudia López González",       telefono: "+34 612 111 045" },
  { nombre: "Daniel Sánchez López",         telefono: "+34 612 111 046" },
  { nombre: "Miriam González Fernández",    telefono: "+34 612 111 047" },
  { nombre: "Samuel García Martínez",       telefono: "+34 612 111 048" },
  { nombre: "Marina López Sánchez",         telefono: "+34 612 111 049" },
  { nombre: "Eduardo Fernández González",   telefono: "+34 612 111 050" },
  { nombre: "Sandra Martínez López",        telefono: "+34 612 111 051" },
  { nombre: "Raúl García Pérez",            telefono: "+34 612 111 052" },
  { nombre: "Alicia Sánchez García",        telefono: "+34 612 111 053" },
  { nombre: "Óscar López Fernández",        telefono: "+34 612 111 054" },
  { nombre: "Vanessa González Martínez",    telefono: "+34 612 111 055" },
  { nombre: "Andrés García Sánchez",        telefono: "+34 612 111 056" },
  { nombre: "Rebeca Martínez García",       telefono: "+34 612 111 057" },
  { nombre: "Tomás López López",            telefono: "+34 612 111 058" },
  { nombre: "Yolanda Fernández Pérez",      telefono: "+34 612 111 059" },
  { nombre: "Ismael Sánchez González",      telefono: "+34 612 111 060" },
  { nombre: "Amparo García Fernández",      telefono: "+34 612 111 061" },
  { nombre: "Lorenzo Martínez Sánchez",     telefono: "+34 612 111 062" },
  { nombre: "Consuelo López García",        telefono: "+34 612 111 063" },
  { nombre: "Guillermo González López",     telefono: "+34 612 111 064" },
  { nombre: "Esperanza Pérez Martínez",     telefono: "+34 612 111 065" },
  { nombre: "Emilio García González",       telefono: "+34 612 111 066" },
  { nombre: "Encarnación Martínez López",   telefono: "+34 612 111 067" },
  { nombre: "Agustín Sánchez Pérez",        telefono: "+34 612 111 068" },
  { nombre: "Remedios López Sánchez",       telefono: "+34 612 111 069" },
  { nombre: "Ernesto González García",      telefono: "+34 612 111 070" },
  { nombre: "Mónica Fernández González",    telefono: "+34 612 111 071" },
  { nombre: "Cecilio García López",         telefono: "+34 612 111 072" },
  { nombre: "Valentina Martínez García",    telefono: "+34 612 111 073" },
  { nombre: "Nicolás Sánchez López",        telefono: "+34 612 111 074" },
  { nombre: "Paloma López Fernández",       telefono: "+34 612 111 075" },
  { nombre: "Héctor González Martínez",     telefono: "+34 612 111 076" },
  { nombre: "Lorena Fernández Sánchez",     telefono: "+34 612 111 077" },
  { nombre: "Augusto García García",        telefono: "+34 612 111 078" },
  { nombre: "Inmaculada Martínez Pérez",    telefono: "+34 612 111 079" },
  { nombre: "Primitivo López González",     telefono: "+34 612 111 080" },
];

// ── RNG determinístico ────────────────────────────────────────────────────────

let seed = 12345;
function rng() {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff;
  return (seed >>> 0) / 0x100000000;
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
function pick<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function weightedPick<T extends { peso: number }>(items: T[], acum: number[], total: number): T {
  const r = rng() * total;
  const idx = acum.findIndex((a) => r < a);
  return items[idx >= 0 ? idx : items.length - 1];
}

// ── Helpers de fecha ──────────────────────────────────────────────────────────

function dateFromToday(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function getMesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Distribución de días atrás: 40% en 0-90d, 30% en 90-180d, 30% en 180-365d
function pickDaysAgo(): number {
  const r = rng();
  if (r < 0.40) return randInt(1,  90);
  if (r < 0.70) return randInt(90, 180);
  return randInt(180, 365);
}

// ── Asignación de estado ──────────────────────────────────────────────────────

function assignEstado(daysAgo: number, tier: Tier, clinica: string, isCurrentMonth: boolean): Estado {
  // Si es del mes actual y la clínica tiene objetivo alto → más ACEPTADO reciente
  if (isCurrentMonth) {
    const pct = CLINICA_COMPLETADO_PCT[clinica] ?? 0.5;
    if (rng() < pct * 0.8) return "ACEPTADO";
    const r = rng();
    if (r < 0.35) return "INTERESADO";
    if (r < 0.65) return "EN_DUDA";
    if (r < 0.80) return "PRESENTADO";
    return "EN_NEGOCIACION";
  }

  // Probabilidad de estar en estado terminal según antigüedad
  const closedProb =
    daysAgo > 270 ? 0.88 :
    daysAgo > 180 ? 0.80 :
    daysAgo > 90  ? 0.68 :
    daysAgo > 45  ? 0.50 :
    daysAgo > 20  ? 0.30 :
    0.12;

  if (rng() < closedProb) {
    // Tasa de aceptación por tier del doctor
    const acceptRate =
      tier === "estrella" ? 0.55 + rng() * 0.10 :
      tier === "medio"    ? 0.25 + rng() * 0.10 :
                            0.08 + rng() * 0.10;
    return rng() < acceptRate ? "ACEPTADO" : "PERDIDO";
  }

  // Estados activos según antigüedad
  const r = rng();
  if (daysAgo > 30) {
    if (r < 0.38) return "EN_DUDA";
    if (r < 0.65) return "INTERESADO";
    if (r < 0.85) return "EN_NEGOCIACION";
    return "PRESENTADO";
  }
  if (r < 0.32) return "EN_DUDA";
  if (r < 0.58) return "INTERESADO";
  if (r < 0.78) return "PRESENTADO";
  return "EN_NEGOCIACION";
}

// ── Helpers Airtable ──────────────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function deleteInBatches(
  tableName: string,
  ids: string[],
  label: string
): Promise<void> {
  if (ids.length === 0) return;
  console.log(`   🗑  Eliminando ${ids.length} registros de ${label}…`);
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    await base(tableName).destroy(batch);
    await sleep(200);
    process.stdout.write(`   ${Math.min(i + 10, ids.length)}/${ids.length}\r`);
  }
  console.log(`   ✅ ${ids.length} eliminados`);
}

// ── 1. Limpieza ───────────────────────────────────────────────────────────────

async function clearPresupuestos(): Promise<void> {
  console.log("\n🧹 Buscando presupuestos seed…");
  const ids: string[] = [];
  await base("Presupuestos")
    .select({
      fields: ["Notas"],
      filterByFormula: `FIND("[SEED", {Notas}) > 0`,
    })
    .eachPage((recs, next) => { ids.push(...recs.map((r) => r.id)); next(); });
  await deleteInBatches("Presupuestos", ids, "Presupuestos");
}

async function clearSecuencias(): Promise<void> {
  console.log("\n🧹 Buscando secuencias seed…");
  const ids: string[] = [];
  await base("Secuencias_Automaticas")
    .select({
      fields: ["mensaje_generado"],
      filterByFormula: `FIND("${SEED_TAG}", {mensaje_generado}) > 0`,
    })
    .eachPage((recs, next) => { ids.push(...recs.map((r) => r.id)); next(); });
  await deleteInBatches("Secuencias_Automaticas", ids, "Secuencias_Automaticas");
}

// ── 2. Cargar / crear pacientes ───────────────────────────────────────────────

async function ensurePacientes(): Promise<{ id: string; nombre: string; telefono: string }[]> {
  console.log("\n👤 Cargando pacientes…");
  const existing: { id: string; nombre: string; telefono: string }[] = [];

  await base("Pacientes")
    .select({ fields: ["Nombre", "Teléfono"] })
    .eachPage((recs, next) => {
      for (const r of recs) {
        existing.push({
          id: r.id,
          nombre: String(r.get("Nombre") ?? ""),
          telefono: String(r.get("Teléfono") ?? ""),
        });
      }
      next();
    });

  if (existing.length >= 40) {
    console.log(`   ✅ ${existing.length} pacientes existentes — reutilizando`);
    return existing;
  }

  // Crear pacientes demo
  const needed = PACIENTES_DEMO.slice(existing.length);
  console.log(`   ℹ  Solo ${existing.length} pacientes. Creando ${needed.length} nuevos…`);

  const created: { id: string; nombre: string; telefono: string }[] = [...existing];
  for (let i = 0; i < needed.length; i += 10) {
    const batch = needed.slice(i, i + 10).map((p) => ({
      fields: { Nombre: p.nombre, "Teléfono": p.telefono },
    }));
    try {
      const recs = await (base("Pacientes") as any).create(batch);
      for (let j = 0; j < recs.length; j++) {
        created.push({ id: recs[j].id, nombre: needed[i + j].nombre, telefono: needed[i + j].telefono });
      }
      process.stdout.write(`   ${Math.min(i + 10, needed.length)}/${needed.length}\r`);
    } catch (err: any) {
      console.warn(`\n   ⚠ No se pudieron crear pacientes (${err.message}). Usando existentes.`);
      return existing.length > 0 ? existing : PACIENTES_DEMO.map((p, idx) => ({ id: `demo-${idx}`, ...p }));
    }
    await sleep(200);
  }
  console.log(`\n   ✅ ${created.length} pacientes disponibles`);
  return created;
}

// ── 3. Crear presupuestos ──────────────────────────────────────────────────────

type PresupuestoRec = {
  pacienteId: string;
  tratamiento: string;
  importe: number;
  estado: Estado;
  fecha: string;
  daysAgo: number;
  doctor: string;
  doctorEspecialidad: string;
  clinica: string;
  tipoPaciente: string;
  tipoVisita: string;
  notas: string;
  origenLead: string;
  motivoPerdida?: string;
  motivoPerdidaTexto?: string;
  motivoDuda?: string;
  contactCount: number;
};

async function createPresupuestos(
  pacientes: { id: string; nombre: string; telefono: string }[]
): Promise<number> {
  console.log("\n📝 Generando presupuestos…");
  const mesActual = getMesActual();
  const records: PresupuestoRec[] = [];

  for (const [clinica, target] of CLINICA_TARGETS) {
    const doctores = DOCTORES_POR_CLINICA[clinica] ?? [];

    for (let i = 0; i < target; i++) {
      const daysAgo = pickDaysAgo();
      const fecha = dateFromToday(daysAgo);
      const isCurrentMonth = fecha.slice(0, 7) === mesActual;

      const doctor = pick(doctores);
      const tratamiento = weightedPick(TRATAMIENTOS, TRAT_ACUM, TRAT_TOTAL);
      const importe = randInt(tratamiento.min, tratamiento.max);
      const estado = assignEstado(daysAgo, doctor.tier, clinica, isCurrentMonth);
      const tipoPaciente = rng() < 0.70 ? "Privado" : "Adeslas";
      const tipoVisita = rng() < 0.55 ? "Primera Visita" : "Paciente con Historia";
      const origenLead = weightedPick(ORIGENES, ORIGEN_ACUM, ORIGEN_TOTAL).v;
      const nota = rng() < 0.45 ? pick(NOTAS_POOL) : "";
      const notas = nota ? `${nota} ${SEED_TAG}` : SEED_TAG;
      const paciente = pacientes[Math.floor(rng() * pacientes.length)];

      let motivoPerdida: string | undefined;
      let motivoPerdidaTexto: string | undefined;
      let motivoDuda: string | undefined;

      if (estado === "PERDIDO") {
        motivoPerdida = weightedPick(MOTIVOS_PERDIDA, MPERD_ACUM, MPERD_TOTAL).v;
        if (rng() < 0.35) motivoPerdidaTexto = MOTIVOS_PERDIDA_TEXTO[motivoPerdida];
      }
      if (estado === "EN_DUDA") {
        motivoDuda = pick(MOTIVOS_DUDA);
      }

      const contactCount =
        estado === "PRESENTADO"      ? 0
        : estado === "INTERESADO"    ? randInt(1, 2)
        : estado === "EN_DUDA"       ? randInt(1, 3)
        : estado === "EN_NEGOCIACION"? randInt(2, 4)
        : estado === "ACEPTADO"      ? randInt(2, 5)
        : randInt(1, 3);

      records.push({
        pacienteId: paciente.id,
        tratamiento: tratamiento.nombre,
        importe,
        estado,
        fecha,
        daysAgo,
        doctor: doctor.nombre,
        doctorEspecialidad: doctor.especialidad,
        clinica,
        tipoPaciente,
        tipoVisita,
        notas,
        origenLead,
        motivoPerdida,
        motivoPerdidaTexto,
        motivoDuda,
        contactCount,
      });
    }
  }

  console.log(`   Total a crear: ${records.length}`);
  let created = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10).map((r) => {
      const fields: Record<string, unknown> = {
        Paciente:            [r.pacienteId],
        Tratamiento_nombre:  r.tratamiento,
        Importe:             r.importe,
        Estado:              r.estado,
        Fecha:               r.fecha,
        FechaAlta:           r.fecha,
        Doctor:              r.doctor,
        Doctor_Especialidad: r.doctorEspecialidad,
        Clinica:             r.clinica,
        TipoPaciente:        r.tipoPaciente,
        TipoVisita:          r.tipoVisita,
        Notas:               r.notas,
        OrigenLead:          r.origenLead,
        ContactCount:        r.contactCount,
      };
      if (r.motivoPerdida)      fields["MotivoPerdida"]      = r.motivoPerdida;
      if (r.motivoPerdidaTexto) fields["MotivoPerdidaTexto"] = r.motivoPerdidaTexto;
      if (r.motivoDuda)         fields["MotivoDuda"]         = r.motivoDuda;
      return { fields };
    });

    try {
      await (base("Presupuestos") as any).create(batch);
      created += batch.length;
      process.stdout.write(`   ${created}/${records.length}\r`);
    } catch (err: any) {
      console.error(`\n   ❌ Error en batch ${i}: ${err.message}`);
      errors += batch.length;
    }
    await sleep(220);
  }

  console.log(`\n   ✅ ${created} presupuestos creados${errors > 0 ? ` (${errors} errores)` : ""}`);
  return created;
}

// ── 4. Crear objetivos mensuales ──────────────────────────────────────────────

async function createObjetivos(): Promise<number> {
  const mes = getMesActual();
  console.log(`\n🎯 Actualizando objetivos para ${mes}…`);
  const now = new Date().toISOString();
  let created = 0;

  for (const [clinica, objetivo] of OBJETIVOS_MES) {
    const existing: { id: string }[] = [];
    await base("Objetivos_Mensuales")
      .select({ filterByFormula: `AND({clinica}="${clinica}",{mes}="${mes}")`, maxRecords: 1, fields: ["clinica"] })
      .eachPage((recs, next) => { existing.push(...recs.map((r) => ({ id: r.id }))); next(); });

    if (existing.length > 0) {
      await base("Objetivos_Mensuales").update(existing[0].id, {
        objetivo_aceptados: objetivo,
        actualizado_en: now,
      });
      process.stdout.write(`   ↺ ${clinica}\r`);
    } else {
      await (base("Objetivos_Mensuales") as any).create([{
        fields: {
          clinica,
          mes,
          objetivo_aceptados: objetivo,
          creado_por: "seed-demo-completo",
          creado_en: now,
          actualizado_en: now,
        },
      }]);
      created++;
    }
    await sleep(150);
  }

  console.log(`\n   ✅ ${OBJETIVOS_MES.length} objetivos para ${mes}`);
  return OBJETIVOS_MES.length;
}

// ── 5. Crear secuencias de automatización ─────────────────────────────────────

async function createSecuencias(): Promise<number> {
  console.log("\n🤖 Creando secuencias de automatización…");
  const now = new Date().toISOString();

  const SECUENCIAS = [
    // 4 presupuesto_inactivo
    {
      clinica: "Clínica Madrid Centro",
      paciente_nombre: "María García López",
      telefono: "+34 612 111 001",
      tratamiento: "Ortodoncia invisible",
      tipo_evento: "presupuesto_inactivo",
      mensaje_generado: `Hola María, te escribo desde Clínica Madrid Centro. Hace unas semanas te presentamos un presupuesto para ortodoncia invisible y queríamos saber si has tenido tiempo de valorarlo. Estamos aquí para resolver cualquier duda que tengas. ¡Estaré encantada de atenderte! 😊 ${SEED_TAG}`,
      tono_usado: "empatico",
    },
    {
      clinica: "Clínica Barcelona Eixample",
      paciente_nombre: "Luis González Martínez",
      telefono: "+34 612 111 012",
      tratamiento: "Implante dental",
      tipo_evento: "presupuesto_inactivo",
      mensaje_generado: `Luis, buenos días. Soy Adrián de Clínica Barcelona Eixample. Hace 18 días te enviamos el presupuesto para el implante dental. ¿Pudiste revisarlo con tu familia? Recuerda que tenemos facilidades de pago. Cuéntame si tienes alguna duda. ${SEED_TAG}`,
      tono_usado: "directo",
    },
    {
      clinica: "Clínica Valencia Centro",
      paciente_nombre: "Carmen Rodríguez Sánchez",
      telefono: "+34 612 111 003",
      tratamiento: "Carillas de porcelana",
      tipo_evento: "presupuesto_inactivo",
      mensaje_generado: `Hola Carmen. Te recordamos desde Clínica Valencia Centro que tienes pendiente valorar el presupuesto de carillas de porcelana que elaboró la Dra. Cano. El resultado puede ser espectacular. ¿Te gustaría pedir una segunda cita para resolver dudas? ${SEED_TAG}`,
      tono_usado: "empatico",
    },
    {
      clinica: "Clínica Sevilla",
      paciente_nombre: "Antonio González Pérez",
      telefono: "+34 612 111 004",
      tratamiento: "Ortodoncia brackets",
      tipo_evento: "presupuesto_inactivo",
      mensaje_generado: `Antonio, hola. Beatriz, encargada de Clínica Sevilla. Llevamos 3 semanas sin noticias tuyas sobre el presupuesto de ortodoncia. ¡No te olvides de que tienes una sonrisa pendiente! Si el precio es un obstáculo, podemos hablar. ${SEED_TAG}`,
      tono_usado: "urgencia",
    },
    // 3 portal_visto_sin_respuesta
    {
      clinica: "Clínica Madrid Norte",
      paciente_nombre: "Isabel López Martínez",
      telefono: "+34 612 111 005",
      tratamiento: "Implante dental",
      tipo_evento: "portal_visto_sin_respuesta",
      mensaje_generado: `Isabel, buenas tardes. Vimos que revisaste el presupuesto de implante que te enviamos, ¡qué bien! Solo quería saber si tienes alguna pregunta o si quieres que te llamemos para explicarte los pasos del tratamiento con más detalle. Estamos a tu disposición. ${SEED_TAG}`,
      tono_usado: "empatico",
    },
    {
      clinica: "Clínica Barcelona Gràcia",
      paciente_nombre: "Francisco García García",
      telefono: "+34 612 111 008",
      tratamiento: "Prótesis removible",
      tipo_evento: "portal_visto_sin_respuesta",
      mensaje_generado: `Hola Francisco. Notamos que has revisado el presupuesto de prótesis. ¿Tienes alguna duda sobre el tratamiento? La Dra. Pascual puede recibirte para una segunda consulta sin coste. Solo dinos y buscamos hueco esta semana. ${SEED_TAG}`,
      tono_usado: "directo",
    },
    {
      clinica: "Clínica Bilbao",
      paciente_nombre: "Pilar Martínez González",
      telefono: "+34 612 111 009",
      tratamiento: "Corona cerámica",
      tipo_evento: "portal_visto_sin_respuesta",
      mensaje_generado: `Pilar, buenos días desde Clínica Bilbao. Abriste el presupuesto de la corona cerámica ayer y nos alegra que lo estés valorando. Si quieres que el Dr. Prieto te llame para explicarte el procedimiento en 5 minutos, dinos y lo gestionamos enseguida. ${SEED_TAG}`,
      tono_usado: "empatico",
    },
    // 2 reactivacion_programada
    {
      clinica: "Clínica Salamanca",
      paciente_nombre: "Juan López Rodríguez",
      telefono: "+34 612 111 010",
      tratamiento: "Ortodoncia invisible",
      tipo_evento: "reactivacion_programada",
      mensaje_generado: `Hola Juan, hace 3 meses nos dijiste que lo pensarías. ¡Es el momento! La nueva temporada de verano se acerca y con ortodoncia invisible nadie notará el aparato. ¿Le damos una segunda oportunidad? La Dra. Blanco tiene huecos esta semana. ${SEED_TAG}`,
      tono_usado: "urgencia",
    },
    {
      clinica: "Clínica Málaga",
      paciente_nombre: "Ana Sánchez López",
      telefono: "+34 612 111 011",
      tratamiento: "Blanqueamiento dental",
      tipo_evento: "reactivacion_programada",
      mensaje_generado: `Ana, ¡cuánto tiempo! Soy Amparo de Clínica Málaga. En primavera es el mejor momento para el blanqueamiento: resultados que duran todo el verano. ¿Te animamos a retomar el presupuesto que valoraste hace unos meses? Tenemos oferta para reactivaciones. ${SEED_TAG}`,
      tono_usado: "empatico",
    },
    // 1 presupuesto_aceptado
    {
      clinica: "Clínica Madrid Centro",
      paciente_nombre: "Carlos Fernández García",
      telefono: "+34 612 111 014",
      tratamiento: "Implante dental",
      tipo_evento: "presupuesto_aceptado_notificacion",
      mensaje_generado: `¡Enhorabuena, Carlos! 🎉 Tu tratamiento de implante dental ha comenzado con éxito. Recuerda tu próxima cita con el Dr. García el martes a las 10:00h. Ante cualquier duda, no dudes en contactarnos. ¡Estamos muy contentos de acompañarte en este proceso! ${SEED_TAG}`,
      tono_usado: "empatico",
    },
  ];

  const batch = SECUENCIAS.map((s) => ({
    fields: {
      presupuesto_id:   `demo-seed-${Math.floor(rng() * 999999)}`,
      clinica:          s.clinica,
      paciente_nombre:  s.paciente_nombre,
      telefono:         s.telefono,
      tratamiento:      s.tratamiento,
      tipo_evento:      s.tipo_evento,
      estado:           "pendiente",
      mensaje_generado: s.mensaje_generado,
      tono_usado:       s.tono_usado,
      canal_sugerido:   "whatsapp",
      creado_en:        now,
      actualizado_en:   now,
    },
  }));

  try {
    await (base("Secuencias_Automaticas") as any).create(batch.slice(0, 10));
    console.log(`   ✅ ${batch.length} secuencias creadas`);
    return batch.length;
  } catch (err: any) {
    console.error(`   ❌ Error creando secuencias: ${err.message}`);
    return 0;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════");
  console.log("   FYLLIO — Seed Demo Completo");
  console.log("════════════════════════════════════════════");
  console.log(`   Base ID: ${BASE_ID}`);

  // 1. Limpieza
  await clearPresupuestos();
  await clearSecuencias();

  // 2. Pacientes
  const pacientes = await ensurePacientes();
  if (pacientes.length === 0) {
    console.error("❌ No hay pacientes disponibles. Ejecuta primero: npx tsx scripts/seed-airtable.ts");
    process.exit(1);
  }

  // 3. Presupuestos
  const totalPres = await createPresupuestos(pacientes);

  // 4. Objetivos
  const totalObj = await createObjetivos();

  // 5. Secuencias
  const totalSeq = await createSecuencias();

  // Resumen
  console.log("\n════════════════════════════════════════════");
  console.log("✅ Seed completado:");
  console.log(`   - ${CLINICA_TARGETS.length} clínicas`);
  console.log(`   - ${totalPres} presupuestos creados`);
  console.log(`   - ${totalObj} objetivos creados`);
  console.log(`   - ${totalSeq} automatizaciones creadas`);
  console.log("════════════════════════════════════════════");
  console.log("\n🎉 Abre el Command Center para ver las 10 clínicas con datos distintos.");
}

main().catch((err) => {
  console.error("❌ Error fatal:", err?.message ?? err);
  process.exit(1);
});
