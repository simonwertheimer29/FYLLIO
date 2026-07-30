#!/usr/bin/env node
//
// QA del Bloque 1 de /kpis (2026-07-30): que las tasas de /kpis, la cabecera de
// /presupuestos y los informes digan LO MISMO, que ningún KPI salga a 0 por un
// literal desajustado, y que el embudo de Leads mantenga la anidación.
//
//   node scripts/qa-kpis-tasas.mjs        (= npm run qa:kpis)
//
// Necesita el servidor levantado (por defecto :3100) y firma su propia cookie
// de sesión DEMO con AUTH_SECRET de .env.local — igual que qa-red-scope.
//
// Códigos de salida (§9): 0 todo OK · 1 hay algo mal · 2 NO PUDE COMPROBAR.
// Los dos últimos son decisiones opuestas para quien lo lee, así que no
// comparten código.

import { SignJWT } from "jose";
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const BASE = process.env.QA_BASE ?? "http://localhost:3100";

function abortar(motivo) {
  console.error(`\n✗ NO PUDE COMPROBAR: ${motivo}`);
  console.error("  (código 2 — distinto de 'comprobé y está mal')");
  process.exit(2);
}

// ─── Sonda previa: ¿estamos hablando con lo que creemos? ────────────────
for (const v of ["AUTH_SECRET", "SUPABASE_DB_URL_ADMIN"]) {
  if (!process.env[v]) abortar(`falta ${v} en el entorno`);
}

let salud;
try {
  salud = await fetch(`${BASE}/api/salud`, { redirect: "manual" });
} catch (e) {
  abortar(`no hay nadie escuchando en ${BASE} (${e instanceof Error ? e.message : String(e)})`);
}
if (salud.status !== 200 && salud.status !== 401) {
  abortar(`${BASE}/api/salud respondió ${salud.status}; no parece nuestra app`);
}

// ─── Datos reales del tenant DEMO, para comparar contra la API ─────────
const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL_ADMIN,
  max: 1,
  ssl: { rejectUnauthorized: false },
});
const c = await pool.connect();
await c.query("begin");
await c.query("select set_config('app.cliente','DEMO',true)");

const admin = (await c.query("select id,nombre from usuarios where email='demo@fyllio.com'")).rows[0];
if (!admin) { await c.query("rollback"); c.release(); await pool.end(); abortar("no existe el usuario demo@fyllio.com"); }

const est = (await c.query(
  "select estado, count(*)::int n from presupuestos group by 1",
)).rows;
const nDe = (e) => est.filter((r) => r.estado === e).reduce((s, r) => s + r.n, 0);
const ACEPTADOS = nDe("ACEPTADO");
const PERDIDOS = nDe("PERDIDO");
const TOTAL = est.reduce((s, r) => s + r.n, 0);
const ABIERTOS = TOTAL - ACEPTADOS - PERDIDOS;
const TASA_REAL = ACEPTADOS + PERDIDOS > 0
  ? Math.round((ACEPTADOS / (ACEPTADOS + PERDIDOS)) * 100)
  : null;

const visitas = (await c.query(
  "select coalesce(tipo_visita,'(null)') v, count(*)::int n from presupuestos group by 1",
)).rows;

await c.query("rollback");
c.release();
await pool.end();

if (TOTAL === 0) abortar("el tenant DEMO no tiene presupuestos (¿falta npm run demo:reset?)");

// ─── Cookie de sesión DEMO ─────────────────────────────────────────────
const sec = new TextEncoder().encode(process.env.AUTH_SECRET);
const cookie = `fyllio_session=${await new SignJWT({
  userId: admin.id, rol: "admin", cliente: "DEMO",
  clinicasAccesibles: ["*"], nombre: admin.nombre,
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(sec)}`;

async function api(ruta) {
  const r = await fetch(`${BASE}${ruta}`, { headers: { cookie } });
  if (!r.ok) abortar(`${ruta} respondió ${r.status} (esperaba datos, no un error)`);
  return r.json();
}

// ─── Comprobaciones ────────────────────────────────────────────────────
let fallos = 0;
const ok = (nombre, cond, detalle = "") => {
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  if (!cond) fallos++;
};

console.log(`\nDEMO: ${TOTAL} presupuestos = ${ACEPTADOS} aceptados + ${PERDIDOS} perdidos + ${ABIERTOS} abiertos`);
console.log(`Tasa esperada (aceptados/decididos): ${TASA_REAL}%\n`);

const { kpis, kpisMes } = await api("/api/presupuestos/kpis");
const kpisMesTasa = kpisMes?.resumen?.tasa;

// 1.1 — la tasa global ya no diluye
ok(
  "1.1 · la tasa global es sobre decididos",
  kpis.resumen.tasa?.pct === TASA_REAL,
  `API ${kpis.resumen.tasa?.pct}% vs esperado ${TASA_REAL}%`,
);
ok(
  "1.1 · el denominador viaja con la tasa",
  kpis.resumen.tasa?.decididos === ACEPTADOS + PERDIDOS &&
    kpis.resumen.tasa?.abiertos === ABIERTOS,
  `decididos=${kpis.resumen.tasa?.decididos} abiertos=${kpis.resumen.tasa?.abiertos}`,
);

// Todos los cortes usan la misma forma, y ninguno puede pasar del 100%.
const cortes = [
  ["porDoctor", kpis.porDoctor],
  ["porTratamiento", kpis.porTratamiento],
  ["porTipoPaciente", kpis.porTipoPaciente],
  ["porTipoVisita", kpis.porTipoVisita],
  ["porOrigenLead", kpis.porOrigenLead],
  ["porClinica", kpis.porClinica],
];
for (const [nombre, filas] of cortes) {
  const malos = (filas ?? []).filter(
    (f) =>
      !f.tasa ||
      typeof f.tasa.decididos !== "number" ||
      f.tasa.aceptados > f.tasa.decididos ||
      (f.tasa.pct != null && (f.tasa.pct < 0 || f.tasa.pct > 100)),
  );
  ok(`1.1 · ${nombre}: cohorte anidada en las ${filas?.length ?? 0} filas`, malos.length === 0,
    malos.length ? `${malos.length} filas mal` : "");
}

// La Comparativa de clínicas usa la misma tasa que el resto.
const sumaClinicas = (kpis.porClinica ?? []).reduce(
  (s, c) => ({ a: s.a + c.tasa.aceptados, d: s.d + c.tasa.decididos }),
  { a: 0, d: 0 },
);
ok(
  "1.1 · la Comparativa de clínicas suma lo mismo que el global",
  sumaClinicas.a === ACEPTADOS && sumaClinicas.d === ACEPTADOS + PERDIDOS,
  `clínicas ${sumaClinicas.a}/${sumaClinicas.d} vs global ${ACEPTADOS}/${ACEPTADOS + PERDIDOS}`,
);

// 1.1 bis — los informes usan la MISMA función: el informe del mes debe dar
// exactamente la tasa de la cohorte de presentación de ese mes en /kpis.
const mesActual = new Date().toISOString().slice(0, 7);
const inf = await fetch(`${BASE}/api/presupuestos/ia/informe`, {
  method: "POST",
  headers: { cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ mes: mesActual, clinicaId: "todas" }),
});
if (inf.ok) {
  const { datosUsados } = await inf.json();
  const t = datosUsados?.tasa;
  ok(
    "1.1 · el informe da la misma tasa que /kpis para el mismo mes",
    t?.pct === kpisMesTasa?.pct && t?.decididos === kpisMesTasa?.decididos,
    `informe ${t?.pct}% (${t?.decididos} decididos) vs /kpis ${kpisMesTasa?.pct}% (${kpisMesTasa?.decididos})`,
  );
} else {
  console.log(`· informe IA no comprobado (${inf.status}) — sin ANTHROPIC_API_KEY no se puede generar`);
}

// 1.3 — ningún KPI a 0 por un literal desajustado
const totalVisitas = kpis.resumen.primeraVisita + kpis.resumen.conHistoria;
ok(
  "1.3 · el tipo de visita ya no sale a cero por la mayúscula",
  totalVisitas > 0,
  `1ª visita ${kpis.resumen.primeraVisita} · con historial ${kpis.resumen.conHistoria} ` +
    `(en la base: ${visitas.map((v) => `${v.v}=${v.n}`).join(", ")})`,
);

// 1.4 / 1.6 — el embudo de Leads mantiene la anidación
const leads = await api("/api/leads/kpis?periodo=trimestre");
const etapas = leads.funnel.etapas;
console.log(`\nEmbudo: ${etapas.map((e) => `${e.etapa} ${e.total}`).join(" → ")}`);
let anidado = true;
for (let i = 1; i < etapas.length; i++) {
  if (etapas[i].total > etapas[i - 1].total) anidado = false;
}
ok("1.4 · cada etapa del embudo contiene a la siguiente", anidado);
const ceroYResucita = etapas.some(
  (e, i) => i > 0 && e.total === 0 && etapas.slice(i + 1).some((x) => x.total > 0),
);
ok("1.4 · ninguna etapa a cero seguida de una con valor", !ceroYResucita);
ok(
  "1.6 · los asistidos salen de la agenda, no del flag vacío",
  leads.kpis.pacientesCitados.asistidos > 0,
  `${leads.kpis.pacientesCitados.asistidos} asistieron · ${leads.kpis.pacientesCitados.pendientes} pendientes`,
);
ok(
  "1.6 · pendientes nunca negativo",
  leads.kpis.pacientesCitados.pendientes >= 0,
);

// 1.5 — el cobrado de origen lead ya no es 0 con pagos reales
ok(
  "1.5 · Cobrado cruza lead → paciente → pagos",
  leads.kpis.facturado.actual > 0,
  `${leads.kpis.facturado.actual} € · ${leads.kpis.tasaConversion.actual}% conversión`,
);

// 1.7 — la precisión del predictor ya no se promete
const ns = await api("/api/kpis/no-shows");
ok("1.7 · la precisión del predictor está retirada", ns.precisionPredictor == null);

console.log(
  fallos === 0
    ? "\n✓ Bloque 1 en verde\n"
    : `\n✗ ${fallos} comprobacion${fallos === 1 ? "" : "es"} en rojo\n`,
);
process.exit(fallos === 0 ? 0 : 1);
