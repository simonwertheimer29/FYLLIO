#!/usr/bin/env tsx
// QA de LA FICHA DEL CASO (fase B, B1).
//
//   npx tsx scripts/qa-ficha-caso.mts   (= npm run qa:ficha)
//
// DETERMINISTA Y SIN MODELO (regla del 17-08: los QA de iteración no gastan
// API): los juicios se insertan como fixtures — payload de evaluación,
// aplazados, espera, historial del portal — y se afirma la ficha derivada.
//
// Cubre los casos dictados del diagnóstico:
//   a) hilo SIN evaluación → lo dice con todas las letras, ni blanco ni
//      resumen fingido
//   b) varios objetivos abiertos → el activo con campos, el resto una línea
//   c) cierre por el PACIENTE desde el portal ≠ entrega del agente
//   + espera arriba del todo, intentos contados, pendientes con la frase.
//
// Salidas §9: 0 · 1 · 2.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { registrarEventoIdempotente, registrarEvento } from "../app/lib/automatizacion/pg";
import { fichaDeCaso, type FichaCaso } from "../app/lib/agente/ficha-caso";
import { contextoParaEntrada, repreguntaPendiente } from "../app/lib/agente/borrador-entrada";
import { hoyISO } from "../app/lib/time";

const TEL_SIN_EVAL = "+34611999002"; // huérfana del seed (Mónica): mensajes, cero evaluación
const TEL_FICHA = "+34611998021"; // mini-mundo propio de este QA

for (const v of ["SUPABASE_DB_URL_APP", "SUPABASE_DB_URL_ADMIN"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} — no puedo comprobar nada.`);
    process.exit(2);
  }
}

const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();
async function q(texto: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> {
  await app.query("begin");
  try {
    await app.query("select set_config('app.cliente','DEMO',true)");
    const r = await app.query(texto, params);
    await app.query("commit");
    return r as { rows: any[]; rowCount: number | null };
  } catch (e) {
    await app.query("rollback").catch(() => {});
    throw e;
  }
}

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

async function limpiar() {
  const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  await admin.query(`delete from eventos_automatizacion where cliente='DEMO' and caso_id=$1`, [TEL_FICHA]);
  await admin.end();
  const pacs = await q(`select id from pacientes where telefono=$1`, [TEL_FICHA]);
  for (const p of pacs.rows) {
    await q(`delete from historial_acciones where presupuesto_id in (select id from presupuestos where paciente_id=$1)`, [p.id]);
    await q(`delete from pagos_paciente where paciente_id=$1`, [p.id]);
    await q(`delete from presupuestos where paciente_id=$1`, [p.id]);
    await q(`delete from pacientes where id=$1`, [p.id]);
  }
  await q(`delete from mensajes_whatsapp where telefono=$1`, [TEL_FICHA]);
}
await limpiar();

await runWithCliente("DEMO", async () => {
  // ── a · Hilo real del seed SIN evaluación ─────────────────────────────────
  console.log("\na · Sin evaluación del agente: la ficha lo dice, no lo rellena");
  const fa = await fichaDeCaso(TEL_SIN_EVAL);
  ok("evaluado = false", fa.evaluado === false);
  ok("queQuiere = null (ni resumen fingido)", fa.queQuiere === null);
  ok("recogido = null (no una lista vacía que parezca «nada que recoger»)", fa.recogido === null);
  ok("la línea lo dice en palabras", fa.linea.queQuiere === "Sin evaluar por el agente");
  ok("y lo data-driven se muestra igual (nombre del perfil)", fa.nombre.length > 0, fa.nombre);

  // ── Mini-mundo para b + c + espera + intentos ────────────────────────────
  const clin = (await q(`select id from clinicas where nombre ilike '%norte%' limit 1`)).rows[0].id;
  const pac = await q(
    `insert into pacientes (cliente, nombre, telefono, clinica_id, consentimiento_whatsapp, activo)
     values ('DEMO','QA Ficha Bravo',$1,$2,true,true) returning id`,
    [TEL_FICHA, clin],
  );
  const pacienteId = pac.rows[0].id;
  // Presupuesto ACEPTADO con pago parcial → cobro abierto; sin cita futura →
  // cita abierta (fase B punto 1). Dos objetivos: el caso b.
  const pr = await q(
    `insert into presupuestos (cliente, paciente_id, clinica_id, tratamiento_nombre, estado, importe, fecha, fecha_alta, fecha_aceptado, doctor, paciente_telefono, contact_count)
     values ('DEMO',$1,$2,'Implante unitario','ACEPTADO',900,$3,$3,$3,'Dra. QA',$4,2) returning id`,
    [pacienteId, clin, hoyISO(), TEL_FICHA],
  );
  const presupuestoId = pr.rows[0].id;
  await q(
    `insert into pagos_paciente (cliente, paciente_id, fecha_pago, importe, metodo, tipo)
     values ('DEMO',$1,now(),300,'Tarjeta','Senal')`,
    [pacienteId],
  );
  // Hilo: dos salientes y un entrante POSTERIOR (esperandoDesde = el entrante).
  await q(
    `insert into mensajes_whatsapp (cliente, telefono, direccion, contenido, "timestamp", fuente, clinica_id)
     values ('DEMO',$1,'Saliente','Hola, te escribimos por tu tratamiento', now() - interval '3 days', 'Modo_A_manual', $2),
            ('DEMO',$1,'Saliente','¿Pudiste verlo?', now() - interval '2 days', 'Modo_A_manual', $2),
            ('DEMO',$1,'Entrante','Querría cita para empezar, por las tardes', now() - interval '1 day', 'Modo_B_WABA', $2)`,
    [TEL_FICHA, clin],
  );
  // Los juicios del agente, como fixture (payload v1 real):
  const payload = {
    v: 1, tema: "cita", peticionOQueja: false, malestar: false, urgenciaMedica: false,
    mencionaAntecedenteMedico: false, vuelveSobreAplazado: null,
    camposRecogidos: {
      cita: { tratamiento_o_molestia: "empezar su tratamiento", urgencia: "sin prisa", disponibilidad: "tardes", preferencia_doctor: "no_aplica", clinica_preferida: "no_aplica", nombre_completo: null },
      cobro: { confirma_pago: null, via_pago: null, fecha_pago: null },
    },
    hiloTruncado: false, borradorDescartado: null, respuesta: "Perfecto, te buscamos hueco por las tardes.",
  };
  await registrarEventoIdempotente({
    tipoCaso: "conversacion", casoId: TEL_FICHA, evento: "evaluacion",
    evaluacionJson: JSON.stringify(payload), actorNombre: "qa", mensajeId: "qa_ficha_1",
  });
  await registrarEventoIdempotente({
    tipoCaso: "conversacion", casoId: TEL_FICHA, evento: "aplazado",
    claveAplazado: "cobertura_seguro", motivoTexto: "pregunta si su seguro cubre parte",
    actorNombre: "qa", mensajeId: "qa_ficha_1",
  });
  await registrarEvento({
    tipoCaso: "conversacion", casoId: TEL_FICHA, evento: "espera_fijada",
    hasta: (() => { const d = new Date(`${hoyISO()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 3); return d.toISOString().slice(0, 10); })(),
    motivoTexto: "«dame unos días para organizarme»", actorNombre: "qa",
  });

  console.log("\nb · Varios objetivos: el activo con campos, el resto una línea");
  const fb = await fichaDeCaso(TEL_FICHA);
  ok("evaluado = true", fb.evaluado === true);
  ok("objetivo activo = cita (tema del juicio, abierto hoy)", fb.objetivoActivo === "cita");
  ok("los otros abiertos, como línea (cobro)", fb.otrosObjetivos.length === 1 && fb.otrosObjetivos[0] === "cobro");
  ok(
    "queQuiere compuesta por CÓDIGO desde los campos",
    fb.queQuiere === "Quiere cita — empezar su tratamiento · sin prisa · tardes",
    fb.queQuiere ?? "null",
  );
  ok("recogido: los campos del activo, no_aplica incluido", (fb.recogido ?? []).some((c) => c.campo === "disponibilidad" && c.valor === "tardes") && (fb.recogido ?? []).some((c) => c.valor === "no_aplica"));
  ok("pendiente con la FRASE del paciente", fb.pendientes.length === 1 && fb.pendientes[0].frase.includes("seguro cubre"));
  ok("la espera ARRIBA, con fecha y frase", fb.espera != null && fb.espera.frase?.includes("organizarme") === true);
  ok("intentos contados: 2 salientes, con fecha del último", fb.intentos.salientes === 2 && fb.intentos.ultimo != null);
  ok("esperandoDesde = el entrante sin responder", fb.linea.esperandoDesde != null);
  ok("la línea de la cola: paciente · qué quiere", fb.linea.paciente === "QA Ficha Bravo" && fb.linea.queQuiere.startsWith("Quiere cita"));

  console.log("\nc · Cierre por el PACIENTE (portal) ≠ entrega del agente");
  ok("sin acción de portal: cierrePorPaciente = null", fb.cierrePorPaciente === null);
  await q(
    `insert into historial_acciones (cliente, presupuesto_id, tipo, descripcion, metadata, registrado_por, fecha)
     values ('DEMO',$1,'portal_aceptado','Paciente aceptó el presupuesto desde el portal · firma: QA','{}','',now())`,
    [presupuestoId],
  );
  const fc = await fichaDeCaso(TEL_FICHA);
  ok("con la firma del portal: cierrePorPaciente = aceptado", fc.cierrePorPaciente?.accion === "aceptado");
});

// ── d · B3: el contexto del borrador de entrada (PURO, sin modelo) ─────────
console.log("\nd · contextoParaEntrada: lo recogido consta, lo pendiente con su frase");
{
  const fichaFixture: FichaCaso = {
    telefono: "+34600000000", nombre: "Ana QA", esPaciente: true, clinicaId: null,
    evaluado: true, espera: { hasta: "2026-08-25", frase: "el lunes os digo" },
    intentos: { salientes: 2, ultimo: null }, semaforo: { verde: true } as any,
    cierrePorPaciente: null, queQuiere: "Quiere cita — revisión · tardes",
    objetivoActivo: "cita", otrosObjetivos: [],
    pendientes: [{ clave: "agenda_disponibilidad" as any, etiqueta: "Hueco de agenda", frase: "¿tenéis sábados?" }],
    recogido: [
      { campo: "preferencia_horaria", valor: "tardes" },
      { campo: "telefono_alternativo", valor: null },
      { campo: "motivo", valor: "no_aplica" },
    ],
    linea: { paciente: "Ana QA", queQuiere: "Quiere cita", esperandoDesde: null },
  };
  const ctx = contextoParaEntrada(fichaFixture);
  ok("lo RECOGIDO con valor entra («no repreguntar» parte de aquí)", ctx.includes("Ya recogido — preferencia_horaria: tardes"));
  ok("un campo sin valor o no_aplica NO entra (no hay nada que no repreguntar)",
    !ctx.includes("telefono_alternativo") && !ctx.includes("no_aplica"));
  ok("lo PENDIENTE entra con la frase real del paciente", ctx.includes("¿tenéis sábados?"));
  ok("la espera pactada se declara (que la entrada no la pise a ciegas)", ctx.includes("2026-08-25"));
  ok("qué quiere, arriba", ctx.includes("Quiere cita — revisión · tardes"));
  ok("el pendiente se declara como pregunta DE LA PERSONA que se trae resuelta",
    ctx.includes("TÚ traes resuelta"));

  // La guarda en CÓDIGO del fallo Elena (21-08): un pendiente aplazado
  // devuelto como pregunta al paciente se descarta, sin depender del prompt.
  const PEND_IVA = [{ etiqueta: "Condición del presupuesto", frase: "¿los 4.200 € llevan IVA?" }];
  ok("devolver el IVA como pregunta → DESCARTE (el caso Elena)",
    repreguntaPendiente("Hola Elena, soy Marta. Sobre tu presupuesto: ¿sabes si los 4.200 € llevan IVA?", PEND_IVA) != null);
  ok("también cae la variante indirecta («¿te llamo para contarte lo del IVA?»: se asume de más)",
    repreguntaPendiente("¿Te viene bien que te llame y vemos lo del IVA?", PEND_IVA) != null);
  ok("ANUNCIAR que se trae la respuesta NO cae (afirmación, no pregunta)",
    repreguntaPendiente("Hola Elena, soy Marta. Te confirmo ya lo del IVA de tu presupuesto y lo dejamos cerrado.", PEND_IVA) === null);
  ok("una pregunta que NO toca el pendiente no cae («¿te viene bien el martes?»)",
    repreguntaPendiente("Te confirmo lo del IVA en cuanto lo tenga. ¿Te viene bien que te llame el martes?", PEND_IVA) === null);
  ok("sin pendientes, nada que vigilar", repreguntaPendiente("¿Quieres cita el martes?", []) === null);
}

await limpiar();
console.log("\n  ✓ mini-mundo y eventos limpiados");
await app.end();

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("✓ la ficha: honesta sin evaluación, activa con varios objetivos, y distingue quién cerró");
