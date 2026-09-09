// scripts/qa-conversacion.mts
//
// QA de «Qué dicen» (2.1, MEJORAS 176). Dos partes:
//  (1) los cubos y la agregación, PUROS, contra frases y eventos fijados: la
//      unidad es la conversación (repetir no suma), vale el ÚLTIMO valor con
//      contenido, aplazados y entregas cuentan una vez por tema, «Otro» guarda
//      la frase, y lo de fuera de las dos ventanas no existe;
//  (2) dos sedes ficticias en DEMO con eventos del agente contados a mano en
//      2020 (fuera de cualquier dato del seed, que es relativo a hoy), reloj
//      FIJO (hoy = 2020-03-01 → ventana de 30 días 31-ene…29-feb, la anterior
//      1-ene…30-ene): la sede es la del último mensaje del hilo, un hilo sin
//      mensajes solo cuenta en la red, la red = sedes + sin sede.
// Limpia al terminar. Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { calcularConversacion } from "../app/lib/metricas/conversacion";
import {
  agregarConversacion,
  claveDeTexto,
  cuboDecision,
  cuboUrgencia,
  type Conversacion,
  type EventoConversacion,
} from "../app/lib/metricas/conversacion.tipos";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));
const cubo = (c: Conversacion, b: keyof Conversacion["bloques"], clave: string) => c.bloques[b].cubos.find((x) => x.clave === clave);
const n = (c: Conversacion, b: keyof Conversacion["bloques"], clave: string) => cubo(c, b, clave)?.n ?? 0;
const previo = (c: Conversacion, b: keyof Conversacion["bloques"], clave: string) => cubo(c, b, clave)?.previo ?? 0;

// ─── (1) Puro ────────────────────────────────────────────────────────────────

function puro() {
  console.log("Cubos:");
  check(cuboDecision("acepta") === "acepta", "«acepta» → acepta");
  check(cuboDecision("vale, adelante") === "acepta", "«vale, adelante» → acepta");
  check(cuboDecision("no lo acepta, es caro") === "rechaza", "«no lo acepta, es caro» → rechaza (lo que niega manda)");
  check(cuboDecision("se lo piensa") === "se_lo_piensa", "«se lo piensa» → se lo piensa");
  check(cuboDecision("lo consultará con su mujer") === "se_lo_piensa", "«lo consultará…» → se lo piensa");
  check(cuboDecision("mmm") === "otro", "«mmm» → otro");
  check(cuboUrgencia("dolor ahora") === "dolor_ahora", "«dolor ahora» → dolor ahora");
  check(cuboUrgencia("me duele mucho") === "dolor_ahora", "«me duele mucho» → dolor ahora");
  check(cuboUrgencia("esta semana si puede ser") === "esta_semana", "«esta semana…» → esta semana");
  check(cuboUrgencia("sin prisa") === "sin_prisa", "«sin prisa» → sin prisa");
  check(cuboUrgencia("más adelante, ahora no") === "sin_prisa", "«más adelante, ahora no» → sin prisa (la calma manda sobre «ahora»)");
  check(cuboUrgencia("no sé") === "otro", "«no sé» → sin precisar");
  check(claveDeTexto("  «Implante»  ") === "implante", "clave de texto: comillas y espacios fuera, minúsculas");
  check(claveDeTexto("Dolor de muela.") === "dolor de muela", "clave de texto: puntuación final fuera");

  console.log("Agregación:");
  const V = { desde: "2020-01-31", hasta: "2020-02-29", dias: 30 };
  const P = { desde: "2020-01-01", hasta: "2020-01-30" };
  const ev = (x: Partial<EventoConversacion> & { telefono: string; dia: string }): EventoConversacion => ({
    clinicaId: null,
    evento: "evaluacion",
    clave: null,
    motivo: null,
    campos: null,
    ...x,
  });
  const eventos: EventoConversacion[] = [
    ev({ telefono: "A", dia: "2020-02-10", campos: { presupuesto: { decision: "se lo piensa", que_le_frena: "es muy caro" } } }),
    ev({ telefono: "A", dia: "2020-02-12", campos: { presupuesto: { decision: "acepta", que_le_frena: "no_aplica" } } }),
    ev({ telefono: "B", dia: "2020-02-20", campos: { presupuesto: { decision: "rechaza", motivo_rechazo: "se lo hace en otra clínica" } } }),
    ev({ telefono: "B", dia: "2020-02-20", evento: "aplazado", clave: "precio_descuento", motivo: "«¿me lo dejáis más barato?»" }),
    ev({ telefono: "B", dia: "2020-02-21", evento: "aplazado", clave: "precio_descuento", motivo: "«¿y con descuento?»" }),
    ev({ telefono: "B", dia: "2020-02-21", evento: "derivado", clave: "caso_completo", motivo: "«vale»" }),
    ev({ telefono: "C", dia: "2020-01-10", campos: { presupuesto: { decision: "rechaza", motivo_rechazo: "no sé, la verdad" } } }),
    ev({ telefono: "D", dia: "2019-12-15", campos: { presupuesto: { decision: "rechaza" } } }),
    ev({ telefono: "E", dia: "2020-02-15", campos: { cita: { tratamiento_o_molestia: "Implante", urgencia: "sin prisa", motivo_no_cita: "muy caro" } } }),
  ];
  const c = agregarConversacion(eventos, V, P);
  check(c.conversaciones.n === 3 && c.conversaciones.previo === 1, "conversaciones: 3 en la ventana (A, B, E), 1 en la anterior (C); D no existe");
  check(n(c, "decision", "acepta") === 1 && n(c, "decision", "se_lo_piensa") === 0, "decisión de A: vale el ÚLTIMO valor (acepta), «se lo piensa» no suma");
  check(n(c, "decision", "rechaza") === 1 && previo(c, "decision", "rechaza") === 1, "decisión: rechaza 1 ahora (B) y 1 antes (C)");
  check(n(c, "objeciones", "precio_alto") === 1 && cubo(c, "objeciones", "precio_alto")?.ejemplos[0] === "es muy caro", "objeción de A: «es muy caro» → Precio alto, con la frase (el «no_aplica» posterior no la borra)");
  check(n(c, "rechazos", "otra_clinica") === 1, "rechazo de B → Eligió otra clínica");
  check(n(c, "rechazos", "otro") === 0 && previo(c, "rechazos", "otro") === 1 && cubo(c, "rechazos", "otro")?.ejemplos.length === 0, "rechazo de C (anterior) → Otro, solo en «antes», sin frase de la ventana actual");
  check(n(c, "preguntas", "precio_descuento") === 1 && cubo(c, "preguntas", "precio_descuento")?.ejemplos[0] === "¿me lo dejáis más barato?", "aplazados de B: dos veces el mismo tema = 1 conversación, con la primera frase sin comillas");
  check(n(c, "entregas", "caso_completo") === 1, "entregas: caso_completo 1");
  check(n(c, "buscan", "implante") === 1 && cubo(c, "buscan", "implante")?.etiqueta === "Implante", "qué buscan: «Implante» → implante, etiqueta capitalizada");
  check(n(c, "urgencia", "sin_prisa") === 1 && n(c, "noCita", "Precio") === 1, "urgencia sin prisa 1 · no quiere cita por Precio 1");
  check(c.bloques.decision.cubos[c.bloques.decision.cubos.length - 1]?.clave !== "acepta" || c.bloques.decision.cubos.every((x) => x.clave !== "otro"), "orden: «Otro» siempre al final");
}

// ─── (2) Base ────────────────────────────────────────────────────────────────

const CLI_A = "qa-cv-a";
const CLI_B = "qa-cv-b";
const AHORA = new Date("2020-03-01T12:00:00Z");
const P = "qa-cv-";
const T = { a1: "34600000101", a2: "34600000102", b1: "34600000201", sin: "34600000301" };

async function limpiar() {
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`delete from eventos_automatizacion where mensaje_id like ${P + "%"}`.execute(trx);
    await sql`delete from mensajes_whatsapp where id like ${P + "%"}`.execute(trx);
    await sql`delete from clinicas where id in (${CLI_A}, ${CLI_B})`.execute(trx);
  });
}

async function sembrar() {
  let k = 0;
  const id = () => `${P}${++k}`;
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`insert into clinicas (id, cliente, nombre, activa) values (${CLI_A}, 'DEMO', 'QA Dicen A', false), (${CLI_B}, 'DEMO', 'QA Dicen B', false)`.execute(trx);
    // La sede de un hilo es la del ÚLTIMO mensaje: a1 empieza en B y acaba en A.
    const msg = async (tel: string, cli: string | null, ts: string) =>
      sql`insert into mensajes_whatsapp (id, cliente, telefono, direccion, contenido, "timestamp", fuente, tipo, clinica_id)
          values (${id()}, 'DEMO', ${tel}, 'Entrante', 'qa', ${ts}::timestamptz, 'qa', 'text', ${cli})`.execute(trx);
    await msg(T.a1, CLI_B, "2020-02-01T10:00:00Z");
    await msg(T.a1, CLI_A, "2020-02-10T10:00:00Z");
    await msg(T.a2, CLI_A, "2020-02-05T10:00:00Z");
    await msg(T.b1, CLI_B, "2020-01-10T10:00:00Z");
    const evalu = async (tel: string, ts: string, campos: unknown) =>
      sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, evaluacion_json, created_at)
          values ('DEMO', 'conversacion', ${tel}, 'evaluacion', 'qa', ${id()}, ${JSON.stringify({ v: 1, tema: "qa", camposRecogidos: campos })}, ${ts}::timestamptz)`.execute(trx);
    const aplaza = async (tel: string, ts: string, clave: string, motivo: string) =>
      sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, clave_aplazado, motivo_texto, created_at)
          values ('DEMO', 'conversacion', ${tel}, 'aplazado', 'qa', ${id()}, ${clave}, ${motivo}, ${ts}::timestamptz)`.execute(trx);
    const entrega = async (tel: string, ts: string, causa: string) =>
      sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, causa_derivacion, motivo_texto, created_at)
          values ('DEMO', 'conversacion', ${tel}, 'derivado', 'qa', ${id()}, ${causa}, '«qa»', ${ts}::timestamptz)`.execute(trx);

    // a1 (sede A): se lo piensa por el precio, luego acepta; pregunta dos veces por el plan de pago; entregado completo.
    await evalu(T.a1, "2020-02-10T10:00:02Z", { presupuesto: { decision: "se lo piensa", que_le_frena: "me parece caro" } });
    await aplaza(T.a1, "2020-02-10T10:00:03Z", "plan_pago", "«¿puedo pagarlo a plazos?»");
    await aplaza(T.a1, "2020-02-11T10:00:03Z", "plan_pago", "«¿y en tres meses?»");
    await evalu(T.a1, "2020-02-12T10:00:02Z", { presupuesto: { decision: "acepta" } });
    await entrega(T.a1, "2020-02-12T10:00:04Z", "caso_completo");
    // a1 fuera de las dos ventanas: no existe.
    await evalu(T.a1, "2019-12-15T10:00:02Z", { presupuesto: { decision: "rechaza", motivo_rechazo: "muy caro" } });
    // a2 (sede A): pide cita de ortodoncia, esta semana; entregado completo.
    await evalu(T.a2, "2020-02-05T10:00:02Z", { cita: { tratamiento_o_molestia: "Ortodoncia", urgencia: "esta semana" } });
    await entrega(T.a2, "2020-02-05T10:00:04Z", "caso_completo");
    // b1 (sede B): en la ventana anterior se lo pensaba; en esta rechaza por otra clínica.
    await evalu(T.b1, "2020-01-10T10:00:02Z", { presupuesto: { decision: "se lo piensa" } });
    await evalu(T.b1, "2020-02-20T10:00:02Z", { presupuesto: { decision: "rechaza", motivo_rechazo: "se lo hace en otra clínica" } });
    // sin sede (ningún mensaje): implante con dolor, y no quiere cita por el precio.
    await evalu(T.sin, "2020-02-15T10:00:02Z", { cita: { tratamiento_o_molestia: "implante", urgencia: "dolor ahora", motivo_no_cita: "muy caro" } });
  });
}

async function base() {
  await sembrar();
  console.log("Base (DEMO, reloj 2020-03-01, ventana de 30 días):");
  const [red, a, b] = await Promise.all([
    calcularConversacion({ clinicaId: null, dias: 30, ahora: AHORA }),
    calcularConversacion({ clinicaId: CLI_A, dias: 30, ahora: AHORA }),
    calcularConversacion({ clinicaId: CLI_B, dias: 30, ahora: AHORA }),
  ]);
  check(red.ventana.desde === "2020-01-31" && red.ventana.hasta === "2020-02-29" && red.ventanaPrevia.desde === "2020-01-01" && red.ventanaPrevia.hasta === "2020-01-30", "ventanas: 31-ene…29-feb y 1-ene…30-ene");
  // Solo lo del QA: el resto de DEMO vive en 2026, fuera de estas ventanas.
  check(red.conversaciones.n === 4 && red.conversaciones.previo === 1, "red: 4 conversaciones (a1, a2, b1, sin sede) · 1 en la anterior (b1)");
  check(a.conversaciones.n === 2 && b.conversaciones.n === 1 && b.conversaciones.previo === 1, "sedes: A 2 · B 1 (y 1 antes) — a1 cuenta en A, la sede de su último mensaje");
  check(red.conversaciones.n === a.conversaciones.n + b.conversaciones.n + 1, "la red = A + B + el hilo sin sede");
  check(n(red, "decision", "acepta") === 1 && n(red, "decision", "rechaza") === 1 && n(red, "decision", "se_lo_piensa") === 0, "decisión: acepta 1 (a1, su último valor) · rechaza 1 (b1) · se lo piensa 0");
  check(previo(red, "decision", "se_lo_piensa") === 1, "decisión anterior: se lo piensa 1 (b1 en enero)");
  check(n(red, "objeciones", "precio_alto") === 1 && cubo(red, "objeciones", "precio_alto")?.ejemplos[0] === "me parece caro", "objeciones: Precio alto 1 con «me parece caro»");
  check(n(red, "rechazos", "otra_clinica") === 1 && n(a, "rechazos", "otra_clinica") === 0 && n(b, "rechazos", "otra_clinica") === 1, "rechazos: otra clínica 1, y solo en B");
  check(n(red, "preguntas", "plan_pago") === 1 && cubo(red, "preguntas", "plan_pago")?.ejemplos.length === 2, "preguntas: plan de pago = 1 conversación (dos aplazados), con sus dos frases");
  check(n(red, "entregas", "caso_completo") === 2 && n(a, "entregas", "caso_completo") === 2, "entregas: caso completo 2, las dos en A");
  check(n(red, "buscan", "ortodoncia") === 1 && n(red, "buscan", "implante") === 1 && n(a, "buscan", "implante") === 0, "qué buscan: ortodoncia (A) e implante (sin sede: solo en la red)");
  check(n(red, "urgencia", "esta_semana") === 1 && n(red, "urgencia", "dolor_ahora") === 1, "urgencia: esta semana 1 · dolor ahora 1");
  check(n(red, "noCita", "Precio") === 1 && cubo(red, "noCita", "Precio")?.etiqueta === "Precio", "no quiere cita: Precio 1 (MEJORAS 220)");
  check(n(red, "rechazos", "otro") === 0 && n(red, "decision", "rechaza") + n(red, "decision", "acepta") === 2, "lo de 2019 (a1 rechazaba) no existe");
}

async function main() {
  puro();
  await runWithCliente("DEMO", async () => {
    try {
      await runWithClienteDb("DEMO", (trx) => sql`select count(*) from eventos_automatizacion`.execute(trx));
    } catch (e) {
      console.error("✗ no pude comprobar: la base no responde (¿db:migrate?):", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    await limpiar();
    try {
      await base();
    } finally {
      await limpiar();
    }
  });
  console.log(fallos ? `\n✗ ${fallos} comprobación(es) fallida(s)` : "\n✓ qa:conversacion en verde");
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.stack ?? e.message : e);
  try {
    await runWithCliente("DEMO", limpiar);
  } catch {
    /* la limpieza ya falló: se deja rastro en consola */
  }
  process.exit(2);
});
