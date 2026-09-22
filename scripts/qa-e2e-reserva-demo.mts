#!/usr/bin/env tsx
// EL PASO 3 DE PUNTA A PUNTA EN DEMO (17-09): huecos reales → reservar →
// confirmación al paciente → estado en la ficha. Recorre las MISMAS funciones
// que el clic de la coordinadora (huecosDelCaso; updateLead + upsertCitaDeLead
// como el PATCH del lead; confirmarCitaAlPaciente como la ruta), sin modelo.
//
//   npm run qa:reserva-demo -- "+34 663 478 802"            recorre y REVIERTE
//   npm run qa:reserva-demo -- "+34 663 478 802" --dejar    deja la cita puesta
//   npm run qa:reserva-demo -- "+34 663 478 802" --entrante "quería cita para una limpieza, los jueves por la mañana"
//        antes de nada registra ese entrante como SIMULADO y lo evalúa el
//        agente (el mismo camino que demo:entrante, ~$0,005): así hay una
//        preferencia real que filtrar y el hilo queda marcado como simulación.
//   npm run qa:reserva-demo -- "+34 663 478 802" --rechazo "uy, ese día no puedo"
//        tras confirmar, la persona contesta eso (simulado, evaluado por el
//        agente, ~$0,005): se mide que deriva con hueco_rechazado, prioritaria,
//        con la plantilla de código, que la cita SIGUE reservada y que la
//        ficha lo dice. Se revierte todo (cita, lead, mensajes y eventos).
//   npm run qa:reserva-demo -- "+34 663 478 802" --agenda-fuera
//        mide el escalón sin agenda: desactiva el ajuste, comprueba que
//        NO se confirma, y lo vuelve a activar.
//
// Antes, para que haya preferencia que filtrar: un entrante evaluado por el
// agente (npm run demo:entrante -- "<tel>" "quería cita para una limpieza,
// los jueves por la mañana"). Sin evaluación, huecosDelCaso busca sin filtro
// y lo dice (ampliado = null, preferencia = null).
//
// Solo DEMO. Nada sale por WhatsApp real: los hilos jugados se registran como
// simulación y el resto de DEMO no tiene número conectado. Salida: 0 = el
// recorrido cerró como se esperaba · 1 = algo no cuadró (se lista).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { fichaDeCaso } from "../app/lib/agente/ficha-caso";
import { huecosDelCaso } from "../app/lib/agenda/huecos-del-caso";
import { textoConfirmacionCita } from "../app/lib/agenda/confirmacion-cita";
import { confirmarCitaAlPaciente } from "../app/lib/agenda/confirmar-cita";
import { updateLead, getLead } from "../app/lib/leads/leads";
import { upsertCitaDeLead, cancelarCitaDeLead } from "../app/lib/agenda/cita-de-lead";
import { getServicioMensajeria } from "../app/lib/presupuestos/mensajeria";
import { evaluarEntranteConversacion } from "../app/lib/agente/evaluar-entrante";
import { FUENTE_SIMULACION } from "../app/lib/mensajeria/hilo-jugado";
import { borradorAgenteDe } from "../app/lib/agente/borrador-agente";

const args = process.argv.slice(2);
const telefono = args.find((a) => !a.startsWith("--"));
const DEJAR = args.includes("--dejar");
const AGENDA_FUERA = args.includes("--agenda-fuera");
const rechazoIdx = args.indexOf("--rechazo");
const RECHAZO = rechazoIdx >= 0 ? args[rechazoIdx + 1] ?? null : null;
const entranteIdx = args.indexOf("--entrante");
const ENTRANTE = entranteIdx >= 0 ? args[entranteIdx + 1] ?? null : null;
if (!telefono) {
  console.error("Uso: qa:reserva-demo -- \"<teléfono>\" [--dejar] [--agenda-fuera]");
  process.exit(2);
}

let rojos = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) rojos++;
};

async function ponerAjuste(activa: boolean) {
  await runWithClienteDb("DEMO", (trx) =>
    sql`insert into agenda_ajustes (cliente, agenda_en_fyllio, activado_por, activado_en)
        values ('DEMO', ${activa}, ${activa ? "qa:reserva-demo" : null}, ${activa ? sql`now()` : null})
        on conflict (cliente) do update set agenda_en_fyllio = excluded.agenda_en_fyllio,
          activado_por = excluded.activado_por, activado_en = excluded.activado_en, actualizado_en = now()`.execute(trx),
  );
}

await runWithCliente("DEMO", async () => {
  await ponerAjuste(!AGENDA_FUERA);
  if (ENTRANTE) {
    console.log(`══ entrante simulado: «${ENTRANTE}»`);
    const f = await fichaDeCaso(telefono);
    const mensajeId = `qa-reserva-${Date.now()}`;
    await getServicioMensajeria("manual").recibirMensaje({
      telefono,
      contenido: ENTRANTE,
      leadId: f.lead?.id,
      wabaMessageId: mensajeId,
      clinicaId: f.clinicaId,
      fuente: FUENTE_SIMULACION as any,
    });
    const r = await evaluarEntranteConversacion({ telefono, mensajeId, contenido: ENTRANTE, presupuestoId: null, clinicaId: f.clinicaId } as any);
    console.log(`  evaluado: ${JSON.stringify(r).slice(0, 200)}`);
  }
  console.log(`══ ficha de ${telefono}`);
  const f0 = await fichaDeCaso(telefono);
  if (!f0.lead) {
    console.error("  ✗ este teléfono no tiene un lead abierto: elige otro (leads en estado Nuevo/Contactado con teléfono).");
    process.exit(1);
  }
  console.log(`  lead ${f0.lead.nombre} (${f0.lead.estado}) · doctor asignado ${f0.lead.doctorAsignadoId ?? "—"} · cita ${f0.cita ? `${f0.cita.fecha} ${f0.cita.hora}` : "ninguna"}`);
  console.log(`  preferencia: ${JSON.stringify(f0.preferenciaCita)} · tratamiento dicho: ${f0.recogido?.find((c) => c.campo === "tratamiento_o_molestia")?.valor ?? "—"}`);
  if (f0.cita) {
    console.error("  ✗ ya tiene cita: el recorrido empieza sin cita. Revierte primero o elige otro lead.");
    process.exit(1);
  }

  console.log("══ huecos");
  const tratamientoTexto = f0.recogido?.find((c) => c.campo === "tratamiento_o_molestia")?.valor ?? null;
  let h = await huecosDelCaso({ preferencia: f0.preferenciaCita, tratamientoTexto, tratamientoId: null, doctorId: null, clinicaId: f0.clinicaId });
  if (!h.tratamiento) {
    // Sin casar: la coordinadora elegiría en el panel; aquí el primero del catálogo.
    console.log(`  (no casó tratamiento: «${h.nota}» → se elige ${h.catalogo[0]?.nombre})`);
    h = await huecosDelCaso({ preferencia: f0.preferenciaCita, tratamientoTexto, tratamientoId: h.catalogo[0]?.id ?? null, doctorId: null, clinicaId: f0.clinicaId });
  }
  if (h.doctorFueraDeClinica) console.log(`  (doctor asignado ${h.doctorFueraDeClinica} es de otra clínica: se ignora)`);
  ok(h.huecos.every((x) => !f0.clinicaId || x.clinicaId === f0.clinicaId), "todos los huecos son de la clínica del caso");
  console.log(`  garantía: ${h.garantia.frescura} · reserva=${h.garantia.puedeReservar} · «${h.garantia.texto}»`);
  console.log(`  ampliado: ${h.ampliado ?? "no"} · nota: ${h.nota ?? "—"} · tratamiento: ${h.tratamiento?.nombre} (${h.tratamiento?.duracionMin} min)`);
  for (const x of h.huecos) console.log(`  · ${x.fecha} ${x.hora}-${x.fin} ${x.doctorNombre} (${x.clinicaNombre ?? "—"})`);
  ok(h.garantia.frescura === (AGENDA_FUERA ? "sin_agenda" : "en_vivo"), `la garantía es ${AGENDA_FUERA ? "sin_agenda" : "en_vivo"}`);
  ok(h.huecos.length > 0, "hay huecos en dos semanas");
  if (h.huecos.length === 0) process.exit(1);
  const pref = f0.preferenciaCita;
  if (pref && !h.ampliado) {
    const DIA: Record<string, number> = { lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6, dom: 7 };
    const diaOk = pref.dias.length === 0 || h.huecos.every((x) => pref.dias.map((d) => DIA[d]).includes(new Date(`${x.fecha}T12:00:00Z`).getUTCDay() || 7));
    const franjaOk = !pref.franja || pref.franja === "indiferente" || h.huecos.every((x) => (pref.franja === "manana") === (Number(x.hora.slice(0, 2)) < 14));
    ok(diaOk && franjaOk, "los huecos respetan la preferencia (días y franja)");
  }
  const elegido = h.huecos[0]!;
  const texto = textoConfirmacionCita({ nombre: f0.lead.nombre, fecha: elegido.fecha, hora: elegido.hora, doctor: elegido.doctorNombre || null, clinica: elegido.clinicaNombre });
  console.log(`  mensaje que vería la coordinadora:\n    «${texto}»`);

  // ── Reservar: lo mismo que el PATCH /api/leads/[id] ──
  console.log("══ reservar");
  const lead = await getLead(f0.lead.id);
  const updated = await updateLead(f0.lead.id, { estado: "Citado", fechaCita: elegido.fecha, horaCita: elegido.hora, doctorAsignadoId: elegido.doctorId });
  await upsertCitaDeLead({
    cliente: "DEMO",
    lead: { id: updated.id, nombre: updated.nombre, clinicaId: updated.clinicaId ?? null, pacienteId: updated.pacienteId ?? null, fechaCita: elegido.fecha, horaCita: elegido.hora, doctorAsignadoId: elegido.doctorId },
    tratamientoId: h.tratamiento!.id,
  });
  const h2 = await huecosDelCaso({ preferencia: f0.preferenciaCita, tratamientoTexto, tratamientoId: h.tratamiento!.id, doctorId: elegido.doctorId, clinicaId: f0.clinicaId });
  ok(!h2.huecos.some((x) => x.fecha === elegido.fecha && x.hora === elegido.hora && x.doctorId === elegido.doctorId), "el hueco reservado ya no se ofrece (la cita ocupa)");

  // ── Confirmar: lo mismo que POST /api/agente/confirmar-cita ──
  console.log("══ confirmar");
  const c = await confirmarCitaAlPaciente({ telefono, leadId: f0.lead.id, texto });
  console.log(`  resultado: ${JSON.stringify(c)}`);
  if (AGENDA_FUERA) {
    ok(!c.ok && c.motivo === "sin_agenda_en_fyllio", "sin agenda en Fyllio NO se confirma al paciente");
  } else {
    ok(c.ok && !("yaConfirmada" in c) && c.simulado === true, "confirmación registrada como simulación (hilo jugado), sin WhatsApp real");
    const otra = await confirmarCitaAlPaciente({ telefono, leadId: f0.lead.id, texto: texto + " x" });
    ok(otra.ok && "yaConfirmada" in otra, "segunda vez: ya confirmada, no se manda dos veces");
  }

  let desdeRechazo: Date | null = null;
  if (RECHAZO && !AGENDA_FUERA) {
    console.log(`══ la persona contesta: «${RECHAZO}»`);
    desdeRechazo = new Date();
    const mensajeId = `qa-rechazo-${Date.now()}`;
    await getServicioMensajeria("manual").recibirMensaje({ telefono, contenido: RECHAZO, leadId: f0.lead.id, wabaMessageId: mensajeId, clinicaId: f0.clinicaId, fuente: FUENTE_SIMULACION as any });
    await evaluarEntranteConversacion({ telefono, mensajeId, contenido: RECHAZO, presupuestoId: null, clinicaId: f0.clinicaId } as any);
    // Lo que dejó el turno: el derivado (con su causa) en el log y el borrador del agente.
    const evs: any = await runWithClienteDb("DEMO", (trx) =>
      sql`select evento, causa_derivacion from eventos_automatizacion where tipo_caso = 'conversacion' and caso_id = ${telefono} and created_at >= ${desdeRechazo} order by created_at`.execute(trx));
    const derivado = (evs.rows ?? []).find((x: any) => x.evento === "derivado");
    const borrador = (await borradorAgenteDe(telefono)) ?? "";
    console.log(`  eventos: ${(evs.rows ?? []).map((x: any) => `${x.evento}${x.causa_derivacion ? `(${x.causa_derivacion})` : ""}`).join(" · ")}`);
    console.log(`  respuesta del agente: «${borrador}»`);
    ok(derivado?.causa_derivacion === "hueco_rechazado", "deriva con hueco_rechazado");
    ok(/sigue reservada|Se lo paso al equipo/.test(borrador), "la respuesta es la plantilla de código (no del modelo)");
    const fr = await fichaDeCaso(telefono);
    console.log(`  estado: ${fr.estado.texto} · cita: ${fr.cita ? `${fr.cita.fecha} ${fr.cita.hora}` : "ninguna"} · semáforo verde=${fr.semaforo.verde} motivo=${fr.semaforo.motivo ?? "—"}`);
    ok(fr.estado.texto.startsWith("No le va la hora reservada"), "la ficha dice que no le va la hora");
    ok(fr.cita?.fecha === elegido.fecha && fr.cita?.hora === elegido.hora, "el hueco SIGUE reservado (lo suelta la coordinadora)");
    ok(!fr.semaforo.verde && fr.semaforo.motivo === "derivado_sin_resolver", "el caso está entregado y esperando a una persona");
    // La coordinadora lo suelta por el camino de siempre (PATCH del lead fuera
    // de Citado → la cita se cancela): ese hecho cierra el derivado solo.
    await updateLead(f0.lead.id, { estado: "Contactado", fechaCita: null, horaCita: null });
    await cancelarCitaDeLead({ cliente: "DEMO", leadId: f0.lead.id });
    const fr2 = await fichaDeCaso(telefono);
    ok(fr2.semaforo.verde, `al anular la cita el derivado se cierra solo (verde=${fr2.semaforo.verde})`);
  }

  console.log("══ ficha después");
  const f1 = await fichaDeCaso(telefono);
  console.log(`  estado: ${f1.estado.texto} · cita: ${f1.cita ? `${f1.cita.fecha} ${f1.cita.hora} ${f1.cita.doctor ?? ""} (${f1.cita.fuente}) confirmada=${f1.cita.confirmadaEn ?? "no"}` : "ninguna"}`);
  console.log(`  descripción: ${f1.descripcion.map((d) => d.texto).join(" ")}`);
  if (!desdeRechazo) ok(f1.cita?.fecha === elegido.fecha && f1.cita?.hora === elegido.hora, "la ficha enseña la cita reservada");
  if (!desdeRechazo) ok(f1.estado.texto.startsWith(AGENDA_FUERA ? "Cita anotada" : "Cita reservada") && f1.objetivoActivo !== "cita", `el estado es la cita (${AGENDA_FUERA ? "anotada" : "reservada"}), no «Quiere cita» (es «${f1.estado.texto}», objetivo ${f1.objetivoActivo ?? "—"})`);
  if (!desdeRechazo) ok(AGENDA_FUERA ? f1.cita?.confirmadaEn == null : f1.cita?.confirmadaEn != null, AGENDA_FUERA ? "la ficha dice que NO se confirmó" : "la ficha dice que se confirmó por WhatsApp");
  const m: any = await runWithClienteDb("DEMO", (trx) =>
    sql`select contenido, autor, fuente from mensajes_whatsapp where telefono = ${telefono} and direccion = 'Saliente' order by "timestamp" desc limit 1`.execute(trx));
  const ult = m.rows?.[0];
  if (!AGENDA_FUERA && !desdeRechazo) ok(ult?.contenido === texto && ult?.autor === "persona" && ult?.fuente === "Simulacion", "el último saliente del hilo es la confirmación, autor persona, fuente simulación");

  if (!DEJAR) {
    console.log("══ revertir");
    await cancelarCitaDeLead({ cliente: "DEMO", leadId: f0.lead.id });
    await updateLead(f0.lead.id, { estado: lead?.estado ?? "Nuevo", fechaCita: null, horaCita: null, doctorAsignadoId: lead?.doctorAsignadoId ?? null });
    await runWithClienteDb("DEMO", (trx) => sql`delete from mensajes_whatsapp where telefono = ${telefono} and direccion = 'Saliente' and contenido = ${texto}`.execute(trx));
    if (desdeRechazo) {
      // El rechazo simulado y todo lo que dejó (mensajes, evaluación, derivado): fuera.
      await runWithClienteDb("DEMO", (trx) => sql`delete from mensajes_whatsapp where telefono = ${telefono} and "timestamp" >= ${desdeRechazo}`.execute(trx));
      await runWithClienteDb("DEMO", (trx) => sql`delete from eventos_automatizacion where tipo_caso = 'conversacion' and caso_id = ${telefono} and created_at >= ${desdeRechazo}`.execute(trx));
    }
    const f2 = await fichaDeCaso(telefono);
    ok(f2.cita == null, "revertido: sin cita");
  }
  if (AGENDA_FUERA) await ponerAjuste(true);
});

console.log(rojos ? `\n✗ ${rojos} rojos` : "\n✓ recorrido completo");
process.exit(rojos ? 1 : 0);
