// app/lib/contacto/consentimiento.ts
//
// EL CONSENTIMIENTO DEL CANAL (plan maestro fase 0.3, MEJORAS 166, migración
// 039). Hasta hoy `pacientes.consentimiento_whatsapp` era un boolean sin fecha
// ni origen que nadie escribía ni leía, y los leads no tenían ninguno. Aquí
// hay UNA pregunta —¿consta que este teléfono aceptó que le escribamos?— con
// una respuesta de tres estados: sí, no, desconocido. NULL es desconocido, no
// «no»: la mayoría de las clínicas lo tienen en papel y Fyllio solo lo
// respeta.
//
// El BLOQUEO del envío proactivo sin consentimiento va detrás de un flag
// (CONSENTIMIENTO_WHATSAPP_OBLIGATORIO=true) hasta que la consulta legal diga
// qué forma vale: encenderlo hoy pararía la demo y el piloto con «desconocido».
// Contestar a quien escribe nunca se bloquea (misma doctrina que el opt-out).

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { actualizarUna } from "../db/escritura";

export type EstadoConsentimiento = {
  estado: "si" | "no" | "desconocido";
  fecha: string | null;
  origen: string | null;
  fuente: "paciente" | "lead" | null;
};

const soloDigitos = (raw: string): string => raw.replace(/[^0-9]/g, "");
const DESCONOCIDO: EstadoConsentimiento = { estado: "desconocido", fecha: null, origen: null, fuente: null };

type Fila = { c: boolean | null; f: Date | string | null; o: string | null };

const aEstado = (f: Fila, fuente: "paciente" | "lead"): EstadoConsentimiento => ({
  estado: f.c === true ? "si" : f.c === false ? "no" : "desconocido",
  fecha: f.f ? new Date(f.f).toISOString() : null,
  origen: f.o ?? null,
  fuente,
});

/** ¿Consta consentimiento para este teléfono? El paciente manda sobre el
 *  lead; con varias fichas que se contradicen, «desconocido» (guarda de
 *  ambigüedad, mandamiento 20: no se elige a nadie en silencio). */
export async function consentimientoDeTelefono(telefono: string): Promise<EstadoConsentimiento> {
  const cliente = requireCliente("consentimientoDeTelefono");
  const dig = soloDigitos(telefono);
  if (dig.length < 7) return DESCONOCIDO;
  const patron = `%${dig}%`;
  return runWithClienteDb(cliente, async (trx) => {
    const pa = await sql<Fila>`select consentimiento_whatsapp as c, consentimiento_whatsapp_fecha as f, consentimiento_whatsapp_origen as o
        from pacientes
       where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}
       limit 5`.execute(trx);
    const conDato = (pa.rows ?? []).filter((r) => r.c != null);
    if (conDato.length > 0) {
      const valores = new Set(conDato.map((r) => r.c));
      if (valores.size > 1) return DESCONOCIDO;
      return aEstado(conDato[0]!, "paciente");
    }
    const le = await sql<Fila>`select consentimiento_whatsapp as c, consentimiento_whatsapp_fecha as f, consentimiento_whatsapp_origen as o
        from leads
       where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${patron}
         and consentimiento_whatsapp is not null
       order by created_at desc
       limit 1`.execute(trx);
    const l = le.rows?.[0];
    return l ? aEstado(l, "lead") : DESCONOCIDO;
  });
}

/** Registra el consentimiento (o su retirada) con fecha y origen. Por id,
 *  nunca por nombre (§20). Una escritura que no toca fila lanza (§1). */
export async function registrarConsentimiento(args: {
  pacienteId?: string | null;
  leadId?: string | null;
  valor: boolean;
  origen: string;
}): Promise<void> {
  const cliente = requireCliente("registrarConsentimiento");
  const origen = args.origen.trim().slice(0, 40);
  if (!origen) throw new Error("registrarConsentimiento: origen obligatorio");
  if (!args.pacienteId && !args.leadId) throw new Error("registrarConsentimiento: falta pacienteId o leadId");
  await runWithClienteDb(cliente, async (trx) => {
    if (args.pacienteId) {
      await actualizarUna(
        trx
          .updateTable("pacientes")
          .set({ consentimiento_whatsapp: args.valor, consentimiento_whatsapp_fecha: new Date(), consentimiento_whatsapp_origen: origen })
          .where("id", "=", args.pacienteId),
        "pacientes",
        args.pacienteId,
      );
    }
    if (args.leadId) {
      await actualizarUna(
        trx
          .updateTable("leads")
          .set({ consentimiento_whatsapp: args.valor, consentimiento_whatsapp_fecha: new Date(), consentimiento_whatsapp_origen: origen })
          .where("id", "=", args.leadId),
        "leads",
        args.leadId,
      );
    }
  });
}

/** El flag: mientras la consulta legal no fije la forma, apagado. */
export function consentimientoObligatorio(): boolean {
  return process.env["CONSENTIMIENTO_WHATSAPP_OBLIGATORIO"] === "true";
}

/** ¿Escribir AHORA a este teléfono está bloqueado por falta de
 *  consentimiento? Solo con el flag; y responder a quien acaba de escribir
 *  nunca se bloquea. */
export async function envioBloqueadoPorConsentimiento(
  telefono: string,
): Promise<{ bloqueado: boolean; estado: EstadoConsentimiento }> {
  const estado = await consentimientoDeTelefono(telefono);
  if (!consentimientoObligatorio() || estado.estado === "si") return { bloqueado: false, estado };
  const cliente = requireCliente("envioBloqueadoPorConsentimiento");
  const dig = soloDigitos(telefono);
  const ultimo = await runWithClienteDb(cliente, (trx) =>
    sql<{ direccion: string | null }>`select direccion from mensajes_whatsapp
         where replace(replace(replace(coalesce(telefono,''), ' ', ''), '+', ''), '-', '') like ${"%" + dig + "%"}
           and "timestamp" is not null
         order by "timestamp" desc limit 1`.execute(trx),
  );
  return { bloqueado: (ultimo.rows?.[0]?.direccion ?? null) !== "Entrante", estado };
}
