// app/lib/agenda/confirmar-cita.ts
//
// CONFIRMAR LA CITA AL PACIENTE (17-09, paso 3). La lógica vive aquí y la
// ruta (/api/agente/confirmar-cita) solo la traduce a HTTP: así el QA de
// punta a punta en DEMO recorre EXACTAMENTE lo que recorre el clic.
//
// Reglas (decisión de Simon, 17-09):
//  · Plantilla de código (confirmacion-cita.ts), autor «persona», sin juez:
//    el clic es la revisión. Para que lo sea, `texto` tiene que ser EXACTAMENTE
//    el que se compone de la cita real — si no (la cita cambió entre ver y
//    pulsar), se rechaza y la coordinadora vuelve a mirar.
//  · Solo con la agenda en Fyllio (en_vivo): con copia o sin agenda,
//    confirmar un hueco que Fyllio no ve sería la promesa falsa que el juez
//    veta al agente.
//  · Por el canal del cliente: WABA si hay credenciales, manual si no (el
//    criterio del composer). Un hilo SIMULADO se registra como simulación:
//    jamás un WhatsApp real a un número inventado.
//  · Opt-out: quien pidió no recibir mensajes no recibe este tampoco.
//  · La cita guarda `confirmada_en` + el id del mensaje: la ficha lo lee.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { getLead } from "../leads/leads";
import { getServicioMensajeria } from "../presupuestos/mensajeria";
import { hasWABACredentials } from "../presupuestos/waba-credentials";
import { envioBloqueadoPorOptOut } from "../contacto/optout";
import { hiloJugado, FUENTE_SIMULACION } from "../mensajeria/hilo-jugado";
import { textoConfirmacionCita } from "./confirmacion-cita";
import { leerAgendaEnFyllio } from "./garantia";
import { hoyISO, horaClinica } from "../time";

export type ResultadoConfirmacion =
  | { ok: true; mensajeId: string; modo: "waba" | "manual"; simulado: boolean; urlWhatsApp: string | null }
  | { ok: true; yaConfirmada: true; confirmadaEnISO: string }
  | { ok: false; motivo: "lead_no_existe" | "sin_agenda_en_fyllio" | "sin_cita_futura" | "texto_no_coincide" | "opt_out" | "fallo_envio"; esperado?: string };

export async function confirmarCitaAlPaciente(p: { telefono: string; leadId: string; texto: string }): Promise<ResultadoConfirmacion> {
  const cliente = requireCliente("confirmarCitaAlPaciente");
  const lead = await getLead(p.leadId);
  if (!lead) return { ok: false, motivo: "lead_no_existe" };

  const cita = await runWithClienteDb(cliente, async (trx) => {
    const enFyllio = await leerAgendaEnFyllio(trx);
    const r: any = await sql`select c.id, c.hora_inicio, c.confirmada_en, s.nombre as doctor, cl.nombre as clinica
        from citas c
        left join staff s on s.cliente = c.cliente and s.id = c.profesional_id
        left join clinicas cl on cl.cliente = c.cliente and cl.id = c.clinica_id
       where c.lead_id = ${p.leadId} and c.hora_inicio >= now() and c.estado in ('Programada', 'Confirmada')
       order by c.hora_inicio asc limit 1`.execute(trx);
    return { enFyllio, fila: r.rows?.[0] ?? null };
  });
  if (!cita.enFyllio) return { ok: false, motivo: "sin_agenda_en_fyllio" };
  if (!cita.fila) return { ok: false, motivo: "sin_cita_futura" };
  if (cita.fila.confirmada_en) return { ok: true, yaConfirmada: true, confirmadaEnISO: new Date(cita.fila.confirmada_en).toISOString() };

  const inicio = new Date(cita.fila.hora_inicio);
  const esperado = textoConfirmacionCita({
    nombre: lead.nombre,
    fecha: hoyISO(inicio),
    hora: horaClinica(inicio),
    doctor: cita.fila.doctor ?? null,
    clinica: cita.fila.clinica ?? null,
  });
  if (p.texto !== esperado) return { ok: false, motivo: "texto_no_coincide", esperado };
  if ((await envioBloqueadoPorOptOut(p.telefono)).bloqueado) return { ok: false, motivo: "opt_out" };

  const simulado = await hiloJugado(p.telefono);
  const modo: "waba" | "manual" = !simulado && hasWABACredentials() ? "waba" : "manual";
  const r = await getServicioMensajeria(modo).enviarMensaje({
    leadId: p.leadId,
    telefono: p.telefono,
    contenido: p.texto,
    autor: "persona",
    sugeridoPorIa: false,
    ...(simulado ? { fuente: FUENTE_SIMULACION } : {}),
    idempotencyKey: `confirmar-cita:${cita.fila.id}`,
  });
  if (!r.ok) return { ok: false, motivo: "fallo_envio" };

  await runWithClienteDb(cliente, (trx) =>
    sql`update citas set confirmada_en = now(), confirmacion_mensaje_id = ${r.mensajeId} where id = ${cita.fila.id}`.execute(trx),
  );
  return { ok: true, mensajeId: r.mensajeId, modo, simulado, urlWhatsApp: r.urlWhatsApp ?? null };
}

/** El mensaje de cada motivo, en lenguaje de coordinadora (lo usa la ruta). */
export const MENSAJE_MOTIVO: Record<Exclude<ResultadoConfirmacion, { ok: true }>["motivo"], string> = {
  lead_no_existe: "Lead no encontrado",
  sin_agenda_en_fyllio: "La agenda no vive en Fyllio: la cita queda anotada y se confirma desde tu software.",
  sin_cita_futura: "El lead no tiene una cita futura que confirmar.",
  texto_no_coincide: "La cita cambió desde que viste el mensaje. Vuelve a mirar los huecos.",
  opt_out: "Esta persona pidió no recibir mensajes. Solo se le puede contestar cuando escribe ella.",
  fallo_envio: "No se pudo enviar la confirmación",
};
