#!/usr/bin/env tsx
// Línea base del modelo ofensivo (PLAN-AGENTE-OFENSIVO.md §10), 2026-08-13.
//
//   npx tsx scripts/medir-linea-base.mts
//
// Mide, sobre los presupuestos CERRADOS del tenant DEMO:
//   1. Días (de calendario de la clínica) desde la PRIMERA respuesta del
//      paciente hasta el cierre (ACEPTADO o PERDIDO).
//   2. Toques: mensajes SALIENTES del hilo entre esa primera respuesta y el
//      cierre (ambos incluidos).
//
// Definiciones, para que el cálculo sea repetible:
//   · primera respuesta = min(timestamp) de mensajes_whatsapp con
//     direccion='Entrante' y presupuesto_id = p.id
//   · cierre ACEPTADO = presupuestos.fecha_aceptado (columna `date`)
//   · cierre PERDIDO  = fecha del último historial_acciones con
//     tipo='cambio_estado' y metadata.estadoNuevo='PERDIDO' (es lo que
//     escribe la app al perder; PERDIDO no tiene columna de fecha propia)
//   · días = día de clínica del cierre − día de clínica de la primera
//     respuesta (lecciones §13: calendario de la clínica, no ventana rodante)
//   · percentiles por rango más cercano: p(q) = ordenados[ceil(q·n)−1]
//
// Denominador visible: se reporta cuántos cerrados entran y cuántos quedan
// fuera, con el motivo (sin respuesta del paciente / sin fecha de cierre /
// cierre anterior a la primera respuesta).
//
// Solo lectura. Contexto explícito (lecciones §6): fyllio_app + app.cliente
// ='DEMO'; RLS impide leer RB/INDEP. Sonda previa (lecciones §9): si no se
// puede hablar con la base, aborta con código 2 — distinto de "medí y algo
// está mal" (1) y de "medido" (0).

import pg from "pg";
import * as dotenv from "dotenv";
import { hoyISO } from "../app/lib/time";

dotenv.config({ path: ".env.local" });
dotenv.config();

if (!process.env.SUPABASE_DB_URL_APP) {
  console.error("✗ Falta SUPABASE_DB_URL_APP — no puedo comprobar nada.");
  process.exit(2);
}

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL_APP,
  ssl: { rejectUnauthorized: false },
});

try {
  await db.connect();
} catch (err) {
  console.error("✗ No se pudo conectar a la base:", err instanceof Error ? err.message : JSON.stringify(err));
  process.exit(2);
}

await db.query("begin");
await db.query("select set_config('app.cliente', 'DEMO', true)");
const ctx = (await db.query("select current_setting('app.cliente', true) as c")).rows[0].c;
if (ctx !== "DEMO") {
  console.error("✗ contexto no es DEMO:", ctx);
  process.exit(2);
}

// ── la consulta ──────────────────────────────────────────────────────────
// Una fila por presupuesto cerrado, con sus tres piezas. Los toques se
// cuentan aquí y no en JS para que la consulta SEA la definición.
const SQL = `
  select
    p.id,
    p.estado,
    p.tratamiento_nombre,
    p.importe,
    (select min(m.timestamp) from mensajes_whatsapp m
      where m.presupuesto_id = p.id and m.direccion = 'Entrante') as primera_respuesta,
    case
      when p.estado = 'ACEPTADO' then p.fecha_aceptado::text
      else (select max(h.fecha)::text from historial_acciones h
              where h.presupuesto_id = p.id and h.tipo = 'cambio_estado'
                and h.metadata::jsonb ->> 'estadoNuevo' = 'PERDIDO')
    end as cierre,
    (select count(*)::int from mensajes_whatsapp m
      where m.presupuesto_id = p.id and m.direccion = 'Saliente') as salientes_total
  from presupuestos p
  where p.estado in ('ACEPTADO', 'PERDIDO')
  order by p.estado, p.id
`;

type Fila = {
  id: string;
  estado: "ACEPTADO" | "PERDIDO";
  tratamiento_nombre: string | null;
  importe: number | null;
  primera_respuesta: Date | null;
  cierre: string | null; // date "YYYY-MM-DD" o timestamp ISO, según la rama
  salientes_total: number;
};

const filas = (await db.query(SQL)).rows as Fila[];

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;
/** Día de clínica: un `date` ya ES un día; un instante se convierte con TZ_CLINICA. */
const diaClinica = (v: string | Date): string => {
  if (typeof v === "string" && ES_DIA.test(v.slice(0, 10)) && v.length === 10) return v;
  return hoyISO(new Date(v));
};
const diffDias = (d0: string, d1: string): number =>
  Math.round((new Date(`${d1}T00:00:00Z`).getTime() - new Date(`${d0}T00:00:00Z`).getTime()) / 86_400_000);

// ── clasificar: quién entra en la cuenta y quién no ──────────────────────
type Medido = { id: string; estado: Fila["estado"]; dias: number; toques: number };
const medidos: Medido[] = [];
const fuera = { sinRespuesta: 0, sinCierre: 0, cierreAntesDeRespuesta: 0 };

for (const f of filas) {
  if (!f.primera_respuesta) { fuera.sinRespuesta++; continue; }
  if (!f.cierre) { fuera.sinCierre++; continue; }
  const d0 = diaClinica(f.primera_respuesta);
  const d1 = diaClinica(f.cierre);
  const dias = diffDias(d0, d1);
  if (dias < 0) { fuera.cierreAntesDeRespuesta++; continue; }
  // Toques en la ventana [primera respuesta, fin del día de cierre], contados
  // sobre el día de clínica del mensaje para que un cierre tipo `date` (sin
  // hora) no recorte los salientes de su propio día.
  const toques = (await db.query(
    `select count(*)::int as n from mensajes_whatsapp m
      where m.presupuesto_id = $1 and m.direccion = 'Saliente'
        and m.timestamp >= $2
        and (m.timestamp at time zone 'Europe/Madrid')::date <= $3::date`,
    [f.id, f.primera_respuesta, d1],
  )).rows[0].n as number;
  medidos.push({ id: f.id, estado: f.estado, dias, toques });
}

await db.query("rollback");
await db.end();

// ── distribución ─────────────────────────────────────────────────────────
const pct = (orden: number[], q: number): number => orden[Math.max(0, Math.ceil(q * orden.length) - 1)];
const dist = (xs: number[]) => {
  const o = [...xs].sort((a, b) => a - b);
  const media = o.reduce((s, x) => s + x, 0) / o.length;
  return {
    n: o.length, min: o[0], p25: pct(o, 0.25), mediana: pct(o, 0.5),
    p75: pct(o, 0.75), p90: pct(o, 0.9), max: o[o.length - 1],
    media: Math.round(media * 10) / 10,
  };
};
const linea = (etq: string, d: ReturnType<typeof dist>) =>
  console.log(
    `  ${etq.padEnd(22)} n=${String(d.n).padStart(3)}  min=${d.min}  p25=${d.p25}  mediana=${d.mediana}  p75=${d.p75}  p90=${d.p90}  max=${d.max}  media=${d.media}`,
  );

if (medidos.length === 0) {
  console.error("✗ Ningún presupuesto cerrado entra en la cuenta — no hay línea base que congelar.");
  console.error(`  Cerrados: ${filas.length} · sin respuesta del paciente: ${fuera.sinRespuesta} · sin fecha de cierre: ${fuera.sinCierre} · cierre antes de la respuesta: ${fuera.cierreAntesDeRespuesta}`);
  process.exit(1);
}

const acep = medidos.filter((m) => m.estado === "ACEPTADO");
const perd = medidos.filter((m) => m.estado === "PERDIDO");

console.log(`Línea base DEMO — medida el ${hoyISO()} (datos sembrados: sirve para comparar antes/después, no como dato de mercado)`);
console.log(`\nDenominador: ${filas.length} presupuestos cerrados (${filas.filter((f) => f.estado === "ACEPTADO").length} aceptados, ${filas.filter((f) => f.estado === "PERDIDO").length} perdidos)`);
console.log(`  Entran en la cuenta: ${medidos.length}`);
console.log(`  Fuera — el paciente nunca respondió: ${fuera.sinRespuesta}`);
console.log(`  Fuera — sin fecha de cierre: ${fuera.sinCierre}`);
console.log(`  Fuera — cierre anterior a la primera respuesta: ${fuera.cierreAntesDeRespuesta}`);

console.log(`\nDías de la primera respuesta al cierre (calendario de la clínica):`);
linea("todos", dist(medidos.map((m) => m.dias)));
if (acep.length) linea("aceptados", dist(acep.map((m) => m.dias)));
if (perd.length) linea("perdidos", dist(perd.map((m) => m.dias)));

console.log(`\nToques (salientes entre la primera respuesta y el cierre):`);
linea("todos", dist(medidos.map((m) => m.toques)));
if (acep.length) linea("aceptados", dist(acep.map((m) => m.toques)));
if (perd.length) linea("perdidos", dist(perd.map((m) => m.toques)));

// Detalle caso a caso, para poder auditar el número congelado sin re-derivarlo.
console.log(`\nDetalle (id · estado · días · toques):`);
for (const m of medidos) console.log(`  ${m.id}  ${m.estado.padEnd(8)}  ${String(m.dias).padStart(3)}  ${m.toques}`);
