// app/lib/seguimiento/registrar-llamada.ts
//
// MEJORAS 102 (18-08, decisiones dictadas) — registrar una llamada desde la
// ficha Y QUE LA COLA SE ENTERE. El problema que cierra: registrar un
// contacto ya se podía, pero la cola lo ignoraba (el estado de conversación
// es de mensajes y el clasificador solo cambia por eventos del log) — llamar
// y registrar dejaba el caso en «toca llamar» como si nada.
//
// Dos resultados, cada uno con su efecto REAL:
//   · no_contesta → registra el contacto + fija ESPERA hasta el PRÓXIMO DÍA
//     LABORABLE (decisión: 1 día laborable) con la pieza 026 que ya existe:
//     el caso sale de la cola, las cadencias quedan suspendidas por el
//     semáforo, y vuelve SOLO al vencer. Sin estado nuevo, sin caducidad.
//   · hablado → registra el contacto con la nota. NADA más: la conversación
//     manda (decisión) — si de la llamada sale un acuerdo, se escribe por
//     WhatsApp (y el estado se mueve por los mensajes) o se cierra por los
//     flujos de siempre (estado del presupuesto, botón «resuelto»). No se
//     inventa un «cerrado por llamada».
//
// El registro del hecho va por el camino de su tipo (contacto de presupuesto
// con su ContactCount · acción de lead · para huérfanos el evento del log es
// el registro). §1: primero se escribe el hecho; la espera después — si la
// espera fallara, queda una llamada registrada sin pausa (visible), nunca
// una pausa sin llamada (invisible).

import { DateTime } from "luxon";
import { registrarEvento } from "../automatizacion/pg";
import { proximoDiaLaborable } from "./tiempo-laborable";
import { hoyISO } from "../time";

const ZONE = "Europe/Madrid";

export type ResultadoLlamada = "no_contesta" | "hablado";

export type ArgsRegistrarLlamada = {
  telefono: string;
  tipo: "lead" | "presupuesto" | "conversacion";
  /** Id desnudo del caso (para conversacion, el teléfono). */
  casoId: string;
  resultado: ResultadoLlamada;
  nota?: string | null;
  actor: { id?: string | null; nombre?: string | null };
  hoy?: string;
};

export async function registrarLlamada(args: ArgsRegistrarLlamada): Promise<{
  esperaHasta: string | null;
}> {
  const hoy = args.hoy ?? hoyISO();
  const notaLimpia = (args.nota ?? "").trim() || null;
  const etiquetaResultado = args.resultado === "no_contesta" ? "No contesta" : "Habló";

  // 1 · El HECHO, por el camino de su tipo (§1: persistir antes de nada).
  if (args.tipo === "presupuesto") {
    const { createContactoConRecordRaw } = await import("../presupuestos/contactos");
    const { getPresupuestoPorIdRaw, updatePresupuestoRaw } = await import("../presupuestos/repo");
    await createContactoConRecordRaw({
      PresupuestoId: args.casoId,
      TipoContacto: "llamada",
      Resultado: args.resultado === "no_contesta" ? "no contestó" : "contestó",
      FechaHora: DateTime.now().setZone(ZONE).toISO()!,
      RegistradoPor: args.actor.nombre ?? args.actor.id ?? "coordinación",
      ...(notaLimpia ? { Nota: notaLimpia } : {}),
    });
    // El toque cuenta (mismo criterio que /api/presupuestos/contactos).
    try {
      const rec = await getPresupuestoPorIdRaw(args.casoId, ["ContactCount"]);
      const n = rec ? Number((rec.fields as any)["ContactCount"] ?? 0) : 0;
      await updatePresupuestoRaw(args.casoId, {
        UltimoContacto: hoy,
        ContactCount: n + 1,
      });
    } catch (err) {
      console.error("[registrar-llamada] contacto creado pero ContactCount no actualizado:", err instanceof Error ? err.message : err);
    }
  } else if (args.tipo === "lead") {
    const { logAccionLead } = await import("../leads/acciones");
    await logAccionLead({
      leadId: args.casoId,
      tipo: "Llamada",
      usuarioId: args.actor.id ?? undefined,
      detalles: `${etiquetaResultado}${notaLimpia ? ` — ${notaLimpia}` : ""}`,
    });
  }
  // (conversacion: el evento de abajo es el registro — no hay ficha de caso.)

  // 2 · El EFECTO sobre la cola.
  if (args.resultado === "no_contesta") {
    const hasta = proximoDiaLaborable(hoy);
    await registrarEvento({
      tipoCaso: "conversacion",
      casoId: args.telefono,
      evento: "espera_fijada",
      hasta,
      motivoTexto: `Llamada sin respuesta${notaLimpia ? ` — ${notaLimpia}` : ""} · reintento el próximo día laborable`,
      actorId: args.actor.id ?? null,
      actorNombre: args.actor.nombre ?? null,
    } as any);
    return { esperaHasta: hasta };
  }

  // hablado: la conversación manda — para los huérfanos, que no tienen ficha
  // de contactos, el log guarda al menos que se habló (mensaje_enviado NO:
  // significaría otra cosa; el semáforo y la cola no cambian, a propósito).
  return { esperaHasta: null };
}
