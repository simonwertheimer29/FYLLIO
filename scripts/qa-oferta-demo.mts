// scripts/qa-oferta-demo.mts — EL BUCLE DE OFERTAS DE PUNTA A PUNTA EN DEMO
// (17-09, 060). Recorre las MISMAS funciones que los clics de la pantalla
// (lib/agenda/ofertas.ts) y el turno real del agente (evaluarEntrante) sobre
// un lead de DEMO con hilo simulado: nada sale por WhatsApp. Revierte al final.
//
//   npm run qa:oferta-demo -- "+34 663 478 802"
//   npm run qa:oferta-demo -- "+34 663 478 802" --eleccion "la 2"        (lo que contesta el paciente)
//   npm run qa:oferta-demo -- "+34 663 478 802" --ambiguo "la del {dia}"  (dos del mismo día → el agente pregunta; {dia} = el ofrecido)
//   npm run qa:oferta-demo -- "+34 663 478 802" --ocupar                  (alguien ocupa la elegida antes del clic)
//   npm run qa:oferta-demo -- "+34 663 478 802" --tarde                   (contesta a una oferta caducada)
//   npm run qa:oferta-demo -- "+34 663 478 802" --eleccion "la 2" --dejar (PARA donde para el producto: elegida, sin clic; no revierte)
//   npm run qa:oferta-demo -- "+34 663 478 802" --eleccion "la 2" --dejar-reservado (camino entero sin revertir)
//   npm run qa:oferta-demo -- "+34 663 478 802" --limpiar                 (revierte lo que dejó --dejar*)
//
// Gasto: un turno del modelo por elección ($0,01). Sin --eleccion ni --ambiguo
// ni --tarde, solo la oferta y su comprobación ($0).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { fichaDeCaso } from "../app/lib/agente/ficha-caso";
import { huecosDelCaso } from "../app/lib/agenda/huecos-del-caso";
import { crearOferta, textoDeOferta, reservarEleccion, acuseDeEleccion, ofertaDelCaso, avisarSinHuecos, comprobarAlternativas } from "../app/lib/agenda/ofertas";
import { textoSinHuecos } from "../app/lib/agenda/ofertas-textos";
import { updateLead, getLead } from "../app/lib/leads/leads";
import { upsertCitaDeLead, cancelarCitaDeLead } from "../app/lib/agenda/cita-de-lead";
import { getServicioMensajeria } from "../app/lib/presupuestos/mensajeria";
import { evaluarEntranteConversacion } from "../app/lib/agente/evaluar-entrante";
import { FUENTE_SIMULACION } from "../app/lib/mensajeria/hilo-jugado";
import { borradorAgenteDe } from "../app/lib/agente/borrador-agente";

const args = process.argv.slice(2);
const telefono = args.find((a) => !a.startsWith("--"));
// --dejar: PARA DONDE PARA EL PRODUCTO (elección hecha, caso esperando el clic
// de la coordinadora) y no revierte, para mirarlo en pantalla. El acuse NO se
// fuerza: lo entrega la cola con su retardo (o sale inmediato si la cola no
// está activa en este entorno; se imprime cuál de las dos).
// --dejar-reservado: el camino entero (clic incluido) sin revertir.
// --limpiar: revierte lo que dejó una ejecución anterior con --dejar*.
const DEJAR = args.includes("--dejar");
const DEJAR_RESERVADO = args.includes("--dejar-reservado");
const LIMPIAR = args.includes("--limpiar");
const OCUPAR = args.includes("--ocupar");
const TARDE = args.includes("--tarde");
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] ?? null : null; };
const ELECCION = arg("--eleccion");
const AMBIGUO = arg("--ambiguo");
if (!telefono) { console.error("uso: qa:oferta-demo \"<telefono>\" [--eleccion \"…\"|--ambiguo \"…\"] [--ocupar] [--tarde] [--dejar]"); process.exit(2); }

let rojos = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`); if (!cond) rojos++; };
const inicio = new Date();

async function entrante(texto: string, leadId: string, clinicaId: string | null) {
  const mensajeId = `qa-oferta-${Date.now()}`;
  await getServicioMensajeria("manual").recibirMensaje({ telefono: telefono!, contenido: texto, leadId, wabaMessageId: mensajeId, clinicaId, fuente: FUENTE_SIMULACION as any });
  const r = await evaluarEntranteConversacion({ telefono: telefono!, mensajeId, contenido: texto, presupuestoId: null, clinicaId } as any);
  return { mensajeId, r };
}

await runWithCliente("DEMO", async () => {
  await runWithClienteDb("DEMO", (trx) =>
    sql`insert into agenda_ajustes (cliente, agenda_en_fyllio, activado_por, activado_en) values ('DEMO', true, 'qa:oferta-demo', now())
        on conflict (cliente) do update set agenda_en_fyllio = true, actualizado_en = now()`.execute(trx));

  if (LIMPIAR) {
    console.log(`══ limpiar lo que dejó una ejecución anterior en ${telefono}`);
    const ult: any = await runWithClienteDb("DEMO", (trx) => sql`select created_at, lead_id from ofertas_hueco where telefono = ${telefono} order by created_at asc limit 1`.execute(trx));
    const desde = ult.rows?.[0]?.created_at ? new Date(new Date(ult.rows[0].created_at).getTime() - 60_000) : null;
    if (!desde) { console.log("  nada que limpiar (sin ofertas)"); process.exit(0); }
    const leadId = String(ult.rows[0].lead_id);
    await cancelarCitaDeLead({ cliente: "DEMO", leadId });
    await updateLead(leadId, { estado: "Nuevo", fechaCita: null, horaCita: null });
    await runWithClienteDb("DEMO", async (trx) => {
      await sql`delete from ofertas_hueco where telefono = ${telefono}`.execute(trx);
      await sql`delete from mensajes_whatsapp where telefono = ${telefono} and "timestamp" >= ${desde}`.execute(trx);
      await sql`delete from eventos_automatizacion where tipo_caso = 'conversacion' and caso_id = ${telefono} and created_at >= ${desde}`.execute(trx);
      await sql`delete from bloqueos_staff where motivo = 'qa:oferta-demo'`.execute(trx);
    });
    const f = await fichaDeCaso(telefono!);
    console.log(`  limpio: cita=${f.cita ? "SÍ" : "no"} · oferta=${f.oferta?.estado ?? "ninguna"} · estado «${f.estado.texto}»`);
    process.exit(0);
  }

  console.log(`══ ficha de ${telefono}`);
  const f0 = await fichaDeCaso(telefono!);
  if (!f0.lead) { console.error("  ✗ este teléfono no tiene un lead abierto."); process.exit(1); }
  if (f0.cita) { console.error("  ✗ ya tiene cita: el recorrido empieza sin cita."); process.exit(1); }
  const leadAntes = await getLead(f0.lead.id);
  console.log(`  lead ${f0.lead.nombre} · clínica ${f0.clinicaId ?? "—"} · preferencia ${JSON.stringify(f0.preferenciaCita)} · oferta previa: ${f0.oferta?.estado ?? "ninguna"}`);
  const ofertasAntes: any = await runWithClienteDb("DEMO", (trx) => sql`select count(*)::int as n from ofertas_hueco where telefono = ${telefono}`.execute(trx));
  const nOfertasAntes = Number(ofertasAntes.rows?.[0]?.n ?? 0);

  console.log("══ huecos (los tres que cumplen lo que pidió)");
  const tratamientoTexto = f0.recogido?.find((c) => c.campo === "tratamiento_o_molestia")?.valor ?? null;
  let h = await huecosDelCaso({ preferencia: f0.preferenciaCita, tratamientoTexto, tratamientoId: null, doctorId: f0.lead.doctorAsignadoId, clinicaId: f0.clinicaId });
  if (!h.tratamiento) h = await huecosDelCaso({ preferencia: f0.preferenciaCita, tratamientoTexto, tratamientoId: h.catalogo[0]?.id ?? null, doctorId: f0.lead.doctorAsignadoId, clinicaId: f0.clinicaId });
  ok(h.huecos.length >= 2, `hay al menos dos huecos (${h.huecos.length})`);
  if (h.huecos.length < 2) process.exit(1);
  const tratamientoId = h.tratamiento!.id;
  for (const x of h.huecos) console.log(`  · ${x.fecha} ${x.hora} ${x.doctorNombre} (${x.clinicaNombre ?? "—"})`);

  // Con --ambiguo se quieren DOS del mismo día de la semana: se busca en «todos».
  let alternativas = h.huecos.slice(0, 3);
  if (AMBIGUO) {
    const todos = await huecosDelCaso({ preferencia: null, tratamientoTexto: null, tratamientoId, doctorId: null, clinicaId: f0.clinicaId, modo: "todos", dias: 14, max: 500 });
    const porDia = new Map<number, typeof todos.huecos>();
    for (const x of todos.huecos) { const d = new Date(`${x.fecha}T12:00:00Z`).getUTCDay(); porDia.set(d, [...(porDia.get(d) ?? []), x]); }
    const dos = [...porDia.values()].map((l) => { const fechas = [...new Set(l.map((x) => x.fecha))]; return fechas.length >= 2 ? [l.find((x) => x.fecha === fechas[0])!, l.find((x) => x.fecha === fechas[1])!] : null; }).find(Boolean);
    if (!dos) { console.error("  ✗ no hay dos fechas del mismo día de la semana en dos semanas"); process.exit(1); }
    alternativas = dos;
    console.log(`  (ambiguo) se ofrecen dos ${new Date(`${dos[0]!.fecha}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long" })}: ${dos.map((x) => `${x.fecha} ${x.hora}`).join(" y ")}`);
  }

  console.log("══ la oferta (lo mismo que «Enviar la propuesta»)");
  const texto = await textoDeOferta({ nombre: f0.lead.nombre, alternativas, tratamientoId });
  console.log(`  mensaje:\n    «${texto.replace(/\n/g, "\n    ")}»`);
  const mal = await crearOferta({ telefono: telefono!, leadId: f0.lead.id, alternativas, tratamientoId, texto: texto + " x" });
  ok(!mal.ok && mal.motivo === "texto_no_coincide", "un texto distinto del compuesto se rechaza (el clic es la revisión)");
  const o = await crearOferta({ telefono: telefono!, leadId: f0.lead.id, alternativas, tratamientoId, texto });
  ok(o.ok, `oferta enviada: ${o.ok ? `${o.oferta.id} · simulado=${o.simulado} · caduca ${o.oferta.caducaEn.toISOString()}` : o.motivo}`);
  if (!o.ok) process.exit(1);
  ok(o.simulado, "registrada como simulación (hilo jugado): ningún WhatsApp real");
  const f1 = await fichaDeCaso(telefono!);
  ok(f1.oferta?.estado === "abierta" && f1.oferta.alternativas.length === alternativas.length, `la ficha ve la oferta abierta con ${alternativas.length} alternativas`);
  ok(f1.estado.texto.startsWith("Horas propuestas"), `la etiqueta es «${f1.estado.texto}»`);
  const comp = await comprobarAlternativas({ alternativas, tratamientoId, clinicaId: f0.clinicaId });
  ok(comp.libres.length === alternativas.length, "todas las alternativas siguen libres (nada reservado)");
  const ult: any = await runWithClienteDb("DEMO", (trx) => sql`select contenido, autor, fuente from mensajes_whatsapp where telefono = ${telefono} and direccion = 'Saliente' order by "timestamp" desc limit 1`.execute(trx));
  ok(ult.rows?.[0]?.contenido === texto && ult.rows?.[0]?.autor === "persona", "el último saliente es la oferta, autor persona");

  if (TARDE) {
    console.log("══ la oferta caduca (se fuerza caduca_en al pasado, fuera de la gracia)");
    await runWithClienteDb("DEMO", (trx) => sql`update ofertas_hueco set caduca_en = now() - interval '5 hours' where id = ${o.oferta.id}`.execute(trx));
    const fc = await fichaDeCaso(telefono!);
    ok(fc.oferta?.estado === "caducada", "al leer, la oferta consta caducada (sin cron)");
    ok(fc.estado.texto.startsWith("Propuesta caducada"), `la etiqueta es «${fc.estado.texto}»`);
  }

  // Con --ambiguo la frase se compone con el día REALMENTE ofrecido («la del
  // viernes» cuando se ofrecieron dos viernes); el texto del flag es el que
  // se repite en la segunda vuelta si lleva {dia}.
  const diaOfrecido = AMBIGUO ? new Date(`${alternativas[0]!.fecha}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long" }) : "";
  const fraseAmbigua = AMBIGUO ? (AMBIGUO.includes("{dia}") ? AMBIGUO.replace("{dia}", diaOfrecido) : `la del ${diaOfrecido}`) : null;
  const respuesta = ELECCION ?? fraseAmbigua ?? (TARDE ? "la 1" : null);
  if (respuesta) {
    console.log(`══ el paciente contesta: «${respuesta}»`);
    const { r } = await entrante(respuesta, f0.lead.id, f0.clinicaId);
    console.log(`  turno: ${JSON.stringify(r).slice(0, 160)}`);
    const of = await ofertaDelCaso(telefono!);
    const borrador = (await borradorAgenteDe(telefono!)) ?? "";
    const evs: any = await runWithClienteDb("DEMO", (trx) => sql`select evento, causa_derivacion from eventos_automatizacion where tipo_caso = 'conversacion' and caso_id = ${telefono} and created_at >= ${inicio} order by created_at`.execute(trx));
    const derivado = (evs.rows ?? []).find((x: any) => x.evento === "derivado");
    console.log(`  eventos: ${(evs.rows ?? []).map((x: any) => `${x.evento}${x.causa_derivacion ? `(${x.causa_derivacion})` : ""}`).join(" · ") || "—"}`);
    console.log(`  oferta: estado=${of?.estado} eleccion=${of?.eleccion} tardia=${of?.eleccionTardia} desambiguaciones=${of?.desambiguaciones}`);
    if (borrador) console.log(`  respuesta del agente: «${borrador}»`);

    if (AMBIGUO) {
      ok(of?.desambiguaciones === 1 && of.eleccion == null, "el agente pidió aclarar (una vez) y no marcó elección");
      ok(/¿cuál de las (dos|tres|cuatro) dices\?/.test(borrador), "la respuesta es la plantilla de desambiguación (solo repite lo que salió)");
      ok(!derivado, "no deriva a la primera ambigüedad");
      console.log(`══ el paciente vuelve a contestar igual de ambiguo: «${fraseAmbigua}»`);
      await entrante(fraseAmbigua!, f0.lead.id, f0.clinicaId);
      const of2 = await ofertaDelCaso(telefono!);
      const evs2: any = await runWithClienteDb("DEMO", (trx) => sql`select causa_derivacion from eventos_automatizacion where tipo_caso = 'conversacion' and caso_id = ${telefono} and evento = 'derivado' and created_at >= ${inicio}`.execute(trx));
      ok(evs2.rows?.some((x: any) => x.causa_derivacion === "oferta_elegida"), "a la segunda sin aclarar, deriva con oferta_elegida (elige la coordinadora)");
      ok(of2?.estado === "elegida" && of2.eleccion == null, "la oferta queda elegida sin índice");
      const fa = await fichaDeCaso(telefono!);
      ok(fa.estado.texto.startsWith("Contestó a las horas propuestas"), `la etiqueta es «${fa.estado.texto}»`);
    } else {
      const indiceEsperado = /\b1\b|primera/.test(respuesta) ? 0 : /\b2\b|segunda/.test(respuesta) ? 1 : /\b3\b|tercera/.test(respuesta) ? 2 : null;
      ok(derivado?.causa_derivacion === "oferta_elegida", "deriva con oferta_elegida (prioritaria)");
      ok(borrador === "", "el agente CALLA: no hay borrador (el acuse va aparte, con retardo)");
      if (indiceEsperado != null) ok(of?.eleccion === indiceEsperado, `la elección leída es la ${indiceEsperado + 1}`);
      ok(TARDE ? of?.estado === "caducada" && of.eleccionTardia === true : of?.estado === "elegida" && of.eleccionTardia === false, TARDE ? "elección TARDÍA sobre la caducada: se guarda, no se reserva" : "la oferta pasa a elegida, a tiempo");
      const fe = await fichaDeCaso(telefono!);
      ok(!fe.semaforo.verde && fe.semaforo.motivo === "derivado_sin_resolver", "el caso está entregado a una persona");
      ok(fe.cita == null, "NADA reservado todavía");

      if (DEJAR) {
        const { estadoCola } = await import("../app/lib/cola/qstash");
        const ec = estadoCola();
        const ofD = await ofertaDelCaso(telefono!);
        console.log(`══ PARADO donde para el producto: elección hecha, esperando el clic de la coordinadora`);
        console.log(`  cola: ${ec.activa ? "ACTIVA → el acuse lo entrega QStash con su retardo (10 min en horario, 0 fuera)" : `inactiva (${(ec as any).motivo}) → el acuse salió inmediato al registrar la elección`}`);
        console.log(`  acuse enviado: ${ofD?.acuseEnviadoEn ? ofD.acuseEnviadoEn.toISOString() : "todavía no"}`);
        console.log(`  mira /mensajeria?telefono=${encodeURIComponent(telefono!)} · para revertir: npm run qa:oferta-demo -- "${telefono}" --limpiar`);
        process.exit(rojos ? 1 : 0);
      }

      console.log("══ el acuse (lo que la cola entregaría)");
      const acuseAntes = await acuseDeEleccion({ ofertaId: o.oferta.id });
      // Sin QSTASH_TOKEN el acuse ya salió inmediato al registrar la elección.
      console.log(`  resultado: ${JSON.stringify(acuseAntes)}`);
      const ofA = await ofertaDelCaso(telefono!);
      ok(ofA?.acuseEnviadoEn != null, "el acuse consta enviado (inmediato sin cola, o ya entregado)");
      const ultA: any = await runWithClienteDb("DEMO", (trx) => sql`select contenido, autor from mensajes_whatsapp where telefono = ${telefono} and direccion = 'Saliente' order by "timestamp" desc limit 1`.execute(trx));
      console.log(`  último saliente (${ultA.rows?.[0]?.autor}): «${ultA.rows?.[0]?.contenido}»`);
      ok(/^Recibido/.test(ultA.rows?.[0]?.contenido ?? "") && ultA.rows?.[0]?.autor === "agente", "el acuse es la plantilla, autor agente");
      const otra = await acuseDeEleccion({ ofertaId: o.oferta.id });
      ok(!otra.enviado && otra.motivo === "ya_acusado", "segunda entrega de la cola: no se acusa dos veces");

      if (OCUPAR) {
        console.log("══ alguien ocupa la hora elegida antes del clic");
        const alt = alternativas[of!.eleccion ?? 0]!;
        const bloqueoIni = new Date(`${alt.fecha}T${alt.hora}:00+02:00`);
        await runWithClienteDb("DEMO", (trx) => sql`insert into bloqueos_staff (cliente, staff_id, inicio, fin, motivo) values ('DEMO', ${alt.doctorId}, ${bloqueoIni}, ${new Date(bloqueoIni.getTime() + 15 * 60_000)}, 'qa:oferta-demo')`.execute(trx));
        const rr = await reservarEleccion({ telefono: telefono!, preferencia: f0.preferenciaCita });
        ok(!rr.ok && rr.motivo === "ocupado", `no se reserva un hueco que ya no existe (${!rr.ok ? rr.motivo : "reservó"})`);
        if (!rr.ok && rr.motivo === "ocupado") {
          console.log(`  variante ${rr.variante} · mensaje corregido:\n    «${rr.texto.replace(/\n/g, "\n    ")}»`);
          ok(/se acaba de ocupar|se han ocupado/.test(rr.texto), "el mensaje corregido está YA ESCRITO");
          ok(!rr.restantes.some((x) => x.fecha === alt.fecha && x.hora === alt.hora && x.doctorId === alt.doctorId), "la ocupada no está entre las restantes");
          const ultB: any = await runWithClienteDb("DEMO", (trx) => sql`select contenido from mensajes_whatsapp where telefono = ${telefono} and direccion = 'Saliente' order by "timestamp" desc limit 1`.execute(trx));
          ok(ultB.rows?.[0]?.contenido !== rr.texto, "NO se ha enviado nada: lo envía la coordinadora de un clic");
          if (rr.variante === "sin_huecos") {
            const sh = await avisarSinHuecos({ telefono: telefono!, leadId: f0.lead.id, texto: textoSinHuecos({ nombre: f0.lead.nombre }) });
            ok(sh.ok, "opción b: aviso enviado y el caso vuelve con causa sin_huecos");
          } else {
            const o2 = await crearOferta({ telefono: telefono!, leadId: f0.lead.id, alternativas: rr.restantes, tratamientoId, variante: rr.variante === "se_ocupo" ? { tipo: "se_ocupo", ocupada: rr.ocupada } : { tipo: "todas_ocupadas" }, texto: rr.texto });
            ok(o2.ok, "la oferta corregida sale al clic y sustituye a la anterior");
            const ofR = await ofertaDelCaso(telefono!);
            ok(ofR?.estado === "abierta" && ofR.id !== o.oferta.id, "la nueva está abierta; la vieja, reemplazada");
            const fr = await fichaDeCaso(telefono!);
            ok(fr.semaforo.verde || fr.semaforo.motivo !== "derivado_sin_resolver", `el derivado oferta_elegida se cierra por hecho (verde=${fr.semaforo.verde})`);
          }
        }
        await runWithClienteDb("DEMO", (trx) => sql`delete from bloqueos_staff where motivo = 'qa:oferta-demo'`.execute(trx));
      } else {
        console.log("══ la coordinadora reserva de un clic");
        const rr = await reservarEleccion({ telefono: telefono!, preferencia: f0.preferenciaCita });
        ok(rr.ok, `reservado: ${rr.ok ? `${rr.alternativa.fecha} ${rr.alternativa.hora} · confirmación ${JSON.stringify(rr.confirmacion)}` : rr.motivo}`);
        if (rr.ok) {
          ok(rr.confirmacion.ok && !("yaConfirmada" in rr.confirmacion), "confirmación al paciente enviada (simulada)");
          const fr = await fichaDeCaso(telefono!);
          ok(fr.cita?.fecha === rr.alternativa.fecha && fr.cita?.hora === rr.alternativa.hora, "la ficha enseña la cita reservada");
          ok(fr.cita?.confirmadaEn != null, "y confirmada por WhatsApp");
          ok(fr.oferta?.estado === "reservada", "la oferta consta reservada");
          ok(fr.semaforo.verde, `el derivado oferta_elegida se cierra por hecho (verde=${fr.semaforo.verde})`);
          ok(fr.estado.texto.startsWith("Cita reservada"), `la etiqueta es «${fr.estado.texto}»`);
          // Visto por Simon (17-09): la BANDEJA decía «Necesita respuesta» con la cita ya
          // reservada — la cola no consulta el semáforo; ahora ve el cierre de la oferta.
          const { colaDeSeguimiento } = await import("../app/lib/seguimiento/cola");
          const cola = await colaDeSeguimiento();
          const dig = telefono!.replace(/\D/g, "");
          const enCola = cola.casos.find((c: any) => String(c.telefono ?? "").replace(/\D/g, "") === dig);
          ok(!enCola || enCola.cohorte !== "necesita_respuesta", `la bandeja NO lo marca «necesita respuesta» tras reservar (${enCola ? enCola.cohorte : "no está en la cola"})`);
          const otra2 = await reservarEleccion({ telefono: telefono!, preferencia: f0.preferenciaCita });
          ok(!otra2.ok && otra2.motivo === "ya_reservada", "un segundo clic no reserva dos veces");
        }
      }
    }
  }

  if (!DEJAR && !DEJAR_RESERVADO) {
    console.log("══ revertir");
    await cancelarCitaDeLead({ cliente: "DEMO", leadId: f0.lead.id });
    await updateLead(f0.lead.id, { estado: leadAntes?.estado ?? "Nuevo", fechaCita: null, horaCita: null, doctorAsignadoId: leadAntes?.doctorAsignadoId ?? null });
    await runWithClienteDb("DEMO", async (trx) => {
      await sql`delete from ofertas_hueco where telefono = ${telefono} and created_at >= ${inicio}`.execute(trx);
      await sql`delete from mensajes_whatsapp where telefono = ${telefono} and "timestamp" >= ${inicio}`.execute(trx);
      await sql`delete from eventos_automatizacion where tipo_caso = 'conversacion' and caso_id = ${telefono} and created_at >= ${inicio}`.execute(trx);
      await sql`delete from bloqueos_staff where motivo = 'qa:oferta-demo'`.execute(trx);
    });
    const ofertasDespues: any = await runWithClienteDb("DEMO", (trx) => sql`select count(*)::int as n from ofertas_hueco where telefono = ${telefono}`.execute(trx));
    const f2 = await fichaDeCaso(telefono!);
    ok(f2.cita == null && Number(ofertasDespues.rows?.[0]?.n ?? 0) === nOfertasAntes, "revertido: sin cita y sin ofertas nuevas");
  }
});

console.log(rojos ? `\n✗ ${rojos} rojos` : "\n✓ recorrido completo");
process.exit(rojos ? 1 : 0);
