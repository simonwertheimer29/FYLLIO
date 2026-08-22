#!/usr/bin/env tsx
// QA de LA COLA DE SEGUIMIENTO (fase B, P1 — TRES cohortes, delta 18-08) —
// determinista, SIN modelo.
//
//   npx tsx scripts/qa-cola.mts   (= npm run qa:cola)
//
// Tres capas, como la lib:
//   A · minutosLaborablesEntre PURA: el reloj de Fuera de plazo no corre de
//       noche ni en fin de semana (días de riesgo fijados a mano).
//   B · cohorteDeCaso PURA: solo entra lo que exige PERSONA; lo demás es
//       null (Mensajería/Envíos/Tablas). Fuera de plazo = escalada por
//       umbral con reloj INYECTADO (§14), conservando el detalle.
//   C · colaDeSeguimiento contra el seed: partición sobre las tres, dinero
//       parado = SOLO lo que espera persona, y los fixtures del log mueven
//       casos (entregado → Listos; aplazado sin entrega → FUERA de la cola).
//
// Salidas §9: 0 · 1 · 2.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { DateTime } from "luxon";
import { runWithCliente } from "../app/lib/airtable";
import {
  cohorteDeCaso,
  colaDeSeguimiento,
  ORDEN_COHORTES,
  UMBRAL_FUERA_DE_PLAZO_MIN,
  type EntradaCohorte,
  type RelojDePlazos,
} from "../app/lib/seguimiento/cola";
import { minutosLaborablesEntre } from "../app/lib/seguimiento/tiempo-laborable";
import { elegirPresupuestoActivo } from "../app/lib/seguimiento/presupuesto-activo";
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

// ─── A · El reloj laborable (horario default: L-V 09:00–20:00) ─────────────
console.log("\nA · minutosLaborablesEntre: el reloj no corre de noche ni en finde");

const Z = "Europe/Madrid";
const lunes = DateTime.fromISO("2026-08-10T00:00", { zone: Z });
if (lunes.weekday !== 1) {
  // Sonda (§9): si la fecha ancla no es lunes, todo lo demás mentiría.
  console.error("✗ 2026-08-10 no es lunes en esta zona — QA mal anclado.");
  process.exit(2);
}
const d = (dia: number, hora: string) => lunes.plus({ days: dia }).set({
  hour: Number(hora.split(":")[0]), minute: Number(hora.split(":")[1]),
}).toJSDate();

ok("mismo día laborable: mié 10:00 → 12:30 = 150",
  minutosLaborablesEntre(d(2, "10:00"), d(2, "12:30")) === 150);
ok("cruza la noche: mié 19:30 → jue 09:30 = 60 (30 antes del cierre + 30 tras abrir)",
  minutosLaborablesEntre(d(2, "19:30"), d(3, "09:30")) === 60);
ok("cruza el fin de semana: vie 19:00 → lun 09:30 = 90",
  minutosLaborablesEntre(d(4, "19:00"), d(7, "09:30")) === 90);
ok("todo fuera de horario: mar 22:00 → mié 08:00 = 0",
  minutosLaborablesEntre(d(1, "22:00"), d(2, "08:00")) === 0);
ok("desde de madrugada: el reloj arranca cuando abre (mié 03:00 → mié 10:00 = 60)",
  minutosLaborablesEntre(d(2, "03:00"), d(2, "10:00")) === 60);

// ─── B · La función pura: tres cohortes, null = no es cola ──────────────────
console.log("\nB · cohorteDeCaso: solo entra lo que exige persona; Fuera de plazo escala");

const hoy = hoyISO();
const c = (e: Partial<EntradaCohorte> & Pick<EntradaCohorte, "conversacion">, reloj?: RelojDePlazos) =>
  cohorteDeCaso({ tipoCaso: "presupuesto", hoy, ...e }, reloj);

ok("quebrado → Necesita respuesta", c({ conversacion: "reactivable", automatizacion: "quebrado" })?.cohorte === "necesita_respuesta");
ok("entrega del agente NO-caso_completo (urgencia) → Necesita respuesta",
  c({ conversacion: "en_espera_paciente", agente: { entregadoCausa: "urgencia", aplazadosVivos: 0 } })?.cohorte === "necesita_respuesta");
ok("paciente escribió lo último → Necesita respuesta",
  c({ conversacion: "pendiente_responder" })?.cohorte === "necesita_respuesta");
ok("entrega caso_completo CON aplazados → Listos (los aplazados van en la ficha)",
  c({ conversacion: "en_espera_paciente", agente: { entregadoCausa: "caso_completo", aplazadosVivos: 2 } })?.cohorte === "listos_para_cerrar");
ok("cierre pendiente (clasificador viejo) → Listos para cerrar",
  c({ conversacion: "reactivable", automatizacion: "cierre_pendiente" })?.cohorte === "listos_para_cerrar");
ok("agotado → Necesita respuesta · agotado (toca llamar; dictado 18-08)",
  (() => { const r = c({ conversacion: "reactivable", automatizacion: "agotado" }); return r?.cohorte === "necesita_respuesta" && r.detalle === "agotado"; })());
ok("LEAD nuevo sin hilo → Necesita respuesta (no hay cadencia de leads)",
  (() => { const r = cohorteDeCaso({ tipoCaso: "lead", conversacion: "sin_conversacion", hoy }); return r?.cohorte === "necesita_respuesta" && r.detalle === "nuevo_sin_contactar"; })());
ok("PRESUPUESTO nuevo sin hilo → null (su primer toque es de la cola de Envíos)",
  c({ conversacion: "sin_conversacion" }) === null);
ok("aplazados vivos SIN entrega → null (el agente sigue: Mensajería > En curso)",
  c({ conversacion: "en_espera_paciente", agente: { entregadoCausa: null, aplazadosVivos: 2 } }) === null);
ok("esperando al paciente → null (consulta: Tablas)",
  c({ conversacion: "en_espera_paciente" }) === null);
ok("sin respuesta (rezagados) → null (la cadencia de Envíos los toca)",
  c({ conversacion: "reactivable" }) === null);
ok("PRECEDENCIA: aplazados vivos + paciente escribió → Necesita respuesta",
  c({ conversacion: "pendiente_responder", agente: { entregadoCausa: null, aplazadosVivos: 2 } })?.cohorte === "necesita_respuesta");

// MEJORAS 102 — la espera («llamé y no contesta», o la 026 del agente) saca
// de la cola lo que era iniciativa NUESTRA, pero no tapa al paciente.
ok("agotado + espera vigente → null (llamé, no contesta: vuelve solo mañana)",
  c({ conversacion: "reactivable", automatizacion: "agotado", enEspera: true }) === null);
ok("lead nuevo + espera vigente → null",
  cohorteDeCaso({ tipoCaso: "lead", conversacion: "sin_conversacion", hoy, enEspera: true }) === null);
ok("paciente escribió DURANTE la espera → sigue siendo trabajo (Necesita respuesta)",
  c({ conversacion: "pendiente_responder", enEspera: true })?.cohorte === "necesita_respuesta");
ok("entrega del agente + espera → la entrega manda (Necesita respuesta)",
  c({ conversacion: "en_espera_paciente", agente: { entregadoCausa: "urgencia", aplazadosVivos: 0 }, enEspera: true })?.cohorte === "necesita_respuesta");

// El día de la vuelta: proximoDiaLaborable salta el fin de semana.
{
  const { proximoDiaLaborable } = await import("../app/lib/seguimiento/tiempo-laborable");
  ok("viernes → lunes (la espera de «no contesta» no vence en sábado)",
    proximoDiaLaborable("2026-08-14") === "2026-08-17");
  ok("miércoles → jueves", proximoDiaLaborable("2026-08-12") === "2026-08-13");
}

// Escalada a Fuera de plazo — reloj FIJADO a mano (§14).
const relojDe = (min: number): RelojDePlazos => ({ minutosLaborablesDesde: () => min });
const t0 = "2026-08-10T09:00:00.000Z";

ok("paciente esperando 121 min laborables → FUERA DE PLAZO (umbral 120), detalle intacto",
  (() => {
    const r = c({ conversacion: "pendiente_responder", ultimoEntranteISO: t0 }, relojDe(121));
    return r?.cohorte === "fuera_de_plazo" && r.detalle === "paciente_escribio";
  })());
ok("paciente esperando 119 min → sigue en Necesita respuesta",
  c({ conversacion: "pendiente_responder", ultimoEntranteISO: t0 }, relojDe(119))?.cohorte === "necesita_respuesta");
ok("urgencia entregada hace 31 min laborables → FUERA DE PLAZO (umbral 30)",
  c({ conversacion: "en_espera_paciente", agente: { entregadoCausa: "urgencia", aplazadosVivos: 0 }, entregadoEnISO: t0 }, relojDe(31))?.cohorte === "fuera_de_plazo");
ok("caso listo hace 241 min laborables → FUERA DE PLAZO (umbral 240)",
  c({ conversacion: "en_espera_paciente", agente: { entregadoCausa: "caso_completo", aplazadosVivos: 0 }, entregadoEnISO: t0 }, relojDe(241))?.cohorte === "fuera_de_plazo");
ok("lead nuevo esperando 61 min laborables → FUERA DE PLAZO (umbral 60)",
  cohorteDeCaso({ tipoCaso: "lead", conversacion: "sin_conversacion", hoy, creadoISO: t0 }, relojDe(61))?.cohorte === "fuera_de_plazo");
ok("sin instante que arranque el reloj → NO escala (no se inventa antigüedad)",
  c({ conversacion: "en_espera_paciente", agente: { entregadoCausa: "urgencia", aplazadosVivos: 0 } }, relojDe(9999))?.cohorte === "necesita_respuesta");
ok("umbral configurado (fase D) manda sobre el default",
  c({ conversacion: "pendiente_responder", ultimoEntranteISO: t0 }, { minutosLaborablesDesde: () => 121, umbralesMin: { respuesta: 300 } })?.cohorte === "necesita_respuesta");
ok("los defaults dictados están escritos: 30 · 120 · 240 · 60",
  UMBRAL_FUERA_DE_PLAZO_MIN.urgencia === 30 && UMBRAL_FUERA_DE_PLAZO_MIN.respuesta === 120 &&
  UMBRAL_FUERA_DE_PLAZO_MIN.cierre === 240 && UMBRAL_FUERA_DE_PLAZO_MIN.lead_nuevo === 60);

// ─── El ACTIVO de un caso con varios presupuestos (21-08): la conversación
//     decide, y la fuente SE DECLARA ───────────────────────────────────────
{
  const dos = [
    { id: "p-viejo", importe: 3400, tratamiento: "implante", fechaISO: "2026-08-01T10:00:00Z", conSenalClasificador: false },
    { id: "p-nuevo", importe: 300, tratamiento: "blanqueamiento", fechaISO: "2026-08-15T10:00:00Z", conSenalClasificador: false },
  ];
  ok("el juicio del evaluador MANDA (fuente 'conversacion') — no el importe",
    (() => { const r = elegirPresupuestoActivo(dos, { referidoId: "p-viejo" }); return r?.activo.id === "p-viejo" && r.fuente === "conversacion"; })());
  ok("sin juicio: la señal del clasificador gana al más reciente (proxy)",
    (() => {
      const r = elegirPresupuestoActivo([{ ...dos[0], conSenalClasificador: true }, dos[1]]);
      return r?.activo.id === "p-viejo" && r.fuente === "proxy";
    })());
  ok("sin juicio ni señal con VARIOS vivos → 'sin_senal' (no se elige: no se habla de ninguno; el más reciente queda de ancla)",
    (() => { const r = elegirPresupuestoActivo(dos); return r?.activo.id === "p-nuevo" && r.fuente === "sin_senal"; })());
  ok("con UN solo vivo, elegirlo es obvio (proxy sin aviso de ficción)",
    (() => { const r = elegirPresupuestoActivo([dos[0]]); return r?.activo.id === "p-viejo" && r.fuente === "proxy"; })());
  ok("un referido que ya no está vivo NO manda (cae a sin_senal: jamás señala un cerrado ni inventa otro)",
    (() => { const r = elegirPresupuestoActivo(dos, { referidoId: "p-cerrado" }); return r?.activo.id === "p-nuevo" && r.fuente === "sin_senal"; })());
  ok("los otros quedan NOMBRADOS, no solo contados",
    elegirPresupuestoActivo(dos)?.otros[0]?.tratamiento === "implante");
}

// ─── C · Con el seed real ───────────────────────────────────────────────────
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
const TEL_HUERFANO = "+34611999002"; // huérfana del seed (Mónica)

async function limpiar() {
  const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  await admin.query(`delete from eventos_automatizacion where cliente='DEMO' and caso_id = any($1)`, [[TEL_FIXTURE_LISTO, TEL_HUERFANO]]);
  await admin.end();
  const pacs = await q(`select id from pacientes where telefono=$1`, [TEL_FIXTURE_LISTO]);
  for (const p of pacs.rows) {
    await q(`delete from contactos_presupuesto where presupuesto_id in (select id from presupuestos where paciente_id=$1)`, [p.id]);
    await q(`delete from presupuestos where paciente_id=$1`, [p.id]);
    await q(`delete from pacientes where id=$1`, [p.id]);
  }
  // Solo el saliente que insertó ESTE QA — los mensajes del seed no se tocan.
  await q(`delete from mensajes_whatsapp where telefono=$1 and contenido like '[QA-COLA]%'`, [TEL_HUERFANO]);
}
await limpiar();

await runWithCliente("DEMO", async () => {
  console.log("\nC · colaDeSeguimiento contra el seed");
  const base = await colaDeSeguimiento();

  ok("cada caso en EXACTAMENTE una de las TRES (partición)",
    base.casos.every((x) => ORDEN_COHORTES.includes(x.cohorte)) &&
      ORDEN_COHORTES.reduce((s, co) => s + base.casos.filter((x) => x.cohorte === co).length, 0) === base.casos.length);
  ok("dinero parado = SOLO presupuestos en cola, con TODOS los vivos de cada caso (importeTotal)",
    Math.round(base.resumen.dineroParado) ===
      Math.round(base.casos.filter((x) => x.tipo === "presupuesto").reduce((s, x) => s + (x.importeTotal ?? x.importe ?? 0), 0)),
    `${base.resumen.dineroParado} €`);
  ok("leads contados, no valorados",
    base.resumen.leadsSinImporte === base.casos.filter((x) => x.tipo === "lead").length &&
      base.casos.filter((x) => x.tipo === "lead").every((x) => x.importe === null));

  // La cola YA NO es el censo de activos: un presupuesto abierto puede estar
  // legítimamente fuera (cadencia/Tablas). Lo que se afirma es la dirección:
  // cola ⊆ activos.
  const nPresuAbiertos = Number((await q(
    `select count(*)::int n from presupuestos where estado is null or estado not in ('ACEPTADO','PERDIDO')`,
  )).rows[0].n);
  const enCola = base.casos.filter((x) => x.tipo === "presupuesto").length;
  ok("cola de presupuestos ⊆ presupuestos abiertos (lo demás es Envíos/Tablas)",
    enCola <= nPresuAbiertos, `cola=${enCola} abiertos=${nPresuAbiertos}`);

  console.log("\n  Distribución del seed (tres cohortes):");
  for (const co of ORDEN_COHORTES) {
    const del = base.casos.filter((x) => x.cohorte === co);
    const detalles = [...new Set(del.map((x) => x.detalle))].join(", ");
    console.log(`    ${co}: ${del.length}${del.length ? ` (${detalles})` : ""}`);
  }
  console.log(`    (fuera de la cola: ${nPresuAbiertos - enCola} presupuestos abiertos en Envíos/Tablas)`);

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
  // SEGUNDO presupuesto vivo del mismo teléfono (fallo Carlos, 21-08): el
  // caso es LA CONVERSACIÓN — una card, no dos.
  await q(
    `insert into presupuestos (cliente, paciente_id, clinica_id, tratamiento_nombre, estado, importe, fecha, fecha_alta, doctor, paciente_telefono, contact_count)
     values ('DEMO',$1,$2,'Férula de descarga','PRESENTADO',200,($3::date - 5),($3::date - 5),'Dra. QA',$4,1)`,
    [pac.rows[0].id, clin, hoy, TEL_FIXTURE_LISTO],
  );
  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_FIXTURE_LISTO, evento: "derivado", causaDerivacion: "caso_completo", objetivoActivo: "presupuesto", actorNombre: "qa" } as any);
  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_HUERFANO, evento: "aplazado", claveAplazado: "agenda_disponibilidad", motivoTexto: "pregunta por el sábado", actorNombre: "qa" } as any);

  const tras = await colaDeSeguimiento();
  const casosDelTel = tras.casos.filter((x) => x.telefono === TEL_FIXTURE_LISTO);
  const casoListo = casosDelTel[0];
  ok("DOS presupuestos vivos → UNA card (el caso es la conversación)",
    casosDelTel.length === 1, `cards=${casosDelTel.length}`);
  ok("entregado caso_completo AHORA MISMO → Listos (recién entregado, no escala)",
    casoListo?.cohorte === "listos_para_cerrar" && casoListo.detalle === "entregado_listo",
    `${casoListo?.cohorte ?? "no está"}`);
  ok("sin señal de nadie: fuente 'sin_senal' (el 650 es solo ancla — la ficha lista los dos)",
    casoListo?.importe === 650 && casoListo.activoFuente === "sin_senal",
    `importe=${casoListo?.importe} fuente=${casoListo?.activoFuente}`);
  ok("el otro queda NOMBRADO en la card (200 € · férula)",
    casoListo?.otrosPresupuestos.length === 1 && casoListo.otrosPresupuestos[0].importe === 200);
  ok("importeTotal = la suma de los vivos (850)", casoListo?.importeTotal === 850);
  // La huérfana del seed tiene su último mensaje SIN responder: paciente
  // esperando. La COHORTE depende de cuánto lleve esperando en horario de
  // clínica (el seed siembra relativo a la hora de ejecución) — lo estable
  // es el DETALLE y que esté en cola.
  const casoHuerfano = tras.casos.find((x) => x.tipo === "conversacion" && x.telefono === TEL_HUERFANO);
  ok("huérfano con paciente esperando ESTÁ en la cola (Necesita o Fuera de plazo)",
    casoHuerfano != null && casoHuerfano.detalle === "paciente_escribio" &&
      (casoHuerfano.cohorte === "necesita_respuesta" || casoHuerfano.cohorte === "fuera_de_plazo"),
    `${casoHuerfano?.cohorte ?? "no está"}`);
  ok("y el dinero parado subió la SUMA de los dos presupuestos del fixture (850)",
    Math.round(tras.resumen.dineroParado - base.resumen.dineroParado) === 850,
    `Δ=${tras.resumen.dineroParado - base.resumen.dineroParado}`);

  // El juicio del evaluador MATA el proxy: una evaluación que identifica el
  // presupuesto de 200 → el activo cambia y la fuente pasa a 'conversacion'.
  const pres200 = await q(`select id from presupuestos where paciente_telefono=$1 and importe=200`, [TEL_FIXTURE_LISTO]);
  const { registrarEventoIdempotente } = await import("../app/lib/automatizacion/pg");
  await registrarEventoIdempotente({
    tipoCaso: "conversacion", casoId: TEL_FIXTURE_LISTO, evento: "evaluacion",
    actorNombre: "qa", mensajeId: "qa_cola_referido_1",
    evaluacionJson: JSON.stringify({ v: 1, tema: "presupuesto", presupuestoReferidoId: pres200.rows[0].id }),
  } as any);
  const trasReferido = await colaDeSeguimiento();
  const casoReferido = trasReferido.casos.find((x) => x.telefono === TEL_FIXTURE_LISTO);
  ok("con juicio del evaluador, el activo es DEL QUE SE HABLA (200) y fuente='conversacion'",
    casoReferido?.importe === 200 && casoReferido.activoFuente === "conversacion",
    `importe=${casoReferido?.importe} fuente=${casoReferido?.activoFuente}`);

  // Al responderle, queda un aplazado vivo SIN entrega → el agente sigue →
  // el caso SALE de la cola (18-08: eso es supervisión, no trabajo).
  await q(
    `insert into mensajes_whatsapp (cliente, telefono, direccion, contenido, "timestamp", fuente, autor)
     values ('DEMO',$1,'Saliente','[QA-COLA] Te contesto enseguida', now(), 'Modo_A_manual','persona')`,
    [TEL_HUERFANO],
  );
  const tras2 = await colaDeSeguimiento();
  const huerfano2 = tras2.casos.find((x) => x.tipo === "conversacion" && x.telefono === TEL_HUERFANO);
  ok("respondida la persona, el aplazado sin entrega SALE de la cola (Mensajería > En curso)",
    huerfano2 == null, huerfano2 ? `sigue como ${huerfano2.cohorte}` : "fuera, correcto");

  // ── MEJORAS 102 end-to-end: «llamé y no contesta» sobre un caso vivo ────
  // El fixture Listo (entregado) se resuelve y se agota a base de toques: la
  // vía rápida es registrar la llamada sobre él y ver la ESPERA en el log +
  // el caso del teléfono FUERA de la cola aunque siga siendo cola candidata.
  const { registrarLlamada } = await import("../app/lib/seguimiento/registrar-llamada");
  const presuFix = await q(`select id from presupuestos where paciente_telefono=$1 limit 1`, [TEL_FIXTURE_LISTO]);
  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_FIXTURE_LISTO, evento: "resuelto_manual", actorNombre: "qa" } as any);
  const r102 = await registrarLlamada({
    telefono: TEL_FIXTURE_LISTO,
    tipo: "presupuesto",
    casoId: String(presuFix.rows[0].id),
    resultado: "no_contesta",
    nota: "buzón",
    actor: { nombre: "qa" },
  });
  ok("«no contesta» fija espera hasta el PRÓXIMO día laborable", r102.esperaHasta != null && r102.esperaHasta > hoy, String(r102.esperaHasta));
  const evEspera = await q(
    `select motivo_texto, hasta from eventos_automatizacion where caso_id=$1 and evento='espera_fijada' order by created_at desc limit 1`,
    [TEL_FIXTURE_LISTO],
  );
  ok("la espera está en el log con su motivo («Llamada sin respuesta…»)",
    evEspera.rows.length === 1 && /Llamada sin respuesta/.test(String(evEspera.rows[0].motivo_texto ?? "")));
  const contacto = await q(
    `select resultado, nota from contactos_presupuesto where presupuesto_id=$1 order by created_at desc limit 1`,
    [presuFix.rows[0].id],
  );
  ok("el contacto de la llamada quedó registrado (resultado + nota)",
    contacto.rows.length === 1 && /no contest/i.test(String(contacto.rows[0].resultado ?? "")) && String(contacto.rows[0].nota ?? "") === "buzón",
    contacto.rows.length ? `${contacto.rows[0].resultado}` : "sin fila");
  const tras3 = await colaDeSeguimiento();
  ok("con la espera vigente, el caso del teléfono NO está en la cola",
    !tras3.casos.some((x) => x.telefono === TEL_FIXTURE_LISTO),
    tras3.casos.find((x) => x.telefono === TEL_FIXTURE_LISTO)?.cohorte ?? "fuera, correcto");
});

await limpiar();
console.log("\n  ✓ fixtures y eventos limpiados");
await app.end();

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("✓ la cola: tres cohortes que no crecen, solo trabajo de persona, y el plazo corre en horario de clínica");
