// scripts/qa-fuga.mts
//
// QA del mapa de fuga por etapa (2.2, MEJORAS 177). Dos sedes ficticias en
// DEMO con casos contados a mano en 2020 (fuera de cualquier dato del seed,
// que es relativo a hoy), reloj FIJO (hoy = 2020-03-01 → ventana de 30 días
// 31-ene…29-feb, la anterior 1-ene…30-ene), y se comprueba etapa por etapa:
//   · sin contacto vs sin cita (contador, acción, mensaje saliente enviado; un
//     saliente PENDIENTE de modo A no es contacto), la cita que sí hubo;
//   · el presupuesto reactivado que NO cuenta, el perdido-recuperado-perdido
//     que cuenta UNA vez en la ventana de su último paso, la ventana anterior;
//   · el cobro que cruzó a vencido dentro de la ventana vs el que ya venía
//     vencido (solo en «hoy»), y el saldado que no cuenta;
//   · la frase del agente en el presupuesto cerrado sin motivo;
//   · la estimación: null con motivo sin base, y contada a mano con base;
//   · aislamiento por sede y que la red es la suma.
// Limpia al terminar. Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { calcularFuga, type EtapaFuga, type Fuga } from "../app/lib/metricas/fuga";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));

const CLI_A = "qa-fg-a";
const CLI_B = "qa-fg-b";
const AHORA = new Date("2020-03-01T12:00:00Z");
const P = "qa-fg-";

async function limpiar() {
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`delete from eventos_automatizacion where mensaje_id like ${P + "%"}`.execute(trx);
    await sql`delete from historial_acciones where presupuesto_id like ${P + "%"}`.execute(trx);
    await sql`delete from pagos_paciente where paciente_id like ${P + "%"}`.execute(trx);
    await sql`delete from presupuestos where id like ${P + "%"}`.execute(trx);
    await sql`delete from acciones_lead where lead_id like ${P + "%"}`.execute(trx);
    await sql`delete from mensajes_whatsapp where id like ${P + "%"}`.execute(trx);
    await sql`delete from leads where id like ${P + "%"}`.execute(trx);
    await sql`delete from pacientes where id like ${P + "%"}`.execute(trx);
    await sql`delete from configuraciones_clinica where clinica_id in (${CLI_A}, ${CLI_B})`.execute(trx);
    await sql`delete from clinicas where id in (${CLI_A}, ${CLI_B})`.execute(trx);
  });
}

const etapa = (f: Fuga, e: EtapaFuga) => f.etapas.find((x) => x.etapa === e)!;
const motivo = (f: Fuga, e: EtapaFuga, clave: string) => etapa(f, e).motivos.find((m) => m.clave === clave);

async function sembrar() {
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`insert into clinicas (id, cliente, nombre, activa) values (${CLI_A}, 'DEMO', 'QA Fuga A', false), (${CLI_B}, 'DEMO', 'QA Fuga B', false)`.execute(trx);
    // Plazo de pago explícito: la regla de vencido depende de él y el QA no
    // puede heredar el que tenga DEMO configurado a nivel global.
    await sql`insert into configuraciones_clinica (cliente, clinica_id, categoria, valor, activo)
              values ('DEMO', ${CLI_A}, 'Plazos_Liquidacion', '90', true), ('DEMO', ${CLI_B}, 'Plazos_Liquidacion', '90', true)`.execute(trx);

    // ── Pacientes ──
    const pacientes: Array<[string, string, string]> = [
      [`${P}p1`, CLI_A, "600000001"],
      [`${P}p2`, CLI_A, "600000002"],
      [`${P}p3`, CLI_A, "600000003"],
      [`${P}p4`, CLI_A, "600000004"],
      [`${P}p5`, CLI_B, "600000005"],
      ...([1, 2, 3, 4, 5, 6] as const).map((k): [string, string, string] => [`${P}pb${k}`, CLI_B, `60000001${k}`]),
    ];
    for (const [id, cli, tel] of pacientes) {
      await sql`insert into pacientes (id, cliente, nombre, telefono, clinica_id, activo) values (${id}, 'DEMO', ${"QA " + id}, ${tel}, ${cli}, true)`.execute(trx);
    }

    // ── Leads (sede A) ──
    type Lead = { id: string; cli: string; estado: string; cierre: string | null; motivo: string | null; wa: number; llamado: boolean; cita: string | null; pac: string | null; creado: string };
    const leads: Lead[] = [
      // Ventana actual: l1 sin contacto; l9 solo con un saliente PENDIENTE (no es contacto)
      { id: `${P}l1`, cli: CLI_A, estado: "No Interesado", cierre: "2020-02-10T10:00:00Z", motivo: "No_Contesta", wa: 0, llamado: false, cita: null, pac: null, creado: "2020-01-05T09:00:00Z" },
      { id: `${P}l9`, cli: CLI_A, estado: "No Interesado", cierre: "2020-02-12T10:00:00Z", motivo: null, wa: 0, llamado: false, cita: null, pac: null, creado: "2020-01-05T09:00:00Z" },
      // Ventana actual, contactados: l2 por contador, l3 por acción de llamada y con cita
      { id: `${P}l2`, cli: CLI_A, estado: "No Interesado", cierre: "2020-02-15T10:00:00Z", motivo: "Precio", wa: 1, llamado: false, cita: null, pac: null, creado: "2020-01-05T09:00:00Z" },
      { id: `${P}l3`, cli: CLI_A, estado: "No Interesado", cierre: "2020-02-20T10:00:00Z", motivo: "No_Asistio", wa: 0, llamado: false, cita: "2020-02-18", pac: null, creado: "2020-01-05T09:00:00Z" },
      // Ventana anterior: l4 sin contacto; l8 contactado por un mensaje saliente enviado
      { id: `${P}l4`, cli: CLI_A, estado: "No Interesado", cierre: "2020-01-15T10:00:00Z", motivo: null, wa: 0, llamado: false, cita: null, pac: null, creado: "2020-01-05T09:00:00Z" },
      { id: `${P}l8`, cli: CLI_A, estado: "No Interesado", cierre: "2020-01-20T10:00:00Z", motivo: "Horarios", wa: 0, llamado: false, cita: null, pac: null, creado: "2020-01-05T09:00:00Z" },
      // Fuera de las dos ventanas, y uno abierto
      { id: `${P}l5`, cli: CLI_A, estado: "No Interesado", cierre: "2019-12-01T10:00:00Z", motivo: "Precio", wa: 0, llamado: false, cita: null, pac: null, creado: "2019-11-01T09:00:00Z" },
      { id: `${P}l6`, cli: CLI_A, estado: "Contactado", cierre: null, motivo: null, wa: 1, llamado: false, cita: null, pac: `${P}p2`, creado: "2020-01-05T09:00:00Z" },
      // Sede B: uno sin contacto, y seis convertidos con presupuesto aceptado (la base de la estimación)
      { id: `${P}l7`, cli: CLI_B, estado: "No Interesado", cierre: "2020-02-12T10:00:00Z", motivo: "Otra_Clinica", wa: 0, llamado: false, cita: null, pac: null, creado: "2020-01-05T09:00:00Z" },
      ...([1, 2, 3, 4, 5, 6] as const).map((k): Lead => ({ id: `${P}lb${k}`, cli: CLI_B, estado: "Convertido", cierre: "2020-01-20T10:00:00Z", motivo: null, wa: 1, llamado: false, cita: "2020-01-18", pac: `${P}pb${k}`, creado: "2020-01-05T09:00:00Z" })),
    ];
    for (const l of leads) {
      await sql`insert into leads (id, cliente, nombre, telefono, estado, clinica_id, fecha_cierre, motivo_no_interes, whatsapp_enviados, llamado, fecha_cita, paciente_id, convertido_a_paciente, created_at)
                values (${l.id}, 'DEMO', ${"QA " + l.id}, ${"6" + l.id.replace(/\D/g, "").padStart(8, "1")}, ${l.estado}, ${l.cli}, ${l.cierre}::timestamptz, ${l.motivo}, ${l.wa}, ${l.llamado}, ${l.cita}, ${l.pac}, ${l.pac != null}, ${l.creado}::timestamptz)`.execute(trx);
    }
    await sql`insert into acciones_lead (cliente, lead_id, tipo_accion, resumen, "timestamp") values ('DEMO', ${`${P}l3`}, 'Llamada', 'QA', '2020-02-16T10:00:00Z'::timestamptz)`.execute(trx);
    // l8: contacto por mensaje saliente ENVIADO (enlazado por lead_id)
    await sql`insert into mensajes_whatsapp (id, cliente, lead_id, telefono, direccion, contenido, "timestamp", fuente, tipo)
              values (${`${P}m8`}, 'DEMO', ${`${P}l8`}, '699999998', 'Saliente', 'hola', '2020-01-18T10:00:00Z'::timestamptz, 'qa', 'text')`.execute(trx);
    // l9: solo un saliente PENDIENTE de modo A, enlazado por teléfono — no llegó al paciente
    const telL9 = "6" + `${P}l9`.replace(/\D/g, "").padStart(8, "1");
    await sql`insert into mensajes_whatsapp (id, cliente, telefono, direccion, contenido, "timestamp", fuente, tipo)
              values (${`${P}m9`}, 'DEMO', ${telL9}, 'Saliente', 'borrador', '2020-02-11T10:00:00Z'::timestamptz, 'Modo_A_manual_pendiente', 'text')`.execute(trx);

    // ── Presupuestos ──
    type Pres = { id: string; cli: string; pac: string; estado: string; importe: number; motivo: string | null; tel: string | null; aceptado: string | null; perdidoEn: string[] };
    const presus: Pres[] = [
      { id: `${P}pr1`, cli: CLI_A, pac: `${P}p1`, estado: "PERDIDO", importe: 1200, motivo: "precio_alto", tel: null, aceptado: null, perdidoEn: ["2020-02-05T10:00:00Z"] },
      { id: `${P}pr2`, cli: CLI_A, pac: `${P}p1`, estado: "PERDIDO", importe: 800, motivo: null, tel: "+34 600 000 001", aceptado: null, perdidoEn: ["2020-02-08T10:00:00Z"] },
      { id: `${P}pr3`, cli: CLI_A, pac: `${P}p1`, estado: "INTERESADO", importe: 5000, motivo: null, tel: null, aceptado: null, perdidoEn: ["2020-02-09T10:00:00Z"] },
      { id: `${P}pr4`, cli: CLI_A, pac: `${P}p1`, estado: "PERDIDO", importe: 300, motivo: "otra_clinica", tel: null, aceptado: null, perdidoEn: ["2020-01-10T10:00:00Z"] },
      { id: `${P}pr6`, cli: CLI_A, pac: `${P}p1`, estado: "PERDIDO", importe: 100, motivo: "sin_urgencia", tel: null, aceptado: null, perdidoEn: ["2020-01-20T10:00:00Z", "2020-02-25T10:00:00Z"] },
      { id: `${P}pr5`, cli: CLI_B, pac: `${P}p5`, estado: "PERDIDO", importe: 500, motivo: "otra_clinica", tel: null, aceptado: null, perdidoEn: ["2020-02-06T10:00:00Z"] },
      // Cobros: pr7 cruza a vencido el 7-feb (dentro), pr8 el 8-dic-2019 (antes), pr9 saldado, pr10 (B) el 11-feb
      { id: `${P}pr7`, cli: CLI_A, pac: `${P}p2`, estado: "ACEPTADO", importe: 3000, motivo: null, tel: null, aceptado: "2019-11-01", perdidoEn: [] },
      { id: `${P}pr8`, cli: CLI_A, pac: `${P}p3`, estado: "ACEPTADO", importe: 2000, motivo: null, tel: null, aceptado: "2019-09-01", perdidoEn: [] },
      { id: `${P}pr9`, cli: CLI_A, pac: `${P}p4`, estado: "ACEPTADO", importe: 1000, motivo: null, tel: null, aceptado: "2019-11-01", perdidoEn: [] },
      { id: `${P}pr10`, cli: CLI_B, pac: `${P}p5`, estado: "ACEPTADO", importe: 700, motivo: null, tel: null, aceptado: "2019-11-05", perdidoEn: [] },
      ...([1, 2, 3, 4, 5, 6] as const).map((k): Pres => ({ id: `${P}prb${k}`, cli: CLI_B, pac: `${P}pb${k}`, estado: "ACEPTADO", importe: 1000, motivo: null, tel: null, aceptado: "2020-02-01", perdidoEn: [] })),
    ];
    for (const p of presus) {
      await sql`insert into presupuestos (id, cliente, paciente_id, estado, importe, motivo_perdida, paciente_telefono, fecha_aceptado, fecha, clinica_id, tratamiento_nombre)
                values (${p.id}, 'DEMO', ${p.pac}, ${p.estado}, ${p.importe}, ${p.motivo}, ${p.tel}, ${p.aceptado}::date, '2019-10-01'::date, ${p.cli}, 'QA')`.execute(trx);
      for (const f of p.perdidoEn) {
        await sql`insert into historial_acciones (cliente, presupuesto_id, tipo, descripcion, metadata, fecha)
                  values ('DEMO', ${p.id}, 'cambio_estado', 'QA', ${JSON.stringify({ estadoNuevo: "PERDIDO" })}, ${f}::timestamptz)`.execute(trx);
      }
    }
    await sql`insert into pagos_paciente (cliente, paciente_id, importe, tipo, fecha_pago) values ('DEMO', ${`${P}p4`}, 1000, 'Liquidacion', '2019-12-01'::timestamptz)`.execute(trx);

    // El agente recogió el motivo en la conversación del presupuesto sin motivo (pr2, teléfono +34 600 000 001)
    const payload = { v: 1, tema: "presupuesto", camposRecogidos: { presupuesto: { decision: "rechaza", motivo_rechazo: "me parece muy caro ahora mismo" } } };
    await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, evaluacion_json, created_at)
              values ('DEMO', 'conversacion', '34600000001', 'evaluacion', 'qa', ${`${P}ev1`}, ${JSON.stringify(payload)}, '2020-02-07T10:00:00Z'::timestamptz)`.execute(trx);
  });
}

async function main() {
  await runWithCliente("DEMO", async () => {
    try {
      await runWithClienteDb("DEMO", (trx) => sql`select count(*) from historial_acciones`.execute(trx));
    } catch (e) {
      console.error("✗ no pude comprobar: la base no responde (¿db:migrate?):", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    await limpiar();
    console.log("Siembra (contada a mano)");
    await sembrar();

    const A = await calcularFuga({ clinicaId: CLI_A, dias: 30, ahora: AHORA });
    const B = await calcularFuga({ clinicaId: CLI_B, dias: 30, ahora: AHORA });
    const R = await calcularFuga({ clinicaId: null, dias: 30, ahora: AHORA });

    console.log("Ventanas");
    check(A.ventana.desde === "2020-01-31" && A.ventana.hasta === "2020-02-29" && A.ventana.dias === 30, `30 días completos hasta ayer: ${A.ventana.desde} … ${A.ventana.hasta}`);
    check(A.ventanaPrevia.desde === "2020-01-01" && A.ventanaPrevia.hasta === "2020-01-30", `la anterior, misma longitud, justo antes: ${A.ventanaPrevia.desde} … ${A.ventanaPrevia.hasta}`);
    check(A.etapas.map((e) => e.etapa).join(">") === "sin_contacto>sin_cita>presupuesto_perdido>cobro_vencido", "las cuatro etapas, en orden");

    console.log("Sede A · leads");
    const sc = etapa(A, "sin_contacto");
    check(sc.actual.n === 2 && sc.actual.eur === null, `sin contacto: 2 (l1 y l9, cuyo único saliente era un PENDIENTE de modo A) y sin € (${sc.actual.n})`);
    check(sc.previo?.n === 1, `sin contacto, ventana anterior: 1 (l4) (${sc.previo?.n})`);
    check(motivo(A, "sin_contacto", "No_Contesta")?.n === 1 && motivo(A, "sin_contacto", "No_Contesta")?.reactivable === true && sc.sinMotivo === 1, "motivos: «No contesta» 1 (reactivable) + 1 sin motivo");
    const sq = etapa(A, "sin_cita");
    check(sq.actual.n === 2 && sq.previo?.n === 1, `sin cita: 2 (l2 por contador, l3 por llamada); anterior 1 (l8 por mensaje saliente enviado) (${sq.actual.n}/${sq.previo?.n})`);
    check(sq.conCita === 1, `de los contactados, 1 sí tuvo cita (l3) (${sq.conCita})`);
    check(motivo(A, "sin_cita", "Precio")?.reactivable === false && motivo(A, "sin_cita", "No_Asistio")?.reactivable === true, "«Precio» no reactivable, «No asistió» sí");
    check(sc.estimado?.eur === null && /pocos/.test(sc.estimado?.motivo ?? "") && sc.estimado?.captados === 8 && sc.estimado?.aceptados === 1, `A no estima: 8 captados, solo 1 aceptó (${sc.estimado?.motivo})`);
    check(sc.frasesDelAgente.length === 0, "los leads no llevan frase del agente (el objetivo cita no recoge motivo)");

    console.log("Sede A · presupuestos");
    const pp = etapa(A, "presupuesto_perdido");
    check(pp.actual.n === 3 && pp.actual.eur === 2100, `perdidos: 3 (pr1, pr2 y pr6 por su ÚLTIMO paso) = 2.100 €; pr3 reactivado no cuenta (${pp.actual.n} / ${pp.actual.eur})`);
    check(pp.previo?.n === 1 && pp.previo?.eur === 300, `ventana anterior: 1 (pr4, 300 €); el primer paso de pr6 no se cuenta dos veces (${pp.previo?.n} / ${pp.previo?.eur})`);
    check(motivo(A, "presupuesto_perdido", "precio_alto")?.eur === 1200 && motivo(A, "presupuesto_perdido", "precio_alto")?.etiqueta === "Precio alto" && pp.sinMotivo === 1, "motivos con €: «Precio alto» 1.200 €, 1 sin motivo");
    check(pp.frasesDelAgente.length === 1 && pp.frasesDelAgente[0].sugerido === "precio_alto", `el agente recogió «${pp.frasesDelAgente[0]?.frase}» → ${pp.frasesDelAgente[0]?.etiquetaSugerida}`);

    console.log("Sede A · cobros");
    const cv = etapa(A, "cobro_vencido");
    check(cv.actual.n === 1 && cv.actual.eur === 3000, `vencieron en la ventana: 1 (pr7, aceptado 1-nov + 90 + 7 + 1 = 7-feb) = 3.000 € (${cv.actual.n} / ${cv.actual.eur})`);
    check(cv.vencidoHoy?.n === 2 && cv.vencidoHoy?.eur === 5000, `vencidos a día de hoy: 2 (pr7 y pr8, que ya venía vencido de diciembre) = 5.000 €; pr9 saldado no (${cv.vencidoHoy?.n} / ${cv.vencidoHoy?.eur})`);
    check(cv.previo === null && !!cv.previoMotivo, "los cobros no se comparan con la ventana anterior, y se dice por qué");

    console.log("Sede A · total");
    check(A.total.casos === 8 && A.total.eurReal === 5100 && A.total.eurEstimado === null, `8 casos, 5.100 € reales (2.100 + 3.000), sin estimado (${A.total.casos} / ${A.total.eurReal} / ${A.total.eurEstimado})`);

    console.log("Sede B · la estimación con base");
    const scB = etapa(B, "sin_contacto");
    check(scB.actual.n === 1 && etapa(B, "sin_cita").actual.n === 0, "B: 1 sin contacto (l7), 0 sin cita");
    // 7 captados, 6 aceptaron → 85,7 %; ticket = (700 + 6 × 1.000) / 7 = 957,14 → 1 × 0,857 × 957,14 = 820
    check(scB.estimado?.eur === 820 && scB.estimado?.tasaPct === 85.7 && scB.estimado?.ticketMedio === 957, `B estima 820 € (85,7 % × 957 €) (${scB.estimado?.eur} / ${scB.estimado?.tasaPct} / ${scB.estimado?.ticketMedio})`);
    check(B.total.eurEstimado === 820 && B.total.eurReal === 1200, `B total: 1.200 € reales (500 + 700) y ≈ 820 € estimados (${B.total.eurReal} / ${B.total.eurEstimado})`);
    check(etapa(B, "cobro_vencido").actual.n === 1 && etapa(B, "cobro_vencido").actual.eur === 700, "B: pr10 cruzó a vencido el 11-feb");

    console.log("Aislamiento y red");
    check(!A.etapas.some((e) => e.motivos.some((m) => m.clave === "Otra_Clinica")), "A no ve el motivo del lead de B");
    check(etapa(B, "presupuesto_perdido").actual.n === 1 && etapa(B, "presupuesto_perdido").actual.eur === 500, "B solo ve su presupuesto perdido (500 €)");
    check(etapa(R, "sin_contacto").actual.n === 3 && etapa(R, "sin_cita").actual.n === 2, `red = A + B en leads (${etapa(R, "sin_contacto").actual.n} / ${etapa(R, "sin_cita").actual.n})`);
    check(etapa(R, "presupuesto_perdido").actual.n === 4 && etapa(R, "presupuesto_perdido").actual.eur === 2600, `red = A + B en presupuestos: 4, 2.600 € (${etapa(R, "presupuesto_perdido").actual.eur})`);
    check(etapa(R, "cobro_vencido").actual.n === 2 && etapa(R, "cobro_vencido").actual.eur === 3700, `red = A + B en cobros: 2, 3.700 € (${etapa(R, "cobro_vencido").actual.eur})`);
    // 15 captados, 7 aceptaron; ticket = (3.000 + 1.000 + 700 + 6 × 1.000) / 9 = 1.188,9 (pr8 aceptado el 1-sep-2019 queda fuera de los 180 días)
    check(etapa(R, "sin_contacto").estimado?.eur === 1664, `red estima 3 × 7/15 × 1.188,9 = 1.664 € (${etapa(R, "sin_contacto").estimado?.eur})`);

    console.log("Otra ventana");
    const A90 = await calcularFuga({ clinicaId: CLI_A, dias: 90, ahora: AHORA });
    check(A90.ventana.desde === "2019-12-02" && etapa(A90, "sin_contacto").actual.n === 3 && etapa(A90, "presupuesto_perdido").actual.n === 4, `90 días (desde ${A90.ventana.desde}): 3 sin contacto (l1, l9, l4), 4 perdidos (pr1, pr2, pr4, pr6)`);
    check(etapa(A90, "cobro_vencido").actual.n === 2, "90 días: los dos cobros cruzaron dentro (7-feb y 8-dic)");
  });

  await runWithCliente("DEMO", limpiar);
  console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
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
