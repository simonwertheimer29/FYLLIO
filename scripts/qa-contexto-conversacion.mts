#!/usr/bin/env tsx
// QA del contexto de conversación (fase A, paso 2).
//
//   npx tsx scripts/qa-contexto-conversacion.mts   (= npm run qa:contexto)
//
// Para CADA teléfono con hilo en el DEMO deriva el contexto con la lib real
// (`lib/agente/contexto-conversacion`) y lo contrasta con expectativas
// calculadas con SQL INDEPENDIENTE — el vocabulario de «lead activo» y la
// cuenta de pendiente se declaran aquí a mano, para que un error en la lib no
// se apruebe a sí mismo.
//
// Invariantes:
//   1. cobro abierto ⇔ el paciente emparejado tiene firmado − cobrado > 0
//   2. presupuesto abierto ⇔ existe presupuesto vivo por teléfono o paciente
//   3. cita abierta ⇔ lead activo (estado activo, no convertido) O paciente
//      SIN cita futura registrada (fase B punto 1, 2026-08-17: el ciclo de
//      vida del paciente existente — antes cita era solo del embudo)
//   4. identificar ⇔ ningún paciente y ningún lead EN NINGÚN ESTADO (un lead
//      cerrado no abre cita, pero sabemos quién es) — excluyente con ambos
//   5. objetivosAbiertos respeta la precedencia cobro > presupuesto > cita
//   6. pendienteCobro nunca negativo; solo > 0 con paciente
//
// Cobertura (§5: un entorno sin casos da falsos aprobados): exige que el DEMO
// ejercite LAS CUATRO ramas con datos reales — identificar incluida, desde el
// fixture de huérfanos del paso 5 (2026-08-14). El teléfono sintético se
// mantiene: cubre «jamás visto, sin un solo mensaje», que el seed no puede.
//
// Códigos de salida (§9): 0 = todo bien · 1 = invariante rota · 2 = no se
// pudo comprobar (entorno/conexión) — nunca se confunden.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { contextoDeConversacion } from "../app/lib/agente/contexto-conversacion";

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
  console.error("✗ No se pudo conectar:", err instanceof Error ? err.message : JSON.stringify(err));
  process.exit(2);
}
await db.query("begin");
await db.query("select set_config('app.cliente', 'DEMO', true)");
if ((await db.query("select current_setting('app.cliente', true) c")).rows[0].c !== "DEMO") {
  console.error("✗ contexto no es DEMO");
  process.exit(2);
}

// ── expectativas independientes, en bloque ─────────────────────────────────
// Vocabulario declarado A MANO (si la lib cambia el suyo, esto tiene que
// romper, no seguirle la corriente).
const ESTADOS_ACTIVOS_QA = ["Nuevo", "Contactado", "Citado", "Citados Hoy"];
const dig = (t: string) => t.replace(/[^0-9]/g, "");

const telefonos: string[] = (
  await db.query(
    `select distinct telefono from mensajes_whatsapp where telefono is not null order by telefono`,
  )
).rows.map((r) => String(r.telefono));

const pacientes = (
  await db.query(`select id, telefono from pacientes where telefono is not null`)
).rows as { id: string; telefono: string }[];

const leadsActivos = (
  await db.query(
    `select telefono from leads
      where coalesce(convertido_a_paciente, false) = false
        and estado = any($1) and telefono is not null`,
    [ESTADOS_ACTIVOS_QA],
  )
).rows.map((r) => dig(String(r.telefono)));

// TODOS los leads, para «identificar»: un lead cerrado no abre cita, pero
// sabemos quién es — identificar solo aplica a desconocidos totales.
const leadsTodos = (
  await db.query(`select telefono from leads where telefono is not null`)
).rows.map((r) => dig(String(r.telefono)));

const vivosTel = (
  await db.query(
    `select paciente_telefono, paciente_id from presupuestos
      where estado is null or estado not in ('ACEPTADO','PERDIDO')`,
  )
).rows as { paciente_telefono: string | null; paciente_id: string | null }[];

// Pacientes CON cita futura — para la mitad nueva de la invariante 3.
const conCitaFutura = new Set(
  (
    await db.query(`select distinct paciente_id from citas where paciente_id is not null and hora_inicio >= now()`)
  ).rows.map((r) => String(r.paciente_id)),
);

const pendientePorPaciente = new Map<string, number>();
for (const r of (
  await db.query(
    `select pa.id,
            coalesce((select sum(p.importe) from presupuestos p
                       where p.paciente_id = pa.id and p.estado = 'ACEPTADO'), 0) -
            coalesce((select sum(pg2.importe) from pagos_paciente pg2
                       where pg2.paciente_id = pa.id), 0) as pendiente
       from pacientes pa`,
  )
).rows as { id: string; pendiente: string | number }[]) {
  pendientePorPaciente.set(r.id, Math.max(0, Number(r.pendiente)));
}

await db.query("rollback");
await db.end();

// ── el recorrido ───────────────────────────────────────────────────────────
let fallos = 0;
let nCobro = 0, nPresu = 0, nCita = 0, nIdent = 0, nSinObjetivo = 0;
const fallo = (tel: string, msg: string) => {
  console.error(`  ✗ ${tel}: ${msg}`);
  fallos++;
};

// Concurrencia limitada: cada contexto son varias consultas a Supabase (y
// finanzasDePaciente carga las finanzas completas); en serie el censo entero
// tarda >5 min y un QA que tarda eso no se corre. CUATRO a la vez equilibra:
// con 8, tras el reseed grande, finanzasPorPaciente (2 consultas pesadas por
// contexto) agotaba el pool de conexiones y el QA moría por timeout.
async function enLotes<T>(items: T[], n: number, f: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  let hechos = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await f(item);
        hechos++;
        if (hechos % 50 === 0) console.log(`  … ${hechos}/${items.length}`);
      }
    }),
  );
}

await runWithCliente("DEMO", async () => {
  await enLotes(telefonos, 4, async (tel) => {
    const d = dig(tel);
    const ctx = await contextoDeConversacion(tel);
    const abiertos = ctx.objetivosAbiertos;

    // Expectativas por CONTENCIÓN de dígitos, la misma semántica de
    // emparejamiento que usa todo el sistema.
    const pacienteEsperado = pacientes.find((p) => dig(p.telefono).includes(d) || d.includes(dig(p.telefono))) ?? null;
    const esperaCita =
      leadsActivos.some((l) => l.includes(d) || d.includes(l)) ||
      (pacienteEsperado != null && !conCitaFutura.has(pacienteEsperado.id));
    const esperaPresu = vivosTel.some(
      (v) =>
        (v.paciente_telefono && (dig(v.paciente_telefono).includes(d) || d.includes(dig(v.paciente_telefono)))) ||
        (pacienteEsperado && v.paciente_id === pacienteEsperado.id),
    );
    const esperaCobro = !!pacienteEsperado && (pendientePorPaciente.get(pacienteEsperado.id) ?? 0) > 0;
    const hayLeadCualquiera = leadsTodos.some((l) => l.includes(d) || d.includes(l));
    const esperaIdent = !pacienteEsperado && !hayLeadCualquiera;

    if (abiertos.includes("cobro") !== esperaCobro)
      fallo(tel, `cobro ${abiertos.includes("cobro") ? "abierto sin" : "cerrado con"} pendiente (pendiente SQL=${pacienteEsperado ? pendientePorPaciente.get(pacienteEsperado.id) : "sin paciente"})`);
    if (abiertos.includes("presupuesto") !== esperaPresu)
      fallo(tel, `presupuesto: lib=${abiertos.includes("presupuesto")} sql=${esperaPresu}`);
    if (abiertos.includes("cita") !== esperaCita)
      fallo(tel, `cita: lib=${abiertos.includes("cita")} sql=${esperaCita}`);
    if (abiertos.includes("identificar") !== esperaIdent)
      fallo(tel, `identificar: lib=${abiertos.includes("identificar")} esperado=${esperaIdent}`);
    if (abiertos.includes("identificar") && (ctx.pacienteId || ctx.leadActivo))
      fallo(tel, "identificar con paciente o lead resuelto — excluyentes");

    const orden = ["cobro", "presupuesto", "cita", "identificar"];
    const posiciones = abiertos.map((e) => orden.indexOf(e));
    if ([...posiciones].sort((a, b) => a - b).join() !== posiciones.join())
      fallo(tel, `precedencia rota: ${abiertos.join(" > ")}`);

    if (ctx.pendienteCobro < 0) fallo(tel, `pendienteCobro negativo: ${ctx.pendienteCobro}`);
    if (ctx.pendienteCobro > 0 && !ctx.pacienteId) fallo(tel, "pendiente > 0 sin paciente");
    for (const v of ctx.presupuestosVivos)
      if (v.estado === "ACEPTADO" || v.estado === "PERDIDO") fallo(tel, `presupuesto ${v.id} cerrado entre los vivos`);

    if (abiertos.includes("cobro")) nCobro++;
    if (abiertos.includes("presupuesto")) nPresu++;
    if (abiertos.includes("cita")) nCita++;
    if (abiertos.includes("identificar")) nIdent++;
    if (abiertos.length === 0) nSinObjetivo++;
  });

  // Teléfono sintético: sin fila en ninguna tabla → identificar, y nada más.
  const fantasma = await contextoDeConversacion("+34600000001");
  if (fantasma.objetivosAbiertos.join() !== "identificar")
    fallo("+34600000001", `sintético: esperaba [identificar], salió [${fantasma.objetivosAbiertos.join(", ")}]`);
  if (fantasma.nombre !== "+34600000001" || fantasma.origenNombre !== "telefono")
    fallo("+34600000001", "sintético: el nombre debería caer al propio número");
});

// ── informe: la cobertura real y la sintética NO se suman ──────────────────
// Un «346 en verde» que mezcla las dos leería como cuatro ramas cubiertas con
// datos reales, y no es verdad: una rama cubierta solo por un caso que existe
// dentro de este script no está probada contra el producto.
console.log(`\nCobertura REAL (${telefonos.length} hilos del seed): cobro=${nCobro} · presupuesto=${nPresu} · cita=${nCita} · identificar=${nIdent} · sin objetivo=${nSinObjetivo}`);
console.log(`Cobertura SINTÉTICA (1 caso): identificar`);

const ramasReales = [["cobro", nCobro], ["presupuesto", nPresu], ["cita", nCita], ["identificar", nIdent]] as const;
// Las CUATRO ramas las tiene que ejercitar el seed (endurecido con el paso 5,
// 2026-08-14: el fixture de huérfanos existe — sin él la invariante de
// «identificar» era vacua y solo la cubría el sintético).
for (const [nombre, n] of ramasReales) {
  if (n === 0) {
    console.error(`✗ cobertura: ningún hilo del DEMO ejercita «${nombre}» — invariante vacua`);
    fallos++;
  }
}

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
const conDatos = ramasReales.filter(([, n]) => n > 0).length;
console.log(`✓ invariantes OK — ${conDatos} de 4 ramas con datos reales${nIdent === 0 ? "; «identificar» solo sintética" : ""}`);
