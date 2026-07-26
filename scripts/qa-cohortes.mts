#!/usr/bin/env tsx
// QA permanente de cohortes de Seguimiento (paso 0 del rediseño, 2026-07-25).
//
//   npx tsx scripts/qa-cohortes.mts            (= npm run qa:cohortes)
//   QA_COHORTES_DETALLE=1 npx tsx ...          → además, censo caso a caso
//
// Censo: para cada lead ACTIVO y presupuesto ABIERTO del DEMO deriva
// id · estado negocio · estadoConversacion · cita futura · cohorte, usando
// LAS MISMAS libs puras que la UI (estado-conversacion, conversacion-
// presupuesto, seguimiento/cohortes) — cero criterios paralelos. Solo la
// CARGA de datos es SQL directo (mismas consultas que los repos PG).
//
// Invariante dura: ningún caso activo sin cohorte, ninguno en dos. Si un
// activo queda invisible, el script revienta (exit 1).
//
// Contexto explícito (lecciones §6): conecta como fyllio_app con
// app.cliente='DEMO' — RLS impide estructuralmente leer RB/INDEP.

import pg from "pg";
import * as dotenv from "dotenv";
import {
  estadoConversacion,
  UMBRAL_REACTIVACION_MS,
  type EstadoConversacion,
} from "../app/lib/presupuestos/estado-conversacion";
import { conversacionDePresupuesto } from "../app/lib/presupuestos/conversacion-presupuesto";
import { esLeadActivo } from "../app/lib/leads/pipeline";
import {
  cohorteLead,
  cohortePresupuesto,
  NUEVO_URGENTE_MS,
  type CohorteLead,
  type CohortePresupuesto,
} from "../app/lib/seguimiento/cohortes";

dotenv.config({ path: ".env.local" });
dotenv.config();

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL_APP,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
await db.query("begin");
await db.query("select set_config('app.cliente', 'DEMO', true)");
const ctx = (await db.query("select current_setting('app.cliente', true) as c")).rows[0].c;
if (ctx !== "DEMO") {
  console.error("✗ contexto no es DEMO:", ctx);
  process.exit(1);
}

const AHORA = Date.now();
const HOY = new Date(AHORA).toISOString().slice(0, 10);
const DETALLE = process.env.QA_COHORTES_DETALLE === "1";
const fallos: string[] = [];

// ── carga (mismas consultas que los repos PG) ─────────────────────────
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const max = (a: string | null, b: string | null) => (!a ? b : !b || a > b ? a : b);

const leads = (
  await db.query(
    "select id, nombre, estado, fecha_cita, convertido_a_paciente, created_at from leads",
  )
).rows;

const presus = (
  await db.query(
    `select id, estado, importe, fecha_ultima_respuesta, ultima_accion_registrada,
            tipo_ultima_accion, created_at
     from presupuestos`,
  )
).rows;

// Hilo: último entrante/saliente por conversación (≡ ultimosMensajesPorConversacionPg).
const hiloRows = (
  await db.query(
    `select presupuesto_id, lead_id, direccion, max(timestamp) as t
     from mensajes_whatsapp
     where timestamp is not null and (presupuesto_id is not null or lead_id is not null)
     group by presupuesto_id, lead_id, direccion`,
  )
).rows;
type Hilo = { entranteAt: string | null; salienteAt: string | null };
const hiloLead = new Map<string, Hilo>();
const hiloPresu = new Map<string, Hilo>();
for (const r of hiloRows) {
  const t = iso(r.t);
  if (!t) continue;
  for (const [id, mapa] of [
    [r.lead_id, hiloLead],
    [r.presupuesto_id, hiloPresu],
  ] as const) {
    if (!id) continue;
    const cur = mapa.get(String(id)) ?? { entranteAt: null, salienteAt: null };
    if (r.direccion === "Entrante") cur.entranteAt = max(cur.entranteAt, t);
    else cur.salienteAt = max(cur.salienteAt, t);
    mapa.set(String(id), cur);
  }
}

// Acciones de lead (≡ ultimasAccionesDireccionPorLeadPg).
const accRows = (
  await db.query(
    `select lead_id, timestamp, tipo_accion, created_at from acciones_lead
     where tipo_accion in ('Llamada', 'WhatsApp_Saliente', 'WhatsApp_Entrante')`,
  )
).rows;
const accSaliente = new Map<string, string>();
const accEntrante = new Map<string, string>();
for (const r of accRows) {
  if (!r.lead_id) continue;
  const t = iso(r.timestamp) ?? iso(r.created_at);
  if (!t) continue;
  const mapa = r.tipo_accion === "WhatsApp_Entrante" ? accEntrante : accSaliente;
  mapa.set(r.lead_id, max(mapa.get(r.lead_id) ?? null, t)!);
}

await db.query("rollback");
await db.end();

// ── censo leads ───────────────────────────────────────────────────────
type FilaLead = {
  id: string;
  nombre: string;
  estado: string;
  conv: EstadoConversacion;
  citaFutura: boolean;
  cohorte: CohorteLead;
  urgente: boolean;
};
const COHORTES_LEAD: CohorteLead[] = ["citados", "nuevos", "en_conversacion", "rezagados"];
const activosLead: FilaLead[] = [];
for (const l of leads) {
  if (l.convertido_a_paciente || !esLeadActivo(l.estado)) continue;
  const hilo = hiloLead.get(l.id);
  // Misma composición que dashboard-red (la canónica de servidor para leads).
  const conv = estadoConversacion(
    {
      ultimoEntranteAt: max(accEntrante.get(l.id) ?? null, hilo?.entranteAt ?? null),
      ultimoSalienteAt: max(accSaliente.get(l.id) ?? null, hilo?.salienteAt ?? null),
    },
    UMBRAL_REACTIVACION_MS.lead,
    AHORA,
  );
  const fechaCita = l.fecha_cita ? String(l.fecha_cita).slice(0, 10) : null;
  const cohorte = cohorteLead({ fechaCita, hoy: HOY, conversacion: conv.estado });
  if (!COHORTES_LEAD.includes(cohorte)) {
    fallos.push(`lead ${l.id} (${l.nombre}) sin cohorte válida: ${cohorte}`);
  }
  activosLead.push({
    id: l.id,
    nombre: l.nombre,
    estado: l.estado,
    conv: conv.estado,
    citaFutura: !!fechaCita && fechaCita >= HOY,
    cohorte,
    urgente:
      cohorte === "nuevos" && AHORA - new Date(iso(l.created_at)!).getTime() >= NUEVO_URGENTE_MS,
  });
}

// ── censo presupuestos ────────────────────────────────────────────────
type FilaPresu = {
  id: string;
  estado: string;
  importe: number;
  conv: EstadoConversacion;
  cohorte: CohortePresupuesto;
};
const COHORTES_PRESU: CohortePresupuesto[] = ["nuevos", "en_conversacion", "rezagados"];
const abiertos: FilaPresu[] = [];
for (const p of presus) {
  if (p.estado === "ACEPTADO" || p.estado === "PERDIDO") continue;
  const conv = conversacionDePresupuesto(
    {
      fechaUltimaRespuesta: iso(p.fecha_ultima_respuesta),
      ultimaAccionRegistrada: iso(p.ultima_accion_registrada),
      tipoUltimaAccion: p.tipo_ultima_accion ? String(p.tipo_ultima_accion) : null,
    },
    hiloPresu.get(p.id),
  );
  const cohorte = cohortePresupuesto(conv.estado);
  if (!COHORTES_PRESU.includes(cohorte)) {
    fallos.push(`presupuesto ${p.id} sin cohorte válida: ${cohorte}`);
  }
  abiertos.push({
    id: p.id,
    estado: p.estado,
    importe: Number(p.importe ?? 0) || 0,
    conv: conv.estado,
    cohorte,
  });
}

// ── invariantes ───────────────────────────────────────────────────────
// 1. Partición exacta: la suma de cohortes cuadra con el total de activos
//    (ninguno invisible; "ninguno en dos" lo garantiza que cohorte es un
//    único valor por caso, verificado arriba contra el dominio).
const porCohorteLead = Object.fromEntries(
  COHORTES_LEAD.map((c) => [c, activosLead.filter((f) => f.cohorte === c)]),
) as Record<CohorteLead, FilaLead[]>;
const sumaLead = COHORTES_LEAD.reduce((s, c) => s + porCohorteLead[c].length, 0);
if (sumaLead !== activosLead.length) {
  fallos.push(`leads: suma de cohortes ${sumaLead} ≠ activos ${activosLead.length}`);
}
const porCohortePresu = Object.fromEntries(
  COHORTES_PRESU.map((c) => [c, abiertos.filter((f) => f.cohorte === c)]),
) as Record<CohortePresupuesto, FilaPresu[]>;
const sumaPresu = COHORTES_PRESU.reduce((s, c) => s + porCohortePresu[c].length, 0);
if (sumaPresu !== abiertos.length) {
  fallos.push(`presupuestos: suma de cohortes ${sumaPresu} ≠ abiertos ${abiertos.length}`);
}
// 2. Paridad con las fuentes: citados ≡ cita hoy/futura; rezagados ≡ reactivable.
const citasFuturas = activosLead.filter((f) => f.citaFutura).length;
if (porCohorteLead.citados.length !== citasFuturas) {
  fallos.push(`leads: citados ${porCohorteLead.citados.length} ≠ citas hoy/futuras ${citasFuturas}`);
}
for (const f of activosLead) {
  if (!f.citaFutura && f.conv === "reactivable" && f.cohorte !== "rezagados") {
    fallos.push(`lead ${f.id}: reactivable sin cita pero cohorte ${f.cohorte}`);
  }
}
for (const f of abiertos) {
  if (f.conv === "reactivable" && f.cohorte !== "rezagados") {
    fallos.push(`presupuesto ${f.id}: reactivable pero cohorte ${f.cohorte}`);
  }
}

// ── informe ───────────────────────────────────────────────────────────
const eur = (n: number) => `${Math.round(n).toLocaleString("es-ES")} €`;
console.log(`\nCENSO SEGUIMIENTO · DEMO · ${new Date(AHORA).toISOString()}\n`);
console.log(`Leads activos: ${activosLead.length}`);
for (const c of COHORTES_LEAD) {
  const filas = porCohorteLead[c];
  const extra =
    c === "nuevos" && filas.some((f) => f.urgente)
      ? ` (${filas.filter((f) => f.urgente).length} sin contactar ≥48 h)`
      : "";
  console.log(`  ${c.padEnd(16)} ${String(filas.length).padStart(3)}${extra}`);
}
console.log(`\nPresupuestos abiertos: ${abiertos.length}`);
for (const c of COHORTES_PRESU) {
  const filas = porCohortePresu[c];
  const suma = filas.reduce((s, f) => s + f.importe, 0);
  console.log(`  ${c.padEnd(16)} ${String(filas.length).padStart(3)} · ${eur(suma)}`);
}

if (DETALLE) {
  console.log("\n— Detalle leads —");
  for (const f of activosLead) {
    console.log(
      `${f.id} · ${f.nombre} · ${f.estado} · ${f.conv} · cita_futura=${f.citaFutura ? "sí" : "no"} → ${f.cohorte}${f.urgente ? " (urgente)" : ""}`,
    );
  }
  console.log("\n— Detalle presupuestos —");
  for (const f of abiertos) {
    console.log(`${f.id} · ${f.estado} · ${eur(f.importe)} · ${f.conv} → ${f.cohorte}`);
  }
}

if (fallos.length > 0) {
  console.error(`\n✗ INVARIANTE ROTA (${fallos.length}):`);
  for (const f of fallos) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ Invariante en verde: todo activo en exactamente una cohorte.");
