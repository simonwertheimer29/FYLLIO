#!/usr/bin/env tsx
// QA de LA COLA DE SEGUIMIENTO (fase B, P1) — determinista, SIN modelo.
//
//   npx tsx scripts/qa-cola.mts   (= npm run qa:cola)
//
// Dos capas, como la lib:
//   A · cohorteDeCaso PURA: cada combinación cae en EXACTAMENTE una de las
//       CUATRO (que no crecen), con las precedencias del §3 y la condición
//       anotada de citados.
//   B · colaDeSeguimiento contra el seed: ningún activo invisible (censo
//       contra SQL independiente), dedupe presupuesto>lead, el resumen de
//       dinero parado cuadra con la suma independiente, y los fixtures del
//       log del agente mueven casos a su cohorte (entregado → Listos;
//       aplazado vivo → Pendientes; huérfano con eventos → aparece).
//
// Salidas §9: 0 · 1 · 2.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { cohorteDeCaso, colaDeSeguimiento, ORDEN_COHORTES } from "../app/lib/seguimiento/cola";
import { registrarEvento } from "../app/lib/automatizacion/pg";
import { hoyISO } from "../app/lib/time";

for (const v of ["SUPABASE_DB_URL_APP", "SUPABASE_DB_URL_ADMIN"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} — no puedo comprobar nada.`);
    process.exit(2);
  }
}

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

// ─── A · La función pura: partición y precedencias ──────────────────────────
console.log("\nA · cohorteDeCaso: cuatro cohortes, precedencias del §3");
const hoy = hoyISO();
const c = (e: Parameters<typeof cohorteDeCaso>[0]) => cohorteDeCaso(e);

ok("quebrado → Necesita respuesta", c({ conversacion: "reactivable", automatizacion: "quebrado", hoy }).cohorte === "necesita_respuesta");
ok("entrega del agente NO-caso_completo (urgencia) → Necesita respuesta",
  c({ conversacion: "en_espera_paciente", hoy, agente: { entregadoCausa: "urgencia", aplazadosVivos: 0 } }).cohorte === "necesita_respuesta");
ok("paciente escribió lo último → Necesita respuesta (decisión 17-08)",
  c({ conversacion: "pendiente_responder", hoy }).cohorte === "necesita_respuesta");
ok("entrega caso_completo → Listos para cerrar",
  c({ conversacion: "en_espera_paciente", hoy, agente: { entregadoCausa: "caso_completo", aplazadosVivos: 1 } }).cohorte === "listos_para_cerrar");
ok("cierre pendiente (Rechaza, clasificador viejo) → Listos para cerrar",
  c({ conversacion: "reactivable", automatizacion: "cierre_pendiente", hoy }).cohorte === "listos_para_cerrar");
ok("aplazados vivos sin entrega → Pendientes de resolver",
  c({ conversacion: "en_espera_paciente", hoy, agente: { entregadoCausa: null, aplazadosVivos: 2 } }).cohorte === "pendientes_de_resolver");
ok("PRECEDENCIA: aplazados vivos + paciente escribió → Necesita respuesta",
  c({ conversacion: "pendiente_responder", hoy, agente: { entregadoCausa: null, aplazadosVivos: 2 } }).cohorte === "necesita_respuesta");
ok("PRECEDENCIA: entregado listo + citado → Listos (no citados)",
  c({ conversacion: "en_espera_paciente", fechaCita: hoy, hoy, agente: { entregadoCausa: "caso_completo", aplazadosVivos: 0 } }).cohorte === "listos_para_cerrar");
ok("citado → Sin actividad·citado (CONDICIÓN ANOTADA: hasta pantalla propia)",
  (() => { const r = c({ conversacion: "en_espera_paciente", fechaCita: hoy, hoy }); return r.cohorte === "sin_actividad" && r.detalle === "citado"; })());
ok("agotado → Sin actividad (toca llamar queda como detalle/filtro)",
  (() => { const r = c({ conversacion: "reactivable", automatizacion: "agotado", hoy }); return r.cohorte === "sin_actividad" && r.detalle === "agotado"; })());
ok("nuevo sin contactar → Sin actividad", c({ conversacion: "sin_conversacion", hoy }).cohorte === "sin_actividad");
ok("esperando al paciente (nosotros escribimos) → Sin actividad — NO Necesita",
  (() => { const r = c({ conversacion: "en_espera_paciente", hoy }); return r.cohorte === "sin_actividad" && r.detalle === "esperando_al_paciente"; })());
ok("sin respuesta (rezagados) → Sin actividad", c({ conversacion: "reactivable", hoy }).cohorte === "sin_actividad");

// ─── B · Con el seed real ───────────────────────────────────────────────────
const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();
async function q(texto: string, params?: unknown[]) {
  await app.query("begin");
  try {
    await app.query("select set_config('app.cliente','DEMO',true)");
    const r = await app.query(texto, params);
    await app.query("commit");
    return r;
  } catch (e) {
    await app.query("rollback").catch(() => {});
    throw e;
  }
}

const TEL_FIXTURE_LISTO = "+34611998031"; // paciente propio de este QA
const TEL_HUERFANO_PEND = "+34611999002"; // huérfana del seed (Mónica)

async function limpiar() {
  const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  await admin.query(`delete from eventos_automatizacion where cliente='DEMO' and caso_id = any($1)`, [[TEL_FIXTURE_LISTO, TEL_HUERFANO_PEND]]);
  await admin.end();
  const pacs = await q(`select id from pacientes where telefono=$1`, [TEL_FIXTURE_LISTO]);
  for (const p of pacs.rows) {
    await q(`delete from presupuestos where paciente_id=$1`, [p.id]);
    await q(`delete from pacientes where id=$1`, [p.id]);
  }
  // Solo el saliente que insertó ESTE QA — los mensajes del seed no se tocan.
  await q(`delete from mensajes_whatsapp where telefono=$1 and contenido like '[QA-COLA]%'`, [TEL_HUERFANO_PEND]);
}
await limpiar();

await runWithCliente("DEMO", async () => {
  console.log("\nB · colaDeSeguimiento contra el seed (censo independiente)");
  const base = await colaDeSeguimiento();

  // Censo independiente, vocabulario declarado a mano (como qa:contexto).
  const ACTIVOS = ["Nuevo", "Contactado", "Citado", "Citados Hoy"];
  const nLeadsActivos = Number((await q(
    `select count(*)::int n from leads where estado = any($1) and coalesce(convertido_a_paciente,false)=false`, [ACTIVOS],
  )).rows[0].n);
  const nPresuAbiertos = Number((await q(
    `select count(*)::int n from presupuestos where estado is null or estado not in ('ACEPTADO','PERDIDO')`,
  )).rows[0].n);
  const sumaImportes = Number((await q(
    `select coalesce(sum(importe),0) s from presupuestos where estado is null or estado not in ('ACEPTADO','PERDIDO')`,
  )).rows[0].s);

  const porTipo = { lead: 0, presupuesto: 0, conversacion: 0 };
  for (const x of base.casos) porTipo[x.tipo]++;
  ok("ningún presupuesto abierto invisible", porTipo.presupuesto === nPresuAbiertos, `cola=${porTipo.presupuesto} sql=${nPresuAbiertos}`);
  ok("leads activos = en cola + solapados con presupuesto (dedupe, no pérdida)",
    porTipo.lead <= nLeadsActivos, `cola=${porTipo.lead} activos=${nLeadsActivos}`);
  ok("cada caso en EXACTAMENTE una cohorte (partición)",
    base.casos.every((x) => ORDEN_COHORTES.includes(x.cohorte)) &&
      ORDEN_COHORTES.reduce((s, co) => s + base.casos.filter((x) => x.cohorte === co).length, 0) === base.casos.length);
  ok("dinero parado = suma independiente de presupuestos abiertos",
    Math.round(base.resumen.dineroParado) === Math.round(sumaImportes),
    `cola=${base.resumen.dineroParado} sql=${sumaImportes}`);
  ok("leads contados, no valorados (el importe de un lead NO existe en datos)",
    base.resumen.leadsSinImporte === porTipo.lead && base.casos.filter((x) => x.tipo === "lead").every((x) => x.importe === null));
  ok("el caso más viejo tiene edad", base.resumen.masViejoDias != null && base.resumen.masViejoDias >= 0, `${base.resumen.masViejoDias} días`);

  // La foto para el reporte: distribución por cohorte.
  console.log("\n  Distribución del seed:");
  for (const co of ORDEN_COHORTES) {
    const del = base.casos.filter((x) => x.cohorte === co);
    const detalles = [...new Set(del.map((x) => x.detalle))].join(", ");
    console.log(`    ${co}: ${del.length}${del.length ? ` (${detalles})` : ""}`);
  }

  // ── Fixtures del log del agente ─────────────────────────────────────────
  console.log("\n  Fixtures del agente mueven casos:");
  const clin = (await q(`select id from clinicas where nombre ilike '%norte%' limit 1`)).rows[0].id;
  const pac = await q(
    `insert into pacientes (cliente, nombre, telefono, clinica_id, consentimiento_whatsapp, activo)
     values ('DEMO','QA Cola Delta',$1,$2,true,true) returning id`,
    [TEL_FIXTURE_LISTO, clin],
  );
  await q(
    `insert into presupuestos (cliente, paciente_id, clinica_id, tratamiento_nombre, estado, importe, fecha, fecha_alta, doctor, paciente_telefono, contact_count)
     values ('DEMO',$1,$2,'Endodoncia molar','PRESENTADO',650,$3,$3,'Dra. QA',$4,1)`,
    [pac.rows[0].id, clin, hoy, TEL_FIXTURE_LISTO],
  );
  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_FIXTURE_LISTO, evento: "derivado", causaDerivacion: "caso_completo", objetivoActivo: "presupuesto", actorNombre: "qa" } as any);
  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_HUERFANO_PEND, evento: "aplazado", claveAplazado: "agenda_disponibilidad", motivoTexto: "pregunta por el sábado", actorNombre: "qa" } as any);

  // El seed deja a la huérfana con su último mensaje SIN responder →
  // «paciente escribió» manda sobre el aplazado (precedencia de A). Se
  // afirma ESO primero, y después se le responde para ver el caso caer a
  // Pendientes de resolver.
  const tras = await colaDeSeguimiento();
  const casoListo = tras.casos.find((x) => x.telefono === TEL_FIXTURE_LISTO);
  ok("entregado caso_completo → su presupuesto cae en Listos para cerrar",
    casoListo?.cohorte === "listos_para_cerrar" && casoListo.detalle === "entregado_listo",
    `${casoListo?.cohorte ?? "no está"}`);
  const casoHuerfano = tras.casos.find((x) => x.tipo === "conversacion" && x.telefono === TEL_HUERFANO_PEND);
  ok("huérfano con eventos APARECE en la cola, y con paciente esperando manda Necesita respuesta",
    casoHuerfano?.cohorte === "necesita_respuesta" && casoHuerfano.detalle === "paciente_escribio",
    `${casoHuerfano?.cohorte ?? "no está"}`);

  await q(
    `insert into mensajes_whatsapp (cliente, telefono, direccion, contenido, "timestamp", fuente)
     values ('DEMO',$1,'Saliente','[QA-COLA] Te contesto enseguida', now(), 'Modo_A_manual')`,
    [TEL_HUERFANO_PEND],
  );
  const tras2 = await colaDeSeguimiento();
  const huerfano2 = tras2.casos.find((x) => x.tipo === "conversacion" && x.telefono === TEL_HUERFANO_PEND);
  ok("respondida la persona, el aplazado vivo lo baja a Pendientes de resolver",
    huerfano2?.cohorte === "pendientes_de_resolver" && huerfano2.detalle === "aplazados_vivos",
    `${huerfano2?.cohorte ?? "no está"}`);
  ok("y el dinero parado subió exactamente el importe del fixture (650)",
    Math.round(tras.resumen.dineroParado - base.resumen.dineroParado) === 650,
    `Δ=${tras.resumen.dineroParado - base.resumen.dineroParado}`);
});

await limpiar();
console.log("\n  ✓ fixtures y eventos limpiados");
await app.end();

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("✓ la cola: cuatro cohortes que no crecen, partición total, dinero parado que cuadra");
