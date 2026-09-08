// scripts/qa-confianza.mts
//
// QA de `lib/agente/confianza` (plan maestro 2.4, MEJORAS 179/184/185): dos
// sedes LEJANAS (2020-01-22) sembradas en DEMO con un log contado a mano —
// turnos, un descarte del control, entregas por causa, un aplazado, envíos
// medidos (uno fuera de ventana, uno de lead por la sede del caso), un saliente
// pendiente que no es un envío, y dos turnos marcados «se equivocó»— contra lo
// que devuelve el bloque por sede, el agregado, el aislamiento por alcance, la
// coincidencia de Inicio y la métrica diaria («dos caminos, un número»). La
// vara: legible, con la versión de hoy al lado. El reloj se inyecta (§14).
// Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { confianzaDe, coincidenciaDe, varaHoy, leerVara, ventanaConfianza } from "../app/lib/agente/confianza";
import { madurezDe, disparadorModoB, DISPARADOR_MODO_B } from "../app/lib/agente/confianza.tipos";
import { hashVersion } from "../app/lib/agente/version";
import { SYSTEM_PROMPT_EVALUADOR } from "../app/lib/agente/evaluador";
import { calcularDia } from "../app/lib/metricas/diarias";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));

const TEL_A = "+34600000989";
const TEL_B = "+34600000988";
const CLI_A = "qa-clinica-conf-a";
const CLI_B = "qa-clinica-conf-b";
const DIA = "2020-01-22";
const AHORA = new Date("2020-02-10T09:00:00+01:00"); // ventana: 2020-01-11 … 2020-02-09

async function limpiar() {
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`delete from casos_candidatos_eval where telefono in (${TEL_A}, ${TEL_B})`.execute(trx);
    await sql`delete from eventos_automatizacion where mensaje_id like 'qa-cf-%' or caso_id in (${TEL_A}, ${TEL_B}, 'qa-cf-lead-b')`.execute(trx);
    await sql`delete from mensajes_whatsapp where telefono in (${TEL_A}, ${TEL_B})`.execute(trx);
    await sql`delete from leads where id = 'qa-cf-lead-b'`.execute(trx);
    await sql`delete from clinicas where id in (${CLI_A}, ${CLI_B})`.execute(trx);
  });
}

async function main() {
  await runWithCliente("DEMO", async () => {
    try {
      await runWithClienteDb("DEMO", (trx) => sql`select count(*) from casos_candidatos_eval`.execute(trx));
    } catch (e) {
      console.error("✗ no pude comprobar: la base no responde (¿db:migrate?):", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    await limpiar();

    console.log("Siembra (contada a mano)");
    await runWithClienteDb("DEMO", async (trx) => {
      await sql`insert into clinicas (id, cliente, nombre, activa) values (${CLI_A}, 'DEMO', 'QA Confianza A', false), (${CLI_B}, 'DEMO', 'QA Confianza B', false)`.execute(trx);
      // Sede A: tres entrantes evaluados, tres salientes de persona (uno tras cada
      // uno) y un saliente PENDIENTE que no es un envío. Sin waba_message_id: el
      // log enlaza por el id de la fila, como el seed.
      const msgsA: Array<[string, string, string, string, string | null, boolean, string]> = [
        ["qa-cf-a1", "Entrante", "acepto el presupuesto", `${DIA}T10:00:00+01:00`, null, false, "qa"],
        ["qa-cf-a2", "Saliente", "perfecto, te llamamos", `${DIA}T10:10:00+01:00`, "persona", true, "qa"],
        ["qa-cf-a3", "Entrante", "¿me hacéis descuento?", `${DIA}T11:00:00+01:00`, null, false, "qa"],
        ["qa-cf-a4", "Saliente", "te lo confirma la doctora", `${DIA}T11:10:00+01:00`, "persona", true, "qa"],
        ["qa-cf-a5", "Entrante", "me duele mucho", `${DIA}T12:00:00+01:00`, null, false, "qa"],
        ["qa-cf-a6", "Saliente", "ven ahora mismo", `${DIA}T12:10:00+01:00`, "persona", true, "qa"],
        ["qa-cf-a7", "Saliente", "pendiente", `${DIA}T12:20:00+01:00`, "persona", false, "Modo_A_manual_pendiente"],
      ];
      for (const [id, dir, txt, ts, autor, ia, fuente] of msgsA) {
        await sql`insert into mensajes_whatsapp (id, cliente, telefono, direccion, contenido, "timestamp", fuente, autor, sugerido_por_ia, clinica_id, tipo, waba_message_id)
                  values (${id}, 'DEMO', ${TEL_A}, ${dir}, ${txt}, ${ts}::timestamptz, ${fuente}, ${autor}, ${ia}, ${CLI_A}, 'text', null)`.execute(trx);
      }
      const msgsB: Array<[string, string, string, string, string | null, boolean]> = [
        ["qa-cf-b1", "Entrante", "quiero hablar con alguien", `${DIA}T16:00:00+01:00`, null, false],
        ["qa-cf-b2", "Saliente", "claro, dime", `${DIA}T16:05:00+01:00`, "persona", false],
      ];
      for (const [id, dir, txt, ts, autor, ia] of msgsB) {
        await sql`insert into mensajes_whatsapp (id, cliente, telefono, direccion, contenido, "timestamp", fuente, autor, sugerido_por_ia, clinica_id, tipo, waba_message_id)
                  values (${id}, 'DEMO', ${TEL_B}, ${dir}, ${txt}, ${ts}::timestamptz, 'qa', ${autor}, ${ia}, ${CLI_B}, 'text', null)`.execute(trx);
      }
      // Turnos: A ×3 (el segundo con el borrador parado por el control), B ×1.
      const turnos: Array<[string, string, string, object]> = [
        [TEL_A, "qa-cf-a1", `${DIA}T10:00:05+01:00`, { v: 1, tema: "presupuesto", borradorDescartado: null }],
        [TEL_A, "qa-cf-a3", `${DIA}T11:00:05+01:00`, { v: 1, tema: "presupuesto", borradorDescartado: { motivo: "economica", frase: "te lo dejamos en 300 €" } }],
        [TEL_A, "qa-cf-a5", `${DIA}T12:00:05+01:00`, { v: 1, tema: "cita", borradorDescartado: null }],
        [TEL_B, "qa-cf-b1", `${DIA}T16:00:05+01:00`, { v: 1, tema: "otro", borradorDescartado: null }],
      ];
      for (const [tel, mid, ts, payload] of turnos) {
        await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, evaluacion_json, created_at)
                  values ('DEMO', 'conversacion', ${tel}, 'evaluacion', 'qa', ${mid}, ${JSON.stringify(payload)}, ${ts}::timestamptz)`.execute(trx);
      }
      // Entregas: A caso_completo + urgencia; B petición/queja. Aplazado en A.
      const entregas: Array<[string, string, string, string]> = [
        [TEL_A, "qa-cf-a1", "caso_completo", `${DIA}T10:00:06+01:00`],
        [TEL_A, "qa-cf-a5", "urgencia", `${DIA}T12:00:06+01:00`],
        [TEL_B, "qa-cf-b1", "peticion_queja", `${DIA}T16:00:06+01:00`],
      ];
      for (const [tel, mid, causa, ts] of entregas) {
        // La petición/queja lleva `malestar` obligatorio (check de 023).
        const malestar = causa === "peticion_queja" ? false : null;
        await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, causa_derivacion, malestar, motivo_texto, created_at)
                  values ('DEMO', 'conversacion', ${tel}, 'derivado', 'qa', ${mid}, ${causa}, ${malestar}, 'qa', ${ts}::timestamptz)`.execute(trx);
      }
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, clave_aplazado, motivo_texto, created_at)
                values ('DEMO', 'conversacion', ${TEL_A}, 'aplazado', 'qa', 'qa-cf-a3', 'precio_descuento', 'qa', ${`${DIA}T11:00:06+01:00`}::timestamptz)`.execute(trx);
      // Envíos medidos de A: tal cual, tal cual, editado, reescrito; y uno FUERA
      // de la ventana (5 de enero) que no cuenta.
      const envios: Array<[string, number, string]> = [
        ["qa-cf-env-1", 0, `${DIA}T10:10:01+01:00`],
        ["qa-cf-env-2", 0, `${DIA}T11:10:01+01:00`],
        ["qa-cf-env-3", 0.2, `${DIA}T12:10:01+01:00`],
        ["qa-cf-env-4", 0.6, `${DIA}T12:10:02+01:00`],
        ["qa-cf-env-fuera", 0, "2020-01-05T10:00:00+01:00"],
      ];
      for (const [mid, d, ts] of envios) {
        await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, distancia_edicion, largo_sugerido, created_at)
                  values ('DEMO', 'conversacion', ${TEL_A}, 'mensaje_enviado', 'qa', ${mid}, ${d}, 30, ${ts}::timestamptz)`.execute(trx);
      }
      // Un envío de LEAD de la sede B: la sede sale del caso, no de un hilo.
      await sql`insert into leads (id, cliente, nombre, telefono, estado, clinica_id, created_at)
                values ('qa-cf-lead-b', 'DEMO', 'QA Lead B', '+34600000987', 'Nuevo', ${CLI_B}, ${`${DIA}T09:00:00+01:00`}::timestamptz)`.execute(trx);
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, distancia_edicion, largo_sugerido, created_at)
                values ('DEMO', 'lead', 'qa-cf-lead-b', 'mensaje_enviado', 'qa', 'qa-cf-env-lead', 0, 30, ${`${DIA}T16:05:01+01:00`}::timestamptz)`.execute(trx);
      // Marcados (2.7): dos en A dentro de la ventana (pendiente + aceptado) y uno fuera.
      const marcados: Array<[string, string, string, string, string | null]> = [
        ["qa-cf-a3", "borrador", "pendiente", `${DIA}T12:00:00+01:00`, null],
        ["qa-cf-a5", "decision", "aceptado", `${DIA}T13:00:00+01:00`, `${DIA}T14:00:00+01:00`],
        ["qa-cf-a1", "otro", "pendiente", "2020-01-05T12:00:00+01:00", null],
      ];
      for (const [mid, fallo, estado, marcadoEn, revisadoEn] of marcados) {
        await sql`insert into casos_candidatos_eval (cliente, clinica_id, telefono, mensaje_id, mensaje_paciente, decision_agente, fallo, correccion, marcado_por, marcado_por_nombre, marcado_en, estado, revisado_en)
                  values ('DEMO', ${CLI_A}, ${TEL_A}, ${mid}, 'qa', 'siguio', ${fallo}, 'qa', 'qa', 'QA', ${marcadoEn}::timestamptz, ${estado}, ${revisadoEn}::timestamptz)`.execute(trx);
      }
    });
    ok("2 sedes, 9 mensajes, 4 turnos, 3 entregas, 1 aplazado, 6 envíos medidos (1 fuera de ventana, 1 de lead) y 3 marcados (1 fuera)");

    console.log("Ventana");
    const v = ventanaConfianza(AHORA);
    check(v.desde === "2020-01-11" && v.hasta === "2020-02-09" && v.dias === 30, `30 días completos hasta ayer: ${v.desde} … ${v.hasta}`);

    console.log("Por sede (red)");
    const red = await confianzaDe({ cliente: "DEMO", clinicaIds: null, ahora: AHORA });
    const A = red.clinicas.find((c) => c.clinicaId === CLI_A);
    const B = red.clinicas.find((c) => c.clinicaId === CLI_B);
    check(!!A && !!B && A.nombre === "QA Confianza A", "las dos sedes salen con su nombre");
    check(A?.turnos === 3 && A?.descartes === 1, `A: 3 turnos, 1 parado por el control (${A?.turnos}/${A?.descartes})`);
    check(A?.entregas === 2 && A?.entregasListas === 1 && madurezDe(A!) === 50, `A: 2 entregas, 1 con el caso listo → libera el 50 % (${madurezDe(A!)})`);
    check(A?.exigenPersona.urgencia === 1 && Object.keys(A?.exigenPersona ?? {}).length === 1, "A: lo que sigue exigiendo persona = urgencia ×1 (caso_completo no está)");
    check(A?.aplazados.precio_descuento === 1, "A: aplazó una pregunta de precio");
    check(A?.coincidencia.total === 4 && A?.coincidencia.talCual === 2 && A?.coincidencia.editado === 1 && A?.coincidencia.reescrito === 1 && A?.coincidencia.tasaTalCual === 50,
      `A: 4 envíos medidos → 2 tal cual, 1 editado, 1 reescrito (50 %); el de enero no cuenta (${JSON.stringify(A?.coincidencia)})`);
    check(A?.coincidencia.enviosDelEquipo === 3, `A: 3 envíos del equipo (el pendiente no es un envío) (${A?.coincidencia.enviosDelEquipo})`);
    check(A?.marcados.total === 2 && A?.marcados.pendientes === 1 && A?.marcados.aceptados === 1 && A?.marcados.descartados === 0, `A: 2 marcados en la ventana, 1 pendiente + 1 aceptado; el de enero no cuenta (${JSON.stringify(A?.marcados)})`);
    check(B?.turnos === 1 && B?.descartes === 0 && B?.entregas === 1 && B?.entregasListas === 0 && madurezDe(B!) === 0, "B: 1 turno, sin descartes, 1 entrega por queja → libera el 0 %");
    check(B?.exigenPersona.peticion_queja === 1, "B: sigue exigiendo persona = pidió persona ×1");
    check(B?.coincidencia.total === 1 && B?.coincidencia.tasaTalCual === 100 && B?.coincidencia.enviosDelEquipo === 1, `B: el envío del LEAD cuenta en su sede por el caso (${JSON.stringify(B?.coincidencia)})`);
    check(B?.marcados.total === 0, "B: nada marcado");

    console.log("Agregado");
    const t = red.total;
    check(t.turnos === 4 && t.entregas === 3 && t.entregasListas === 1 && t.descartes === 1, `red: 4 turnos, 3 entregas (1 lista), 1 descarte (${t.turnos}/${t.entregas}/${t.entregasListas}/${t.descartes})`);
    check(t.coincidencia.total === 5 && t.coincidencia.talCual === 3 && t.coincidencia.tasaTalCual === 60 && t.coincidencia.enviosDelEquipo === 4, `red: coincidencia recalculada desde las distancias, 3 de 5 (60 %), 4 envíos del equipo (${JSON.stringify(t.coincidencia)})`);
    check(t.exigenPersona.urgencia === 1 && t.exigenPersona.peticion_queja === 1 && t.marcados.total === 2, "red: causas y marcados sumados");
    const disp = disparadorModoB(t.coincidencia);
    check(!disp.alcanzado && /faltan envíos/.test(disp.motivo ?? ""), `disparador de modo B no alcanzado, y dice por qué: «${disp.motivo}» (umbral ${DISPARADOR_MODO_B.tasaTalCual} % / ${DISPARADOR_MODO_B.envios})`);
    check(disparadorModoB({ total: 60, tasaTalCual: 85 }).alcanzado && !disparadorModoB({ total: 60, tasaTalCual: 70 }).alcanzado, "el disparador se cumple con 85 % sobre 60 y no con 70 %");

    console.log("Aislamiento por alcance (§5)");
    const soloA = await confianzaDe({ cliente: "DEMO", clinicaIds: [CLI_A], ahora: AHORA });
    check(soloA.clinicas.length === 1 && soloA.clinicas[0]?.clinicaId === CLI_A, "alcance [A]: solo la sede A en el payload (B no aparece, ni a cero)");
    check(soloA.total.turnos === 3 && soloA.total.coincidencia.total === 4 && soloA.total.marcados.total === 2, "alcance [A]: el agregado es el de A");
    const soloB = await confianzaDe({ cliente: "DEMO", clinicaIds: [CLI_B], ahora: AHORA });
    check(soloB.clinicas.length === 1 && soloB.total.turnos === 1 && soloB.total.coincidencia.total === 1, "alcance [B]: solo B");
    const sinSede = red.clinicas.find((c) => c.clinicaId == null);
    check(!soloA.clinicas.some((c) => c.clinicaId == null), `los hilos sin sede solo los ve la red${sinSede ? ` (la red los tiene: ${sinSede.turnos} turnos)` : ""}`);

    console.log("Inicio › Tu equipo (el mismo dato)");
    const coA = await coincidenciaDe({ cliente: "DEMO", clinicaIds: [CLI_A], ahora: AHORA });
    check(coA.total === 4 && coA.tasaTalCual === 50 && coA.enviosDelEquipo === 3 && coA.desde === v.desde && coA.hasta === v.hasta, `coincidenciaDe([A]) coincide con el bloque (${JSON.stringify(coA)})`);

    console.log("Dos caminos, un número: la serie diaria");
    const diaA = await calcularDia({ cliente: "DEMO", clinicaId: CLI_A, dia: DIA });
    check(diaA.envios_tal_cual?.valor === 2 && diaA.envios_tal_cual?.n === 4, `metricas_diarias A ${DIA}: envíos tal cual 2 de 4 (${diaA.envios_tal_cual?.valor}/${diaA.envios_tal_cual?.n})`);
    const diaB = await calcularDia({ cliente: "DEMO", clinicaId: CLI_B, dia: DIA });
    check(diaB.envios_tal_cual?.valor === 1 && diaB.envios_tal_cual?.n === 1, `metricas_diarias B ${DIA}: el envío del lead, por la sede del caso (${diaB.envios_tal_cual?.valor}/${diaB.envios_tal_cual?.n})`);

    console.log("La vara");
    const vara = varaHoy();
    check(vara != null && vara.pasada.origen === "sintetico" && vara.pasada.decision.total > 0, `la última pasada es legible: ${vara?.pasada.decision.aciertos}/${vara?.pasada.decision.total} el ${vara?.pasada.fecha} (${vara?.pasada.origen})`);
    check(vara?.hoy.evaluador === hashVersion(SYSTEM_PROMPT_EVALUADOR), "la versión de hoy es el hash del prompt que corre");
    check(vara?.mideLoQueCorre === (vara?.pasada.version.evaluador === vara?.hoy.evaluador && vara?.pasada.version.juez === vara?.hoy.juez), `«mide lo que corre» = versiones iguales (${vara?.mideLoQueCorre})`);
    if (vara && !vara.mideLoQueCorre) console.log(`  · aviso: el prompt cambió desde la pasada (${vara.pasada.version.evaluador} → ${vara.hoy.evaluador}); la vara está por pasar`);
    check(leerVara({}) === null && leerVara(null) === null && leerVara({ ...vara!.pasada, decision: { aciertos: "x" } }) === null, "una vara ilegible es null, no un número");
    check(leerVara(vara!.pasada)?.decision.aciertos === vara!.pasada.decision.aciertos, "la vara válida se relee igual");
  });

  await runWithCliente("DEMO", limpiar);
  console.log(fallos ? `\n✗ ${fallos} fallo(s)` : "\n✓ qa:confianza en verde");
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
