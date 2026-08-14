#!/usr/bin/env tsx
// QA de la persistencia del turno (fase A, paso 4).
//
//   npx tsx scripts/qa-persistir-turno.mts   (= npm run qa:turno)
//
// Ejercita persistirTurno() contra el DEMO real:
//   1. Un turno emite sus eventos (aplazados + derivado + evaluacion) y el
//      payload se relee ÍNTEGRO (roundtrip).
//   2. LA PRUEBA QUE MÁS DUELE, nominal y explícita: la DOBLE ENTREGA del
//      mismo mensaje NO suma un segundo aplazado de la misma clave. El
//      contador de insistencia decide derivaciones — un duplicado derivaría
//      un caso que no tocaba.
//   3. Un mensaje DISTINTO que re-pregunta SÍ suma (el contador crece cuando
//      debe, no es que nunca crezca).
//   4. Proyección compat sobre un presupuesto real: escribe, se comprueba, y
//      se RESTAURA el estado original.
//   5. Fallback: sin eventos, solo la vía compat.
//
// Limpieza: los eventos de QA se borran con la URL ADMIN (la tabla es
// append-only para fyllio_app a propósito — un log que la app puede borrar
// no es un log). Salidas §9: 0 ok · 1 invariante rota · 2 no se pudo.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { persistirTurno } from "../app/lib/agente/persistir-turno";
import type { EvaluacionTurno } from "../app/lib/agente/evaluador";

const TEL = "+34600000099"; // teléfono de QA: no existe en el seed
const MSG1 = "qa_turno_msg_0001";
const MSG2 = "qa_turno_msg_0002";

for (const v of ["SUPABASE_DB_URL_APP", "SUPABASE_DB_URL_ADMIN"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} — no puedo comprobar nada.`);
    process.exit(2);
  }
}

const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();
await app.query("select set_config('app.cliente','DEMO',false)");
if ((await app.query("select current_setting('app.cliente', true) c")).rows[0].c !== "DEMO") {
  console.error("✗ contexto no es DEMO");
  process.exit(2);
}

let fallos = 0;
const ok = (nombre: string, cond: boolean, extra = "") => {
  console.log(`  ${cond ? "✓" : "✗ FALLO"} ${nombre}${extra ? " — " + extra : ""}`);
  if (!cond) fallos++;
};
const eventos = async (where = "") =>
  (await app.query(`select evento, clave_aplazado, causa_derivacion, malestar, evaluacion_json, mensaje_id
                      from eventos_automatizacion where caso_id = $1 ${where} order by created_at`, [TEL])).rows;

async function limpiar() {
  const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  const del = await admin.query(`delete from eventos_automatizacion where caso_id = $1 and cliente = 'DEMO'`, [TEL]);
  await admin.end();
  return del.rowCount ?? 0;
}
await limpiar(); // por si un run anterior murió a medias

const evalBase: EvaluacionTurno = {
  actuar: true,
  decision: "deriva",
  causa: "peticion_queja",
  cola: "prioritaria",
  malestar: true,
  juicios: {
    tema: "presupuesto",
    peticionOQueja: true,
    malestar: true,
    urgenciaMedica: false,
    mencionaAntecedenteMedico: false,
    vuelveSobreAplazado: null,
  },
  objetivoActivo: "presupuesto",
  aplazamientos: [
    { clave: "precio_descuento", motivo: "[QA] pregunta si hay descuento" },
    { clave: "duda_clinica", motivo: "[QA] pregunta si duele" },
  ],
  camposRecogidos: { presupuesto: { decision: "se lo piensa", que_le_frena: "el precio" } },
  camposFaltantes: ["cuando_retomar"],
  casoCompleto: false,
  respuesta: "[QA] Te lo confirma un asesor enseguida.",
  hiloTruncado: true,
  fallback: false,
  borradorDescartado: { motivo: "clinica", frase: "[QA] no duele nada" },
};

await runWithCliente("DEMO", async () => {
  // ── 1 · Primer turno: emite y el payload hace roundtrip ──────────────────
  console.log("\n1 · Un turno emite sus eventos y el payload se relee íntegro");
  const r1 = await persistirTurno({ telefono: TEL, mensajeId: MSG1, respuestaPaciente: "¿Me haríais descuento? ¿Y duele?", evaluacion: evalBase });
  ok("emite 4 eventos nuevos (2 aplazados + derivado + evaluacion)", r1.eventosNuevos === 4, `nuevos=${r1.eventosNuevos}`);
  let rows = await eventos();
  ok("en la base hay exactamente 4", rows.length === 4, `hay=${rows.length}`);
  const evalRow = rows.find((r) => r.evento === "evaluacion");
  const payload = evalRow ? JSON.parse(evalRow.evaluacion_json) : null;
  ok("payload: juicios íntegros", payload?.tema === "presupuesto" && payload?.malestar === true && payload?.hiloTruncado === true);
  ok("payload: campos recogidos y borrador descartado viajan", payload?.camposRecogidos?.presupuesto?.decision === "se lo piensa" && payload?.borradorDescartado?.motivo === "clinica");
  ok("payload: la respuesta (borrador) viaja — la necesita la fase C", payload?.respuesta?.includes("asesor"));
  const der = rows.find((r) => r.evento === "derivado");
  ok("derivado guarda el HECHO (causa + malestar), no la cola", der?.causa_derivacion === "peticion_queja" && der?.malestar === true);

  // ── 2 · LA PRUEBA EXPLÍCITA: doble entrega del mismo mensaje ─────────────
  console.log("\n2 · DOBLE ENTREGA del mismo mensaje (la que decide derivaciones)");
  const r2 = await persistirTurno({ telefono: TEL, mensajeId: MSG1, respuestaPaciente: "¿Me haríais descuento? ¿Y duele?", evaluacion: evalBase });
  ok("la reentrega se declara como tal y no emite nada", r2.reentrega === true && r2.eventosNuevos === 0);
  const aplazadosDescuento = (await eventos(`and evento='aplazado' and clave_aplazado='precio_descuento'`)).length;
  ok(
    "doble entrega del mismo mensaje NO suma un segundo aplazado de la misma clave (el contador de insistencia decide derivaciones)",
    aplazadosDescuento === 1,
    `count(aplazado, precio_descuento)=${aplazadosDescuento}`,
  );
  ok("tampoco duplica la derivación ni la evaluación", (await eventos()).length === 4);

  // ── 3 · Un mensaje DISTINTO sí suma (el contador crece cuando debe) ──────
  console.log("\n3 · Mensaje distinto que re-pregunta: el contador crece");
  await persistirTurno({
    telefono: TEL, mensajeId: MSG2, respuestaPaciente: "¿Sabéis ya lo del descuento?",
    evaluacion: { ...evalBase, decision: "sigue", causa: undefined, cola: undefined, malestar: undefined,
      aplazamientos: [{ clave: "precio_descuento", motivo: "[QA] vuelve a preguntar (2ª vez)" }] },
  });
  const trasMsg2 = (await eventos(`and evento='aplazado' and clave_aplazado='precio_descuento'`)).length;
  ok("con mensaje nuevo, count(aplazado, precio_descuento) = 2", trasMsg2 === 2, `count=${trasMsg2}`);

  // ── 4 · Proyección compat sobre un presupuesto real, y restaurar ─────────
  console.log("\n4 · Proyección compat (copia con fecha de muerte: fase B)");
  const presu = (await app.query(
    `select id, requiere_persona, motivo_quiebre, mensaje_sugerido, urgencia_intervencion,
            accion_sugerida, ultima_respuesta_paciente, fecha_ultima_respuesta, fase_seguimiento
       from presupuestos where estado not in ('ACEPTADO','PERDIDO') limit 1`,
  )).rows[0];
  if (!presu) {
    console.error("✗ no hay presupuesto abierto en DEMO para probar compat — no puedo comprobar");
    fallos++;
  } else {
    await persistirTurno({
      telefono: TEL, mensajeId: "qa_turno_msg_0003", respuestaPaciente: "[QA] mensaje compat",
      evaluacion: evalBase, presupuestoId: presu.id,
    });
    const tras = (await app.query(`select requiere_persona, urgencia_intervencion, mensaje_sugerido from presupuestos where id=$1`, [presu.id])).rows[0];
    ok("deriva → requiere_persona=true y urgencia por cola (prioritaria→CRÍTICO)", tras.requiere_persona === true && tras.urgencia_intervencion === "CRÍTICO");
    ok("al derivar por queja, el sugerido queda VACÍO (no se invita a mandarlo)", (tras.mensaje_sugerido ?? "") === "");
    await app.query(
      `update presupuestos set requiere_persona=$2, motivo_quiebre=$3, mensaje_sugerido=$4, urgencia_intervencion=$5,
              accion_sugerida=$6, ultima_respuesta_paciente=$7, fecha_ultima_respuesta=$8, fase_seguimiento=$9 where id=$1`,
      [presu.id, presu.requiere_persona, presu.motivo_quiebre, presu.mensaje_sugerido, presu.urgencia_intervencion,
       presu.accion_sugerida, presu.ultima_respuesta_paciente, presu.fecha_ultima_respuesta, presu.fase_seguimiento],
    );
    const restaurado = (await app.query(`select requiere_persona from presupuestos where id=$1`, [presu.id])).rows[0];
    ok("estado del presupuesto restaurado", restaurado.requiere_persona === presu.requiere_persona);
  }

  // ── 5 · Fallback: sin eventos ────────────────────────────────────────────
  console.log("\n5 · Fallback (el modelo no respondió): sin eventos al log");
  const antes = (await eventos()).length;
  await persistirTurno({
    telefono: TEL, mensajeId: "qa_turno_msg_0004", respuestaPaciente: "[QA] x",
    evaluacion: { ...evalBase, fallback: true, decision: "sigue", causa: undefined, aplazamientos: [], juicios: undefined },
  });
  ok("un turno en fallback no emite eventos (no hubo juicio)", (await eventos()).length === antes);
});

const borrados = await limpiar();
console.log(`\n  ✓ limpieza (admin): ${borrados} evento(s) de QA borrados`);
await app.end();

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("✓ persistencia del turno: idempotente, íntegra y con compat restaurable");
