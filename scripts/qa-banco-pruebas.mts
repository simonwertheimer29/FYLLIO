#!/usr/bin/env tsx
// QA del BANCO DE PRUEBAS (fase E) — LA REGLA DURA: cero escritura en
// producción.
//
//   npx tsx scripts/qa-banco-pruebas.mts   (= npm run qa:banco)
//
//   A · construirEntradaDePrueba PURA: la config de la clínica entra en el
//       prompt; los 4 escenarios abren SUS objetivos; la no-reversión viaja.
//   B · CERO ESCRITURA (condición dictada 22-08): foto de TODAS las tablas
//       del cliente — recuento de cada una + checksum de las columnas
//       mutables clave — antes y después de un turno REAL del banco. No
//       solo las obvias: si un día alguien mete una escritura por descuido,
//       esta prueba es lo único que lo caza. La ÚNICA tabla que puede
//       cambiar es uso_banco_pruebas (y se afirma que CAMBIÓ: +1).
//   C · El tope corta CON SU MOTIVO: el mensaje dice cuántos y cuándo se
//       renueva — se afirma el TEXTO, no solo el corte.
//
// Usa UN turno real de modelo (~$0.01): la regla dura se prueba sobre el
// flujo de verdad, no sobre un doble. Salidas §9: 0 · 1 · 2 (sin clave/DB).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import {
  construirEntradaDePrueba,
  probarTurno,
  consumirTurnoDePrueba,
  TopeDePruebasError,
  TOPE_PRUEBAS_DIA,
} from "../app/lib/agente/banco-pruebas";
import { SESION_NUEVA, avanzarSesion } from "../app/lib/agente/sesion-prueba";
import { relojDelBanco } from "../app/lib/agente/banco-pruebas";
import { renderEntrada } from "../app/lib/agente/evaluador";
import { parseConocimiento } from "../app/lib/agente/conocimiento";
import { OBJETIVOS_POR_DEFECTO } from "../app/lib/automatizacion/objetivos";

for (const v of ["SUPABASE_DB_URL_APP", "SUPABASE_DB_URL_ADMIN", "ANTHROPIC_API_KEY"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} — no puedo comprobar la regla dura (esto es «no pude», no un verde).`);
    process.exit(2);
  }
}

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

// ─── A · La entrada, pura ──────────────────────────────────────────────────
console.log("\nA · construirEntradaDePrueba: config dentro, objetivos por escenario");

const CONOCIMIENTO_MARCADO = parseConocimiento(JSON.stringify({
  tratamientos: [{ nombre: "Tratamiento QA Banco", precio: "999 €", nota: null }],
}));
const entradaPresu = construirEntradaDePrueba({
  escenario: { tipo: "presupuesto", tratamiento: "Endodoncia", importe: 650 },
  hilo: [{ direccion: "Entrante", contenido: "Hola" }, { direccion: "Saliente", contenido: "¡Hola! ¿En qué te ayudo?" }],
  mensaje: "¿Cuánto cuesta el Tratamiento QA Banco?",
  conocimiento: CONOCIMIENTO_MARCADO,
  objetivosConfig: OBJETIVOS_POR_DEFECTO,
  clinicaNombre: "Clínica QA",
  sesion: SESION_NUEVA,
  hoy: "2026-08-22",
});
const render = renderEntrada(entradaPresu).texto;
ok("la config de la clínica entra en el prompt del banco (el precio marcado se ve)",
  render.includes("Tratamiento QA Banco: 999 €"));
ok("el escenario presupuesto abre SOLO su objetivo, con el documento ficticio en contexto",
  entradaPresu.objetivosAbiertos.map((o) => o.etapa).join(",") === "presupuesto,cita" &&
    render.includes("Endodoncia") && render.includes("650"));
ok("el hilo de la sesión + el mensaje nuevo llegan enteros y en orden",
  render.indexOf("Hola") < render.indexOf("¿En qué te ayudo?") &&
    render.indexOf("¿En qué te ayudo?") < render.indexOf("Cuánto cuesta el Tratamiento QA Banco"));
const entradaLead = construirEntradaDePrueba({
  escenario: { tipo: "lead_nuevo", nombre: "Lucía" },
  hilo: [], mensaje: "Hola, ¿hacéis ortodoncia?",
  conocimiento: null, objetivosConfig: OBJETIVOS_POR_DEFECTO,
  clinicaNombre: null, sesion: SESION_NUEVA, hoy: "2026-08-22",
});
ok("lead nuevo: no consta como paciente, y abre cita + identificar",
  !entradaLead.esPacienteConocido &&
    entradaLead.objetivosAbiertos.map((o) => o.etapa).sort().join(",") === "cita,identificar");
ok("al_dia no abre nada; cobro abre cobro con la deuda ficticia",
  construirEntradaDePrueba({ escenario: { tipo: "al_dia" }, hilo: [], mensaje: "x", conocimiento: null, objetivosConfig: OBJETIVOS_POR_DEFECTO, clinicaNombre: null, sesion: SESION_NUEVA }).objetivosAbiertos.map((o) => o.etapa).join(",") === "cita" &&
    construirEntradaDePrueba({ escenario: { tipo: "cobro", deuda: 480 }, hilo: [], mensaje: "x", conocimiento: null, objetivosConfig: OBJETIVOS_POR_DEFECTO, clinicaNombre: null, sesion: SESION_NUEVA }).pendienteCobro === 480);
ok("la no-reversión viaja: derivadoPrevio → yaDerivado (el banco la enseña, no la esquiva)",
  construirEntradaDePrueba({ escenario: { tipo: "al_dia" }, hilo: [], mensaje: "x", conocimiento: null, objetivosConfig: OBJETIVOS_POR_DEFECTO, clinicaNombre: null, sesion: { ...SESION_NUEVA, derivado: true } }).yaDerivado === true);

// ── La SESIÓN (11-09): lo que producción persiste entre turnos, el banco lo
//    arrastra. Sin modelo: se hace avanzar la sesión con evaluaciones mínimas
//    (lo que persistir-turno escribiría) y se mira la entrada del turno
//    siguiente — la misma entrada que vería producción tras leer su log.
const HOY = "2026-08-22";
const base = { escenario: { tipo: "al_dia" as const }, hilo: [], mensaje: "x", conocimiento: null, objetivosConfig: OBJETIVOS_POR_DEFECTO, clinicaNombre: null };
const aplaza = (clave: "plan_pago" | "duda_clinica", motivo: string) =>
  ({ decision: "sigue" as const, aplazamientos: [{ clave, motivo }], esperaHasta: null, esperaLevantar: false });
let s = avanzarSesion(SESION_NUEVA, aplaza("plan_pago", "quiere cuotas"), { instante: relojDelBanco(HOY, 0), entrante: "¿me lo dejáis en cuotas?" });
s = avanzarSesion(s, aplaza("plan_pago", "vuelve a preguntar (2ª vez)"), { instante: relojDelBanco(HOY, 2), entrante: "¿y las cuotas?" });
const e3 = construirEntradaDePrueba({ ...base, escenario: { tipo: "presupuesto" }, sesion: s, hoy: HOY });
ok("la sesión arrastra los aplazados: dos turnos que aplazan plan_pago → pendiente con dos motivos y DOS vueltas (el paso del banco supera la ventana de ráfaga)",
  e3.aplazadosPendientes.filter((a) => a.clave === "plan_pago").length === 2 && e3.aplazadosPorClave.plan_pago === 2);
ok("una emisión por clave y turno, como persistir-turno: el mismo tema dos veces en un turno cuenta una",
  avanzarSesion(SESION_NUEVA, { decision: "sigue", aplazamientos: [{ clave: "duda_clinica", motivo: "a" }, { clave: "duda_clinica", motivo: "b" }], esperaHasta: null, esperaLevantar: false }, { instante: relojDelBanco(HOY, 0), entrante: "x" }).aplazamientos.length === 1);
const conEspera = avanzarSesion(SESION_NUEVA, { decision: "sigue", aplazamientos: [], esperaHasta: "2026-08-25", esperaLevantar: false }, { instante: relojDelBanco(HOY, 0), entrante: "hablamos el lunes" });
const eEspera = construirEntradaDePrueba({ ...base, sesion: conEspera, hoy: HOY });
ok("la espera fijada en un turno es la espera VIGENTE del siguiente, con la frase como motivo, y no deriva",
  eEspera.esperaVigente?.hasta === "2026-08-25" && eEspera.esperaVigente?.motivo === "«hablamos el lunes»" && eEspera.yaDerivado === false);
ok("la espera vencida a «hoy» no se pasa (fecha inclusive, como el semáforo)",
  construirEntradaDePrueba({ ...base, sesion: conEspera, hoy: "2026-08-25" }).esperaVigente?.hasta === "2026-08-25" &&
    construirEntradaDePrueba({ ...base, sesion: conEspera, hoy: "2026-08-26" }).esperaVigente == null);
ok("levantar la espera la quita; derivar manda sobre ella (precedencia del semáforo)",
  avanzarSesion(conEspera, { decision: "sigue", aplazamientos: [], esperaHasta: null, esperaLevantar: true }, { instante: relojDelBanco(HOY, 2), entrante: "x" }).espera === null &&
    (() => { const e = construirEntradaDePrueba({ ...base, sesion: { ...conEspera, derivado: true }, hoy: HOY }); return e.yaDerivado === true && e.esperaVigente == null; })());
ok("el opt-out de un turno queda para los siguientes; un fallback no mueve nada",
  avanzarSesion(SESION_NUEVA, { decision: "sigue", aplazamientos: [], esperaHasta: null, esperaLevantar: false, pideNoContacto: true }, { instante: relojDelBanco(HOY, 0), entrante: "x" }).optOut === true &&
    avanzarSesion(s, { fallback: true, decision: "sigue", aplazamientos: [{ clave: "otro", motivo: "z" }], esperaHasta: null, esperaLevantar: false }, { instante: relojDelBanco(HOY, 4), entrante: "x" }) === s);

// ─── B · CERO ESCRITURA: foto de TODAS las tablas ──────────────────────────
console.log("\nB · cero escritura: recuentos + checksums antes/después de un turno REAL");

const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
await admin.connect();

const CLINICA_QA = "qa-banco-clinica";

/** Recuento de CADA tabla del esquema + checksum de las mutables clave. */
async function foto(): Promise<Map<string, string>> {
  const t: any = await admin.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const f = new Map<string, string>();
  for (const row of t.rows) {
    const tabla = String(row.table_name);
    if (tabla === "uso_banco_pruebas") continue; // la única que PUEDE cambiar
    const c: any = await admin.query(`select count(*)::bigint n from "${tabla}"`);
    f.set(tabla, String(c.rows[0].n));
  }
  // Checksums: los UPDATE no cambian recuentos — estas columnas mutables son
  // las que el flujo real de un entrante toca en producción.
  const sumas: Array<[string, string]> = [
    ["presupuestos#estado", `select coalesce(md5(string_agg(coalesce(estado,'∅') || coalesce(requiere_persona::text,'∅') || coalesce(intencion_detectada,'∅') || coalesce(contact_count::text,'∅'), ',' order by id)), 'vacia') s from presupuestos`],
    ["leads#estado", `select coalesce(md5(string_agg(coalesce(estado,'∅') || coalesce(whatsapp_enviados::text,'∅'), ',' order by id)), 'vacia') s from leads`],
    ["pacientes#estado", `select coalesce(md5(string_agg(coalesce(nombre,'∅') || coalesce(activo::text,'∅'), ',' order by id)), 'vacia') s from pacientes`],
    ["configuracion_automatizaciones#estado", `select coalesce(md5(string_agg(coalesce(conocimiento,'∅') || coalesce(evaluador_activo::text,'∅') || coalesce(toques_antes_de_agotar::text,'∅'), ',' order by id)), 'vacia') s from configuracion_automatizaciones`],
  ];
  for (const [clave, q] of sumas) {
    const r: any = await admin.query(q);
    f.set(clave, String(r.rows[0].s));
  }
  return f;
}

const antes = await foto();
console.log(`  (foto de ${antes.size} tablas/checksums tomada)`);

let resultado: Awaited<ReturnType<typeof probarTurno>> | null = null;
await runWithCliente("DEMO", async () => {
  resultado = await probarTurno({
    clinicaId: CLINICA_QA,
    clinicaNombre: "Clínica QA Banco",
    escenario: { tipo: "presupuesto", tratamiento: "Ortodoncia", importe: 2400 },
    hilo: [],
    mensaje: "Hola, ¿me podéis recordar cuánto era el presupuesto?",
    sesion: SESION_NUEVA,
  });
});
const evaluacion = resultado!.evaluacion;
if (evaluacion.fallback) {
  console.error("  ✗ el turno real cayó en FALLBACK (API/modelo) — no se pudo probar la regla dura sobre el flujo de verdad.");
  await admin.query(`delete from uso_banco_pruebas where clinica_id like 'qa-banco%'`);
  await admin.end();
  process.exit(2);
}
ok("el turno real corrió por el agente de producción (respuesta no vacía, sin fallback)",
  evaluacion.respuesta.trim() !== "");

const despues = await foto();
const cambiadas = [...antes.entries()].filter(([k, v]) => despues.get(k) !== v).map(([k]) => k);
ok(`NINGUNA tabla de producción cambió — ni recuento ni checksum (${antes.size} vigiladas)`,
  cambiadas.length === 0, cambiadas.join(", ") || "todas intactas");

const uso: any = await admin.query(
  `select turnos from uso_banco_pruebas where clinica_id = $1 and dia = current_date`,
  [CLINICA_QA],
);
ok("y la ÚNICA escritura del banco existe: su contador subió a 1 (etiquetado por origen)",
  Number(uso.rows?.[0]?.turnos) === 1);

// ─── C · El tope corta con su motivo ───────────────────────────────────────
console.log("\nC · el tope dice su motivo, no falla en silencio");

await admin.query(
  `insert into uso_banco_pruebas (cliente, clinica_id, dia, turnos)
   values ('DEMO', 'qa-banco-tope', current_date, $1)`,
  [TOPE_PRUEBAS_DIA],
);
let corte: unknown = null;
await runWithCliente("DEMO", async () => {
  try {
    await consumirTurnoDePrueba("qa-banco-tope");
  } catch (e) {
    corte = e;
  }
});
ok("al llegar al tope, corta con TopeDePruebasError (no un 500 anónimo)",
  corte instanceof TopeDePruebasError);
ok("y el motivo dice el número y cuándo se renueva (condición dictada)",
  corte instanceof Error && corte.message.includes(`${TOPE_PRUEBAS_DIA} mensajes de prueba de hoy`) &&
    corte.message.includes("se renuevan mañana"), corte instanceof Error ? corte.message : String(corte));
const trasTope: any = await admin.query(
  `select turnos from uso_banco_pruebas where clinica_id = 'qa-banco-tope' and dia = current_date`,
);
ok("el corte es atómico: el contador NO pasó del tope",
  Number(trasTope.rows?.[0]?.turnos) === TOPE_PRUEBAS_DIA);

await admin.query(`delete from uso_banco_pruebas where clinica_id like 'qa-banco%'`);
console.log("\n  ✓ contadores de prueba limpiados");
await admin.end();

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ el banco: agente real, cero escritura en producción, y un tope que se explica");
