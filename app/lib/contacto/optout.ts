// app/lib/contacto/optout.ts
//
// EL OPT-OUT, UNA SOLA FUENTE (auditoría 2026-09-05, punto 6 — MEJORAS 135).
//
// Hasta hoy había DOS flags en `pacientes` (`optout_automatizaciones`, del
// motor de reglas, y `opt_out`, del STOP legacy de Twilio) que nadie
// unificaba; los leían la cola de envíos, recordatorios, engine, no-shows y
// llamadas, y NO los leían el webhook, el evaluador ni el composer. Y nadie
// los escribía salvo Twilio y la edición manual de la ficha.
//
// Ahora hay UNA pregunta —¿este teléfono pidió no recibir mensajes?— con UNA
// respuesta, y todos preguntan aquí. Se responde por TELÉFONO porque quien
// escribe puede no ser paciente (lead, desconocido): para esos, el opt-out
// vive en el log de la conversación (`opt_out` / `opt_in`, 034). Al MARCAR
// se escribe en los dos sitios: los dos flags del paciente si lo hay (los
// lectores viejos siguen respetándolo sin tocarlos) y el evento.
//
// Semántica: opt-out = NO CONTACTAR proactivamente. Contestar a quien acaba
// de escribir NO es contactar (la doctrina de la espera, 026): el evaluador
// sigue redactando la respuesta, pero el composer lo enseña y las cadencias
// se paran.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";

export type EstadoOptOut = {
  activo: boolean;
  /** ISO del momento en que se marcó, si se sabe. */
  desde: string | null;
  /** De dónde sale la respuesta. */
  origen: "paciente" | "conversacion" | null;
  /** Lo que dijo la persona, si lo dijo por WhatsApp. */
  frase: string | null;
};

const soloDigitos = (raw: string): string => raw.replace(/[^0-9]/g, "");
const SIN: EstadoOptOut = { activo: false, desde: null, origen: null, frase: null };

/** ¿Este teléfono pidió no recibir mensajes? Lee LAS DOS fuentes. */
export async function optOutDeTelefono(telefono: string): Promise<EstadoOptOut> {
  const cliente = requireCliente("optOutDeTelefono");
  const dig = soloDigitos(telefono);
  if (dig.length < 7) return SIN;
  return runWithClienteDb(cliente, async (trx) => {
    // 1 · El log de la conversación: último opt_out / opt_in.
    const ev = await sql<{ evento: string; motivo_texto: string | null; created_at: Date }>`
      select evento, motivo_texto, created_at
        from eventos_automatizacion
       where tipo_caso = 'conversacion'
         and evento in ('opt_out', 'opt_in')
         and replace(replace(replace(caso_id, ' ', ''), '+', ''), '-', '') like ${"%" + dig + "%"}
       order by created_at desc
       limit 1`.execute(trx);
    const ultimo = ev.rows?.[0];
    if (ultimo?.evento === "opt_out") {
      return {
        activo: true,
        desde: new Date(ultimo.created_at).toISOString(),
        origen: "conversacion",
        frase: ultimo.motivo_texto ?? null,
      };
    }
    // Una persona lo revirtió: manda sobre el flag viejo del paciente, que
    // pudo quedarse marcado por Twilio hace meses.
    if (ultimo?.evento === "opt_in") return SIN;
    // 2 · La ficha del paciente (cualquiera de los dos flags heredados).
    const pa = await sql<{ ok: number }>`
      select 1 from pacientes
       where (optout_automatizaciones = true or opt_out = true)
         and replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${"%" + dig + "%"}
       limit 1`.execute(trx);
    if (pa.rows?.length) return { activo: true, desde: null, origen: "paciente", frase: null };
    return SIN;
  });
}

/** Por id de paciente — los lectores viejos (cola, recordatorios, engine). */
export async function optOutDePaciente(pacienteId: string): Promise<boolean> {
  const cliente = requireCliente("optOutDePaciente");
  const p = await runWithClienteDb(cliente, (trx) =>
    trx
      .selectFrom("pacientes")
      .select(["telefono", "optout_automatizaciones"])
      .where("id", "=", pacienteId)
      .executeTakeFirst(),
  );
  if (!p) return false;
  if (p.optout_automatizaciones === true) return true;
  return p.telefono ? (await optOutDeTelefono(String(p.telefono))).activo : false;
}

/**
 * MARCA el opt-out: los dos flags del paciente (si el teléfono es de alguno)
 * y el evento en la conversación. Idempotente por `mensajeId` cuando lo
 * detecta el agente (una reentrega no duplica); una decisión humana viene
 * sin id y se registra tal cual.
 */
export async function marcarOptOut(args: {
  telefono: string;
  frase?: string | null;
  actorNombre?: string | null;
  actorId?: string | null;
  mensajeId?: string | null;
}): Promise<void> {
  const cliente = requireCliente("marcarOptOut");
  const dig = soloDigitos(args.telefono);
  if (dig.length < 7) throw new Error("marcarOptOut: teléfono sin identificador suficiente");
  await runWithClienteDb(cliente, (trx) =>
    // Cero filas es legítimo (un desconocido no tiene ficha): no se fuerza
    // error (§1, excepción declarada en su línea).
    sql`update pacientes set optout_automatizaciones = true, opt_out = true
         where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${"%" + dig + "%"}`.execute(trx),
  );
  const { registrarEvento, registrarEventoIdempotente } = await import("../automatizacion/pg");
  const base = {
    tipoCaso: "conversacion" as const,
    casoId: args.telefono,
    evento: "opt_out" as const,
    actorNombre: args.actorNombre ?? "agente",
    actorId: args.actorId ?? null,
    motivoTexto: args.frase ? `«${args.frase.trim().replace(/\s+/g, " ").slice(0, 120)}»` : null,
  };
  if (args.mensajeId) await registrarEventoIdempotente({ ...base, mensajeId: args.mensajeId });
  else await registrarEvento(base);
}

/** La reversión manual: solo una persona, siempre con nombre. */
export async function revertirOptOut(args: {
  telefono: string;
  actorNombre: string;
  actorId?: string | null;
}): Promise<void> {
  const cliente = requireCliente("revertirOptOut");
  const dig = soloDigitos(args.telefono);
  if (dig.length < 7) throw new Error("revertirOptOut: teléfono sin identificador suficiente");
  await runWithClienteDb(cliente, (trx) =>
    sql`update pacientes set optout_automatizaciones = false, opt_out = false
         where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${"%" + dig + "%"}`.execute(trx),
  );
  const { registrarEvento } = await import("../automatizacion/pg");
  await registrarEvento({
    tipoCaso: "conversacion",
    casoId: args.telefono,
    evento: "opt_in",
    actorNombre: args.actorNombre,
    actorId: args.actorId ?? null,
    motivoTexto: "opt-out revertido por una persona",
  });
}

/**
 * ¿Escribir a este teléfono AHORA sería contactar proactivamente? Con
 * opt-out activo solo se permite RESPONDER: el último mensaje del hilo tiene
 * que ser suyo (Entrante). Lo usan el composer (aviso + bloqueo) y las rutas
 * de envío (409): una fuente, todos los lectores.
 */
export async function envioBloqueadoPorOptOut(
  telefono: string,
): Promise<{ bloqueado: boolean; estado: EstadoOptOut }> {
  const estado = await optOutDeTelefono(telefono);
  if (!estado.activo) return { bloqueado: false, estado };
  const cliente = requireCliente("envioBloqueadoPorOptOut");
  const dig = soloDigitos(telefono);
  const ultimo = await runWithClienteDb(cliente, (trx) =>
    sql<{ direccion: string | null }>`select direccion from mensajes_whatsapp
         where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${"%" + dig + "%"}
           and "timestamp" is not null
         order by "timestamp" desc limit 1`.execute(trx),
  );
  const ultimaDireccion = ultimo.rows?.[0]?.direccion ?? null;
  return { bloqueado: ultimaDireccion !== "Entrante", estado };
}
