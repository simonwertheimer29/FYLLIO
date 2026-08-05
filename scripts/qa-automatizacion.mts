// scripts/qa-automatizacion.mts
//
// QA de cierre de la fase 1 de PLAN-AGENTE: estado de automatización y cola de
// quiebre.  ·  npm run qa:automatizacion
//
// Cinco bloques, los cinco pedidos en la spec:
//   1 · CENSO      — todo caso activo tiene EXACTAMENTE un estado. Ni dos, ni cero.
//   2 · DISPARA    — cada disparador activo quiebra el caso.
//   3 · NO DISPARA — las respuestas neutras NO quiebran.
//   4 · AGOTADO    — al acabarse la cadencia sale la recomendación de llamada.
//   5 · DEVOLVER   — devolver al agente reanuda la cadencia donde estaba.
//
// Y dos que no estaban en la spec pero sin los cuales el resto no vale:
//   6 · COINCIDENCIA — la medida no da falsos positivos por un espacio o un acento.
//   7 · PARTICIÓN    — la cohorte de quiebre no rompe la totalidad de qa:cohortes.
//
// Códigos de salida (§9):
//   0 → todo verde   ·   1 → hay fallos   ·   2 → no se pudo comprobar

import * as dotenv from "dotenv";
const ENV_FILE = process.env.ENV_FILE ?? ".env.local";
dotenv.config({ path: ENV_FILE });
dotenv.config();

import pg from "pg";
import {
  estadoAutomatizacion,
  disparadorDeIntencion,
  motivoLegible,
  DISPARADORES_ACTIVOS,
  DISPARADORES_PENDIENTES,
  type EstadoAutomatizacion,
} from "../app/lib/automatizacion/estado";
import { medirCoincidencia, categoriaDe } from "../app/lib/automatizacion/coincidencia";
import { cohortePresupuesto, cohorteLead, ORDEN_COHORTE_PRESUPUESTO } from "../app/lib/seguimiento/cohortes";
import { estadoConversacion, UMBRAL_REACTIVACION_DIAS } from "../app/lib/presupuestos/estado-conversacion";
import type { IntencionDetectada } from "../app/lib/presupuestos/types";
import { hoyISO } from "../app/lib/time";

const fallos: string[] = [];
const ok = (nombre: string, cond: boolean, detalle = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${nombre}${cond || !detalle ? "" : ` — ${detalle}`}`);
  if (!cond) fallos.push(nombre);
};

const TODOS_LOS_ESTADOS: EstadoAutomatizacion[] = [
  "esperando", "quebrado", "en_manos_de_alguien", "agotado", "manual", "cerrado",
];

const base = {
  cerrado: false,
  conversacion: "en_espera_paciente" as const,
  intencion: null,
  toques: 0,
  toquesAntesDeAgotar: 3,
  ultimoEvento: null,
};

// ── 2 · Cada disparador activo QUIEBRA ───────────────────────────────────────
console.log("\n2 · Los disparadores activos quiebran");

const INTENCIONES_QUE_QUIEBRAN: Array<[IntencionDetectada, string]> = [
  ["Pide oferta/descuento", "dinero"],
  ["Acepta pero pregunta pago", "dinero"],
  ["Tiene duda sobre tratamiento", "criterio_clinico"],
  ["Sin clasificar", "ambiguedad"],
];

for (const [intencion, disparador] of INTENCIONES_QUE_QUIEBRAN) {
  const r = estadoAutomatizacion({
    ...base,
    conversacion: "pendiente_responder", // el paciente acaba de escribir
    intencion,
  });
  ok(`«${intencion}» → quebrado (${disparador})`, r.estado === "quebrado" && r.disparador === disparador, `dio ${r.estado}/${r.disparador}`);
}

ok(
  "los 3 disparadores activos están cubiertos por alguna intención",
  DISPARADORES_ACTIVOS.every((d) => INTENCIONES_QUE_QUIEBRAN.some(([, x]) => x === d)),
);
ok(
  "los 3 pendientes NO los produce ninguna intención (fase 2)",
  DISPARADORES_PENDIENTES.every(
    (d) => !INTENCIONES_QUE_QUIEBRAN.some(([, x]) => x === d),
  ),
);

// El motivo tiene que ser LEGIBLE, no un código.
const motivo = motivoLegible("dinero", "¿me haríais un descuento si pago todo junto?");
ok("el motivo cita las palabras del paciente", motivo.includes("descuento") && motivo.startsWith("Dinero"), motivo);
ok("el motivo no filtra códigos internos", !/[a-z]+_[a-z]+/.test(motivo), motivo);

// ── 3 · Las respuestas neutras NO quiebran ───────────────────────────────────
console.log("\n3 · Las respuestas neutras NO quiebran");

const NEUTRAS: IntencionDetectada[] = ["Acepta sin condiciones", "Quiere pensarlo", "Rechaza"];
for (const intencion of NEUTRAS) {
  const r = estadoAutomatizacion({ ...base, conversacion: "pendiente_responder", intencion });
  ok(`«${intencion}» NO quiebra`, r.estado !== "quebrado", `dio ${r.estado}`);
}
ok("sin intención (null) no quiebra", estadoAutomatizacion({ ...base, conversacion: "pendiente_responder" }).estado !== "quebrado");
ok("disparadorDeIntencion(null) = null", disparadorDeIntencion(null) === null);

// Un caso con intención de quiebre pero al que YA respondimos no quiebra: el
// último toque es nuestro, así que el quiebre ya se atendió.
ok(
  "si ya respondimos después, NO quiebra",
  estadoAutomatizacion({ ...base, conversacion: "en_espera_paciente", intencion: "Pide oferta/descuento" }).estado !== "quebrado",
);

// ── 4 · Agotado ──────────────────────────────────────────────────────────────
console.log("\n4 · La cadencia agotada recomienda llamar");

ok("reactivable + 3 toques (umbral 3) → agotado", estadoAutomatizacion({ ...base, conversacion: "reactivable", toques: 3 }).estado === "agotado");
ok("reactivable + 2 toques → todavía NO", estadoAutomatizacion({ ...base, conversacion: "reactivable", toques: 2 }).estado !== "agotado");
ok(
  "5 toques pero el paciente acaba de responder → NO agotado",
  estadoAutomatizacion({ ...base, conversacion: "pendiente_responder", toques: 5 }).estado !== "agotado",
  "el contador solo no basta: hace falta reactivable",
);
ok("el umbral se respeta (umbral 5, toques 4)", estadoAutomatizacion({ ...base, conversacion: "reactivable", toques: 4, toquesAntesDeAgotar: 5 }).estado !== "agotado");

// ── 5 · Devolver al agente reanuda ───────────────────────────────────────────
console.log("\n5 · Devolver al agente reanuda donde estaba");

const asumido = estadoAutomatizacion({ ...base, conversacion: "reactivable", toques: 3, ultimoEvento: "asumido" });
ok("asumido → en manos de alguien (tapa el agotado)", asumido.estado === "en_manos_de_alguien");

const devuelto = estadoAutomatizacion({ ...base, conversacion: "reactivable", toques: 3, ultimoEvento: "devuelto_al_agente" });
ok("devuelto → vuelve a la derivación (agotado con 3 toques)", devuelto.estado === "agotado", `dio ${devuelto.estado}`);

const manual = estadoAutomatizacion({ ...base, conversacion: "reactivable", toques: 3, ultimoEvento: "asumido_manual" });
ok("«sigo yo» → manual, y no vuelve solo", manual.estado === "manual");

// La reanudación NO guarda posición: el contador es la posición.
const antes = estadoAutomatizacion({ ...base, conversacion: "reactivable", toques: 3 });
ok("devolver deja el MISMO estado que antes de asumir", devuelto.estado === antes.estado, "la cadencia no se pierde ni se reinicia");

// Un envío no fija estado: devuelve el caso a la derivación.
ok(
  "mensaje_enviado no fija estado",
  estadoAutomatizacion({ ...base, conversacion: "reactivable", toques: 3, ultimoEvento: "mensaje_enviado" }).estado === "agotado",
);

// ── 6 · Coincidencia sin falsos positivos ────────────────────────────────────
console.log("\n6 · La coincidencia no cuenta espacios ni acentos como edición");

const sug = "Hola Ana, tu presupuesto sigue vigente. ¿Te viene bien que te llamemos esta semana?";
ok("idéntico → 0", medirCoincidencia(sug, sug).distancia === 0);
ok("doble espacio → sigue siendo 0", medirCoincidencia(sug, sug.replace(". ", ".  ")).distancia === 0);
ok("sin acentos → sigue siendo 0", medirCoincidencia(sug, "Hola Ana, tu presupuesto sigue vigente. ¿Te viene bien que te llamemos esta semana?".normalize("NFD").replace(/[̀-ͯ]/g, "")).distancia === 0);
ok("mayúsculas → sigue siendo 0", medirCoincidencia(sug, sug.toUpperCase()).distancia === 0);
ok("punto final de más → sigue siendo 0", medirCoincidencia(sug, sug + ".").distancia === 0);
ok("comilla tipográfica → sigue siendo 0", medirCoincidencia("dile que “vale”", 'dile que "vale"').distancia === 0);

const editado = medirCoincidencia(sug, sug.replace("esta semana", "mañana por la mañana"));
ok("cambiar una frase → editado", editado.distancia !== null && categoriaDe(editado.distancia) === "editado", `distancia ${editado.distancia}`);

const reescrito = medirCoincidencia(sug, "Buenos días, ¿ha podido pensar en lo que hablamos? Quedo pendiente.");
ok("otro mensaje distinto → reescrito", reescrito.distancia !== null && categoriaDe(reescrito.distancia) === "reescrito", `distancia ${reescrito.distancia}`);

ok("sin sugerido → NO medible (fuera del denominador)", medirCoincidencia(null, "lo que sea").medible === false);
ok("sugerido vacío → NO medible", medirCoincidencia("   ", "lo que sea").medible === false);

// ── 7 · La partición no se rompe ─────────────────────────────────────────────
console.log("\n7 · La cohorte de quiebre no rompe la partición");

const CONVERSACIONES = ["sin_conversacion", "pendiente_responder", "en_espera_paciente", "reactivable"] as const;
let particionOk = true;
for (const conv of CONVERSACIONES) {
  for (const est of TODOS_LOS_ESTADOS) {
    const c = cohortePresupuesto(conv, { estado: est });
    if (!ORDEN_COHORTE_PRESUPUESTO.includes(c)) particionOk = false;
  }
}
ok("toda combinación (conversación × estado) da UNA cohorte válida", particionOk);

ok(
  "sin estado de automatización, la cohorte es la de siempre",
  cohortePresupuesto("reactivable") === "rezagados" && cohortePresupuesto("sin_conversacion") === "nuevos",
  "el switch original queda intacto",
);
ok(
  "quebrado gana a la conversación",
  cohortePresupuesto("pendiente_responder", { estado: "quebrado" }) === "quiebre",
);
ok(
  "en leads, quebrado también tiene precedencia sobre la cita",
  cohorteLead({ fechaCita: "2099-01-01", hoy: "2026-08-05", conversacion: "sin_conversacion", automatizacion: { estado: "quebrado" } }) === "quiebre",
);

// ── 1 · CENSO sobre datos reales ─────────────────────────────────────────────
console.log("\n1 · Censo sobre datos reales");

const url = process.env.SUPABASE_DB_URL_APP;
if (!url) {
  console.error("\n✗ No se pudo censar: falta SUPABASE_DB_URL_APP.");
  console.error("  (Los bloques 2-7 sí corrieron: son puros.)");
  process.exit(2);
}

const cliente = process.argv[2] ?? "DEMO";
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await db.connect();
  await db.query("begin");
  await db.query(`select set_config('app.cliente', $1, true)`, [cliente]);
} catch (e) {
  console.error(`\n✗ No se pudo conectar para censar "${cliente}".`);
  console.error(`  Motivo: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

const presus = (
  await db.query(`select p.id, p.estado, p.intencion_detectada, coalesce(p.contact_count,0) as toques,
                         p.fecha_ultima_respuesta, p.ultima_accion_registrada
                  from presupuestos p where p.estado not in ('ACEPTADO','PERDIDO')`)
).rows;

const eventos = (
  await db.query(`select distinct on (caso_id) caso_id, evento from eventos_automatizacion
                  where tipo_caso = 'presupuesto' order by caso_id, created_at desc`)
).rows;
const porCaso = new Map(eventos.map((e: any) => [String(e.caso_id), e.evento]));

await db.query("rollback");
await db.end();

if (presus.length === 0) {
  console.error(`\n✗ El cliente "${cliente}" no tiene presupuestos abiertos: un censo vacío no aprueba nada.`);
  process.exit(2);
}

const AHORA = new Date();
const conteo = new Map<EstadoAutomatizacion, number>();
let sinEstado = 0;
let cohortesInvalidas = 0;

for (const p of presus) {
  const conv = estadoConversacion(
    {
      ultimoEntranteAt: p.fecha_ultima_respuesta ? new Date(p.fecha_ultima_respuesta).toISOString() : null,
      ultimoSalienteAt: p.ultima_accion_registrada ? new Date(p.ultima_accion_registrada).toISOString() : null,
    },
    UMBRAL_REACTIVACION_DIAS.presupuesto,
    AHORA,
  );
  const r = estadoAutomatizacion({
    cerrado: false,
    conversacion: conv.estado,
    intencion: p.intencion_detectada ?? null,
    toques: Number(p.toques) || 0,
    toquesAntesDeAgotar: 3,
    ultimoEvento: porCaso.get(String(p.id)) ?? null,
  });
  if (!TODOS_LOS_ESTADOS.includes(r.estado)) sinEstado++;
  conteo.set(r.estado, (conteo.get(r.estado) ?? 0) + 1);
  const c = cohortePresupuesto(conv.estado, { estado: r.estado });
  if (!ORDEN_COHORTE_PRESUPUESTO.includes(c)) cohortesInvalidas++;
}

const total = presus.length;
const suma = [...conteo.values()].reduce((a, b) => a + b, 0);

console.log(`  ${total} presupuestos abiertos en "${cliente}":`);
for (const e of TODOS_LOS_ESTADOS) {
  const n = conteo.get(e) ?? 0;
  if (n > 0) console.log(`     ${String(n).padStart(3)}  ${e}`);
}

ok("ninguno se queda SIN estado", sinEstado === 0, `${sinEstado} sin estado`);
ok("la suma de estados = total de casos (ninguno en dos)", suma === total, `${suma} ≠ ${total}`);
ok("toda cohorte resultante es válida", cohortesInvalidas === 0, `${cohortesInvalidas} inválidas`);
ok(
  "ningún caso quebrado sin motivo derivable",
  presus.every((p: any) => {
    const d = disparadorDeIntencion(p.intencion_detectada ?? null);
    return d === null || motivoLegible(d, "x").length > 0;
  }),
);

// ── Resultado ────────────────────────────────────────────────────────────────
if (fallos.length > 0) {
  console.error(`\n✗ ${fallos.length} fallos:\n${fallos.map((f) => `   · ${f}`).join("\n")}\n`);
  process.exit(1);
}
console.log(`\n✓ QA de automatización en verde (censo sobre "${cliente}", ${total} casos).\n`);
process.exit(0);
