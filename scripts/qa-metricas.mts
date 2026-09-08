// scripts/qa-metricas.mts
//
// QA de `lib/metricas/diarias` (MEJORAS 172): un día LEJANO (2020-01-15, un
// miércoles) sembrado en DEMO con valores contados a mano, contra el cálculo.
// El reloj no interviene en el cálculo (el día es un parámetro, §14); el
// `calculado_en` sí se inyecta. Siembra con teléfono reservado y limpia.
// Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { calcularDia, guardarDia, serie, diasEntre, ayerISO, METRICAS_V1 } from "../app/lib/metricas/diarias";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));

const TEL = "+34600000993";
const DIA = "2020-01-15";
/** 2.5 · un segundo hilo y un segundo día (jueves 16) para la respuesta humana. */
const TEL2 = "+34600000992";
const DIA2 = "2020-01-16";
const CLINICA = "qa-clinica-metricas";

async function limpiar() {
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`delete from eventos_automatizacion where mensaje_id like 'qa-met-%'`.execute(trx);
    await sql`delete from mensajes_whatsapp where telefono in (${TEL}, ${TEL2})`.execute(trx);
    await sql`delete from citas where id = 'qa-met-cita'`.execute(trx);
    await sql`delete from leads where id in ('qa-met-lead', 'qa-met-lead2')`.execute(trx);
    await sql`delete from pagos_paciente where id = 'qa-met-pago'`.execute(trx);
    await sql`delete from pacientes where id = 'qa-met-pac'`.execute(trx);
    await sql`delete from metricas_diarias where dia in (${DIA}::date, ${DIA2}::date)`.execute(trx);
    await sql`delete from clinicas where id = ${CLINICA}`.execute(trx);
  });
}

async function main() {
  await runWithCliente("DEMO", async () => {
    try {
      await runWithClienteDb("DEMO", (trx) => sql`select count(*) from metricas_diarias`.execute(trx));
    } catch (e) {
      console.error("✗ no pude comprobar: la tabla metricas_diarias no responde (¿db:migrate?):", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    await limpiar();

    console.log("Siembra (contada a mano)");
    // 10:00 entrante → 10:30 saliente del agente (30 min laborables).
    // 11:00 entrante → 11:05 saliente PENDIENTE (no cuenta) → 11:10 entrante (mismo turno).
    await runWithClienteDb("DEMO", async (trx) => {
      // La clínica de prueba existe de verdad (citas tiene clave foránea a clinicas) y se borra al final.
      await sql`insert into clinicas (id, cliente, nombre, activa) values (${CLINICA}, 'DEMO', 'QA Clínica métricas', false)`.execute(trx);
      const filas: Array<[string, string, string, string, string | null, boolean]> = [
        ["qa-met-1", "Entrante", "hola", "2020-01-15T10:00:00+01:00", null, false],
        ["qa-met-2", "Saliente", "buenos días", "2020-01-15T10:30:00+01:00", "agente", true],
        ["qa-met-3", "Entrante", "otra cosa", "2020-01-15T11:00:00+01:00", null, false],
        ["qa-met-4", "Saliente", "pendiente", "2020-01-15T11:05:00+01:00", "persona", false],
        ["qa-met-5", "Entrante", "sigo aquí", "2020-01-15T11:10:00+01:00", null, false],
      ];
      for (const [id, dir, txt, ts, autor, ia] of filas) {
        const fuente = id === "qa-met-4" ? "Modo_A_manual_pendiente" : "qa";
        await sql`insert into mensajes_whatsapp (id, cliente, telefono, direccion, contenido, "timestamp", fuente, autor, sugerido_por_ia, clinica_id, tipo, waba_message_id)
                  values (${id}, 'DEMO', ${TEL}, ${dir}, ${txt}, ${ts}::timestamptz, ${fuente}, ${autor}, ${ia}, ${CLINICA}, 'text', ${id})`.execute(trx);
      }
      await sql`insert into leads (id, cliente, nombre, telefono, estado, created_at)
                values ('qa-met-lead', 'DEMO', 'QA Métricas', ${TEL}, 'Nuevo', '2020-01-15T12:00:00+01:00'::timestamptz)`.execute(trx);
      // Lead citado ese día (la fecha real es la de la cita agendada) y lead convertido ese día.
      await sql`insert into citas (id, cliente, nombre, hora_inicio, hora_final, estado, lead_id, clinica_id, agendada_en, origen_sistema)
                values ('qa-met-cita', 'DEMO', 'QA cita', '2020-01-20T10:00:00+01:00'::timestamptz, '2020-01-20T10:30:00+01:00'::timestamptz, 'Programada', 'qa-met-lead', ${CLINICA}, '2020-01-15T12:30:00+01:00'::timestamptz, 'fyllio')`.execute(trx);
      await sql`insert into leads (id, cliente, nombre, telefono, estado, clinica_id, created_at, fecha_cierre)
                values ('qa-met-lead2', 'DEMO', 'QA Convertido', '+34600000991', 'Convertido', ${CLINICA}, '2019-12-01T12:00:00+01:00'::timestamptz, '2020-01-15T13:00:00+01:00'::timestamptz)`.execute(trx);
      // Pago de un paciente CON clínica (la clínica del pago es la del paciente).
      await sql`insert into pacientes (id, cliente, nombre, clinica_id) values ('qa-met-pac', 'DEMO', 'QA Paciente', ${CLINICA})`.execute(trx);
      await sql`insert into pagos_paciente (id, cliente, paciente_id, fecha_pago, importe) values ('qa-met-pago', 'DEMO', 'qa-met-pac', ${DIA}::date, 150)`.execute(trx);
      // Un turno del agente con latencia (jsonb desde la 042: se inserta como texto y Postgres lo valida).
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, evaluacion_json, created_at)
                values ('DEMO', 'conversacion', ${TEL}, 'evaluacion', 'qa', 'qa-met-1', ${JSON.stringify({ v: 1, latenciaMs: 1200, borradorDescartado: { motivo: "qa" } })}, '2020-01-15T10:00:05+01:00'::timestamptz)`.execute(trx);

      // 2.5 · DÍA 2 (jueves 16), otro hilo: las entregas del agente y la respuesta humana.
      //   09:00 entrante + entrega URGENCIA (prioritaria) → 09:10 saliente del AGENTE (no es una
      //   persona: no cuenta) → 09:20 saliente de persona PENDIENTE (no cuenta) → 09:30 entrante +
      //   segunda entrega «insistencia» (mismo episodio sin respuesta: se ignora) → 09:45 saliente
      //   de persona = 45 min laborables, prioritaria.
      //   12:00 entrante + entrega caso_completo (normal) → 12:30 saliente de persona = 30 min.
      //   16:00 entrante + entrega peticion_queja SIN malestar (normal), nadie contesta: no cuenta.
      const filas2: Array<[string, string, string, string, string | null, boolean, string]> = [
        ["qa-met-7", "Entrante", "me duele mucho", "2020-01-16T09:00:00+01:00", null, false, "qa"],
        ["qa-met-8", "Saliente", "lo paso al equipo", "2020-01-16T09:10:00+01:00", "agente", true, "qa"],
        ["qa-met-9", "Saliente", "pendiente", "2020-01-16T09:20:00+01:00", "persona", false, "Modo_A_manual_pendiente"],
        ["qa-met-9b", "Entrante", "¿hola?", "2020-01-16T09:30:00+01:00", null, false, "qa"],
        ["qa-met-10", "Saliente", "ven a las 12", "2020-01-16T09:45:00+01:00", "persona", false, "qa"],
        ["qa-met-11", "Entrante", "acepto", "2020-01-16T12:00:00+01:00", null, false, "qa"],
        ["qa-met-12", "Saliente", "perfecto", "2020-01-16T12:30:00+01:00", "persona", false, "qa"],
        ["qa-met-13", "Entrante", "quiero hablar con alguien", "2020-01-16T16:00:00+01:00", null, false, "qa"],
      ];
      // SIN waba_message_id a propósito: el evento enlaza por el id de la fila (como el
      // barrido y como el seed), y la clínica tiene que resolverse igual.
      for (const [id, dir, txt, ts, autor, ia, fuente] of filas2) {
        await sql`insert into mensajes_whatsapp (id, cliente, telefono, direccion, contenido, "timestamp", fuente, autor, sugerido_por_ia, clinica_id, tipo, waba_message_id)
                  values (${id}, 'DEMO', ${TEL2}, ${dir}, ${txt}, ${ts}::timestamptz, ${fuente}, ${autor}, ${ia}, ${CLINICA}, 'text', null)`.execute(trx);
      }
      const entregas: Array<[string, string, boolean | null, string]> = [
        ["qa-met-7", "urgencia", null, "2020-01-16T09:00:00+01:00"],
        ["qa-met-9b", "insistencia", null, "2020-01-16T09:30:00+01:00"],
        ["qa-met-11", "caso_completo", null, "2020-01-16T12:00:00+01:00"],
        ["qa-met-13", "peticion_queja", false, "2020-01-16T16:00:00+01:00"],
      ];
      for (const [mensajeId, causa, malestar, ts] of entregas) {
        await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, causa_derivacion, malestar, motivo_texto, created_at)
                  values ('DEMO', 'conversacion', ${TEL2}, 'derivado', 'qa', ${mensajeId}, ${causa}, ${malestar}, 'qa', ${ts}::timestamptz)`.execute(trx);
      }
    });
    ok("5 mensajes, 2 leads, 1 cita, 1 pago y 1 turno sembrados el 2020-01-15; 8 mensajes y 4 entregas el 2020-01-16");

    console.log("Cálculo (red)");
    const red = await calcularDia({ cliente: "DEMO", clinicaId: null, dia: DIA });
    check(red.entrantes?.valor === 3, `entrantes = 3 (${red.entrantes?.valor})`);
    check(red.salientes?.valor === 1, `salientes = 1, el pendiente no cuenta (${red.salientes?.valor})`);
    check(red.salientes_del_agente?.valor === 1, `salientes del agente = 1 (${red.salientes_del_agente?.valor})`);
    check(
      red.tiempo_respuesta_mediana_min?.valor === 30 && red.tiempo_respuesta_mediana_min?.n === 1,
      `tiempo de respuesta: mediana 30 min sobre 1 turno contestado (${red.tiempo_respuesta_mediana_min?.valor} / n=${red.tiempo_respuesta_mediana_min?.n})`,
    );
    check(red.leads_nuevos?.valor === 1, `leads nuevos = 1 (${red.leads_nuevos?.valor})`);
    check(red.leads_citados?.valor === 1, `leads citados = 1 por la cita agendada ese día (${red.leads_citados?.valor})`);
    check(red.leads_convertidos?.valor === 1, `leads convertidos = 1 por fecha_cierre (${red.leads_convertidos?.valor})`);
    check(red.presupuestos_presentados_n?.valor === 0 && red.aceptados_eur?.valor === 0 && red.perdidos_n?.valor === 0, "presupuestos/aceptados/perdidos = 0 (nada sembrado ese día)");
    check(red.pagos_eur?.valor === 150 && red.pagos_eur?.n === 1, `pagos a nivel de red = 150 € (${red.pagos_eur?.valor})`);
    check(red.evaluaciones?.valor === 1 && red.coste_usd?.valor === 0 && red.modelo_errores?.valor === 0, "agente: 1 evaluación sin usage (coste 0), 0 errores");
    check(red.modelo_latencia_mediana_ms?.valor === 1200 && red.modelo_latencia_mediana_ms?.n === 1, `latencia mediana 1200 ms sobre 1 turno (${red.modelo_latencia_mediana_ms?.valor})`);
    check(red.descartes_juez?.valor === 1, "descartes del juez = 1 (el payload lo trae como objeto)");
    check(red.respuesta_humana_prioritaria_min?.n === 0 && red.respuesta_humana_normal_min?.n === 0, "respuesta humana: sin entregas ese día → n = 0 en las dos colas (no se inventa un tiempo)");
    check(Object.keys(red).length === METRICAS_V1.length, `todas las métricas v1 calculadas (${Object.keys(red).length}/${METRICAS_V1.length})`);

    console.log("Cálculo (respuesta humana, día 2)");
    const d2 = await calcularDia({ cliente: "DEMO", clinicaId: null, dia: DIA2 });
    check(
      d2.respuesta_humana_prioritaria_min?.valor === 45 && d2.respuesta_humana_prioritaria_min?.n === 1,
      `prioritaria: 45 min sobre 1 entrega — ni el saliente del agente ni el pendiente cuentan (${d2.respuesta_humana_prioritaria_min?.valor} / n=${d2.respuesta_humana_prioritaria_min?.n})`,
    );
    check(
      d2.respuesta_humana_normal_min?.valor === 30 && d2.respuesta_humana_normal_min?.n === 1,
      `normal: 30 min sobre 1 entrega — la insistencia del mismo episodio se ignora y la queja sin contestar no cuenta (${d2.respuesta_humana_normal_min?.valor} / n=${d2.respuesta_humana_normal_min?.n})`,
    );
    check(d2.derivaciones?.valor === 4 && d2.derivaciones_caso_completo?.valor === 1, `derivaciones del día = 4, 1 con caso completo (${d2.derivaciones?.valor}/${d2.derivaciones_caso_completo?.valor})`);
    check(
      d2.tiempo_respuesta_mediana_min?.valor === 15 && d2.tiempo_respuesta_mediana_min?.n === 3,
      `contraste: el tiempo de respuesta SÍ cuenta al agente (turnos 10, 15 y 30 → mediana 15, n=3) (${d2.tiempo_respuesta_mediana_min?.valor} / n=${d2.tiempo_respuesta_mediana_min?.n})`,
    );
    const d2cli = await calcularDia({ cliente: "DEMO", clinicaId: CLINICA, dia: DIA2 });
    check(d2cli.respuesta_humana_prioritaria_min?.valor === 45 && d2cli.respuesta_humana_normal_min?.valor === 30, "la clínica del mensaje entregado ve sus 45 y 30 min (sin waba_message_id: enlaza por el id de la fila)");
    check(d2cli.derivaciones?.valor === 4, `la clínica ve sus 4 derivaciones por el id de la fila (${d2cli.derivaciones?.valor})`);
    const d2otra = await calcularDia({ cliente: "DEMO", clinicaId: "otra-clinica", dia: DIA2 });
    check(d2otra.respuesta_humana_prioritaria_min?.n === 0 && d2otra.respuesta_humana_normal_min?.n === 0, "otra clínica no ve ninguna entrega");

    console.log("Cálculo (clínica)");
    const cli = await calcularDia({ cliente: "DEMO", clinicaId: CLINICA, dia: DIA });
    check(cli.entrantes?.valor === 3 && cli.tiempo_respuesta_mediana_min?.valor === 30, "la clínica del mensaje ve sus 3 entrantes y sus 30 min");
    check(cli.leads_nuevos?.valor === 0, "el lead sin clínica no cuenta en la clínica");
    check(cli.leads_citados?.valor === 1 && cli.leads_convertidos?.valor === 1, "la clínica ve su lead citado y su convertido");
    check(cli.pagos_eur?.valor === 150, `pagos por clínica = 150 € vía la clínica del paciente (${cli.pagos_eur?.valor})`);
    check(cli.evaluaciones?.valor === 1 && cli.modelo_latencia_mediana_ms?.valor === 1200, "la clínica ve el turno por el mensaje evaluado");
    check(Object.keys(cli).length === METRICAS_V1.length, "la clínica tiene todas las métricas (ninguna se salta por sede)");
    const otra = await calcularDia({ cliente: "DEMO", clinicaId: "otra-clinica", dia: DIA });
    check(otra.entrantes?.valor === 0 && otra.pagos_eur?.valor === 0 && otra.leads_citados?.valor === 0, "otra clínica no ve nada");

    console.log("Guardar (upsert) y leer");
    const ahora = new Date("2020-01-16T07:00:00+01:00");
    const g1 = await guardarDia({ cliente: "DEMO", clinicaId: null, dia: DIA, valores: red, ahora });
    const g2 = await guardarDia({ cliente: "DEMO", clinicaId: null, dia: DIA, valores: red, ahora });
    const filas = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from metricas_diarias where dia = ${DIA}::date and clinica_id is null`.execute(trx));
    check(g1.escritas === METRICAS_V1.length && g2.escritas === g1.escritas && Number(filas.rows[0]?.n) === METRICAS_V1.length, `dos guardados = ${METRICAS_V1.length} filas, sin duplicar (${filas.rows[0]?.n})`);
    const s = await serie({ cliente: "DEMO", clinicaId: null, metrica: "entrantes", desde: "2020-01-14", hasta: "2020-01-16" });
    check(s.length === 1 && s[0]?.dia === DIA && s[0]?.valor === 3 && s[0]?.definicionV === 1, `serie(entrantes) = [${DIA}: 3, v1]`);
    const calc = await runWithClienteDb("DEMO", (trx) => sql<{ c: Date }>`select max(calculado_en) as c from metricas_diarias where dia = ${DIA}::date`.execute(trx));
    check(new Date(calc.rows[0]?.c ?? 0).getTime() === ahora.getTime(), "calculado_en es el reloj inyectado");

    console.log("Utilidades");
    check(diasEntre("2020-01-30", "2020-02-02").join(",") === "2020-01-30,2020-01-31,2020-02-01,2020-02-02", "diasEntre cruza el mes");
    check(diasEntre("2020-01-01", "2020-12-31", 31).length === 31, "diasEntre respeta el tope");
    check(ayerISO(new Date("2020-03-01T00:30:00+01:00")) === "2020-02-29", "ayerISO en día de clínica (bisiesto)");
  });

  await runWithCliente("DEMO", limpiar);
  console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.message : e);
  try {
    await runWithCliente("DEMO", limpiar);
  } catch {
    /* la limpieza es best-effort tras un fallo de infraestructura */
  }
  process.exit(2);
});
