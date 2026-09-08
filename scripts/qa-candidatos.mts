// scripts/qa-candidatos.mts
//
// QA de `lib/agente/candidatos-eval` (plan maestro 2.7, MEJORAS 182): un hilo
// LEJANO (2020-01-27) sembrado en DEMO con dos turnos —uno que el agente
// siguió con borrador, otro entregado— contra marcar, volver a marcar
// (upsert), anotar en los turnos, revisar, y el aislamiento por RLS desde
// otro cliente (§5: intentar saltárselo).
// Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { porQueDeHilo } from "../app/lib/agente/por-que";
import {
  marcarCandidato,
  correccionesDeHilo,
  anotarCorrecciones,
  listarCandidatos,
  revisarCandidato,
  CandidatoInvalidoError,
  TurnoNoEncontradoError,
} from "../app/lib/agente/candidatos-eval";
import { etiquetaFallo } from "../app/lib/agente/candidatos-eval.tipos";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));

const TEL = "+34600000993";
const POR = { id: "qa-usuario", nombre: "QA" };

async function limpiar() {
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`delete from casos_candidatos_eval where telefono = ${TEL}`.execute(trx);
    await sql`delete from eventos_automatizacion where mensaje_id like 'qa-ce-%'`.execute(trx);
    await sql`delete from mensajes_whatsapp where telefono = ${TEL}`.execute(trx);
  });
}

async function falla(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

async function main() {
  let idDemo = "";
  await runWithCliente("DEMO", async () => {
    try {
      await runWithClienteDb("DEMO", (trx) => sql`select count(*) from casos_candidatos_eval`.execute(trx));
    } catch (e) {
      console.error("✗ no pude comprobar: la base no responde o falta la migración 043:", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    await limpiar();

    console.log("Siembra (contada a mano)");
    await runWithClienteDb("DEMO", async (trx) => {
      const msgs: Array<[string, string, string, string, boolean, string]> = [
        ["qa-ce-1", "Entrante", "¿cuánto cuesta una limpieza?", "2020-01-27T10:00:00+01:00", false, "text"],
        ["qa-ce-2", "Saliente", "La limpieza son 60 €.", "2020-01-27T10:05:00+01:00", true, "text"],
        ["qa-ce-3", "Entrante", "quiero hablar con alguien ya", "2020-01-27T11:00:00+01:00", false, "text"],
      ];
      for (const [id, dir, txt, ts, ia, tipo] of msgs) {
        await sql`insert into mensajes_whatsapp (id, cliente, telefono, direccion, contenido, "timestamp", fuente, autor, sugerido_por_ia, tipo, waba_message_id, clinica_id)
                  values (${id}, 'DEMO', ${TEL}, ${dir}, ${txt}, ${ts}::timestamptz, 'qa', ${dir === "Saliente" ? "persona" : null}, ${ia}, ${tipo}, null, 'qa-clinica')`.execute(trx);
      }
      const p1 = {
        v: 1, tema: "presupuesto", peticionOQueja: false, malestar: false, urgenciaMedica: false, mencionaAntecedenteMedico: false,
        vuelveSobreAplazado: null, camposRecogidos: { presupuesto: { tratamiento: "limpieza" } }, hiloTruncado: false, borradorDescartado: null,
        respuesta: "La limpieza son 60 €.", entrada: "SYSTEM…\nUSER: ¿cuánto cuesta una limpieza?",
        version: { evaluador: "aaaaaaaaaaaa", juez: "bbbbbbbbbbbb", conocimiento: null, objetivos: null },
        modelo: "claude-haiku-4-5-20251001", latenciaMs: 800, usage: { inputTokens: 900, outputTokens: 50 },
      };
      const p3 = {
        v: 1, tema: "otro", peticionOQueja: true, malestar: true, urgenciaMedica: false, mencionaAntecedenteMedico: false,
        vuelveSobreAplazado: null, camposRecogidos: {}, hiloTruncado: false, borradorDescartado: null, respuesta: "",
      };
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, evaluacion_json, created_at)
                values ('DEMO', 'conversacion', ${TEL}, 'evaluacion', 'agente', 'qa-ce-1', ${JSON.stringify(p1)}, '2020-01-27T10:00:05+01:00'::timestamptz)`.execute(trx);
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, evaluacion_json, created_at)
                values ('DEMO', 'conversacion', ${TEL}, 'evaluacion', 'agente', 'qa-ce-3', ${JSON.stringify(p3)}, '2020-01-27T11:00:05+01:00'::timestamptz)`.execute(trx);
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, causa_derivacion, malestar, created_at)
                values ('DEMO', 'conversacion', ${TEL}, 'derivado', 'agente', 'qa-ce-3', 'peticion_queja', true, '2020-01-27T11:00:06+01:00'::timestamptz)`.execute(trx);
    });
    ok("3 mensajes y 3 eventos en dos turnos, el 2020-01-27");

    console.log("Validación");
    const e1 = await falla(() => marcarCandidato({ telefono: TEL, clave: "qa-ce-1", fallo: "borrador", correccion: "  ", por: POR }));
    check(e1 instanceof CandidatoInvalidoError, `«borrador» sin texto → inválido (${e1 instanceof Error ? e1.message : e1})`);
    const e2 = await falla(() => marcarCandidato({ telefono: TEL, clave: "qa-ce-1", fallo: "inventado", correccion: "x", por: POR }));
    check(e2 instanceof CandidatoInvalidoError, "un fallo fuera del vocabulario → inválido");
    const e3 = await falla(() => marcarCandidato({ telefono: TEL, clave: "no-existe", fallo: "decision", correccion: null, por: POR }));
    check(e3 instanceof TurnoNoEncontradoError, "un turno que no está → no encontrado");
    check((await correccionesDeHilo(TEL)) && Object.keys(await correccionesDeHilo(TEL)).length === 0, "nada guardado tras los rechazos");

    console.log("Marcar");
    const m1 = await marcarCandidato({ telefono: TEL, clave: "qa-ce-1", fallo: "borrador", correccion: "No damos precios por WhatsApp: hay que ofrecer una visita.", por: POR });
    idDemo = m1.id;
    check(m1.fallo === "borrador" && m1.estado === "pendiente" && m1.porNombre === "QA", `turno 1 marcado, pendiente, por QA (${m1.fallo}/${m1.estado})`);
    const fila1 = await runWithClienteDb("DEMO", (trx) =>
      sql<{ decision_agente: string; mensaje_paciente: string | null; entrada: string | null; borrador: string | null; juicio: { juicio?: { tema?: string }; tecnico?: { entrada?: unknown } } | null; version: { evaluador?: string } | null; causa_entrega: string | null; clinica_id: string | null }>`
        select decision_agente, mensaje_paciente, entrada, borrador, juicio, version, causa_entrega, clinica_id from casos_candidatos_eval where mensaje_id = 'qa-ce-1'`.execute(trx),
    );
    const f1 = fila1.rows[0];
    check(f1?.decision_agente === "siguio" && f1?.causa_entrega === null, `copió la decisión: siguió (${f1?.decision_agente})`);
    check(f1?.mensaje_paciente === "¿cuánto cuesta una limpieza?", "copió el mensaje del paciente");
    check(f1?.entrada?.startsWith("SYSTEM") === true, "copió la entrada renderizada (169)");
    check(f1?.borrador === "La limpieza son 60 €.", "copió el borrador");
    check(f1?.juicio?.juicio?.tema === "presupuesto" && f1?.juicio?.tecnico?.entrada === undefined, "el juicio guardado es el turno explicado, sin duplicar la entrada");
    check(f1?.version?.evaluador === "aaaaaaaaaaaa", "copió la versión (168)");
    check(f1?.clinica_id === "qa-clinica", `la clínica del hilo (${f1?.clinica_id})`);

    console.log("Volver a marcar (upsert) y revisar");
    await revisarCandidato(m1.id, "aceptado", "entra en la tanda");
    check((await listarCandidatos({ estado: "aceptado" })).some((c) => c.id === m1.id), "revisar → aceptado, aparece en la lista de aceptados");
    const m1b = await marcarCandidato({ telefono: TEL, clave: "qa-ce-1", fallo: "decision", correccion: null, por: { id: "otra", nombre: "Otra" } });
    const cuantos = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from casos_candidatos_eval where telefono = ${TEL}`.execute(trx));
    check(cuantos.rows[0]?.n === 1, `un candidato por turno: sigue habiendo 1 fila (${cuantos.rows[0]?.n})`);
    check(m1b.id === m1.id && m1b.fallo === "decision" && m1b.correccion === null && m1b.porNombre === "Otra", "la misma fila, con la corrección nueva y quién la hizo");
    check(m1b.estado === "pendiente", "volver a marcar reabre la revisión (pendiente)");
    check(etiquetaFallo("decision", "siguio") === "Debería haberlo pasado a una persona", "la etiqueta de la decisión va en contra de lo que hizo (siguió → debía pasarlo)");

    const m2 = await marcarCandidato({ telefono: TEL, clave: "qa-ce-3", fallo: "decision", correccion: null, por: POR });
    const fila2 = await runWithClienteDb("DEMO", (trx) =>
      sql<{ decision_agente: string; causa_entrega: string | null }>`select decision_agente, causa_entrega from casos_candidatos_eval where id = ${m2.id}`.execute(trx),
    );
    check(fila2.rows[0]?.decision_agente === "entrego" && fila2.rows[0]?.causa_entrega === "peticion_queja", `turno 2: copió la entrega y su causa (${fila2.rows[0]?.causa_entrega})`);
    check(etiquetaFallo("decision", "entrego").startsWith("No hacía falta"), "la etiqueta de la decisión cuando entregó: no hacía falta");

    console.log("Anotar en los turnos");
    const turnos = await anotarCorrecciones(TEL, await porQueDeHilo(TEL));
    check(turnos.length === 2 && turnos[0]?.correccion?.fallo === "decision" && turnos[1]?.correccion?.id === m2.id, "los dos turnos llevan su corrección");
    const pendientes = await listarCandidatos({ estado: "pendiente" });
    check(pendientes.filter((c) => c.telefono === TEL).length === 2, `dos pendientes de este hilo (${pendientes.filter((c) => c.telefono === TEL).length})`);
    const e4 = await falla(() => revisarCandidato("no-existe", "descartado", null));
    check(e4 instanceof TurnoNoEncontradoError, "revisar un id que no existe → error, no un éxito vacío (§1)");
  });

  console.log("Aislamiento (desde RB)");
  await runWithCliente("RB", async () => {
    const ajeno = await correccionesDeHilo(TEL);
    check(Object.keys(ajeno).length === 0, "RB no ve los candidatos de DEMO (RLS)");
    const e5 = await falla(() => revisarCandidato(idDemo, "aceptado", null));
    check(e5 instanceof TurnoNoEncontradoError, "RB no puede revisar un candidato de DEMO (cero filas → error)");
  });

  await runWithCliente("DEMO", limpiar);
  console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.stack : e);
  try {
    await runWithCliente("DEMO", limpiar);
  } catch {
    /* la limpieza es best-effort tras un fallo de infraestructura */
  }
  process.exit(2);
});
