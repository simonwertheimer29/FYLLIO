// app/lib/agente/evaluar-entrante.ts
//
// El ORQUESTADOR del paso 5: para UN entrante ya persistido, carga lo que el
// evaluador necesita (contexto, objetivos, hilo, log), evalúa, persiste el
// turno y notifica. Es el pegamento entre el webhook y las libs puras — aquí
// vive la carga de datos que evaluarTurno recibe inyectada (§14).
//
// GARANTÍA DE ORDEN: esto corre en after(), SIEMPRE después de que el mensaje
// esté guardado. La evaluación es secundaria al registro: cualquier fallo
// aquí pierde un turno de juicio (que el siguiente entrante re-deriva del
// hilo entero — el evaluador no tiene memoria), jamás un dato del paciente.
//
// PUSH SOLO PARA LA COLA PRIORITARIA (criterio del plan, 2026-08-14): el push
// es para lo que no puede esperar, no para lo que hay que hacer. Derivar por
// caso_completo será el volumen (§3) — avisar por cada uno mataría los avisos
// que importan. Lo demás llega a la bandeja sin interrumpir a nadie.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { contextoDeConversacion } from "./contexto-conversacion";
import { evaluarTurno, MOTIVO_FALLBACK_EVALUADOR, type MensajeHilo } from "./evaluador";
import { persistirTurno } from "./persistir-turno";
import { objetivosDeClinica } from "../automatizacion/pg";
import { semaforoDeContacto } from "../automatizacion/semaforo";
import {
  pendientesDeAplazados,
  type ClaveAplazado,
  type EventoAplazamiento,
} from "../automatizacion/aplazamientos";
import type { ObjetivoAgente } from "../automatizacion/objetivos";
import { hoyISO } from "../time";

export type EntranteAEvaluar = {
  /** E.164 — la clave del hilo. */
  telefono: string;
  /** waba_message_id del entrante (idempotencia del turno). */
  mensajeId: string;
  contenido: string;
  presupuestoId?: string | null;
  clinicaId?: string | null;
  /** Día de clínica inyectado desde el borde (§14) — lo usan el calendario
   *  de la espera, el semáforo y la cuenta de días hasta la cita. Default:
   *  hoy real. Los recorridos del QA viajan en el tiempo con esto. */
  hoy?: string;
};

export async function evaluarEntranteConversacion(e: EntranteAEvaluar): Promise<void> {
  const cliente = requireCliente("evaluarEntranteConversacion");

  // 1 · Contexto determinista (lanza ante fallo de datos — mejor perder el
  //     turno que evaluar sobre un contexto inventado).
  const ctx = await contextoDeConversacion(e.telefono);

  // 2 · Objetivos de la clínica. Configuración ilegible → fail-closed AQUÍ:
  //     el agente no actúa con objetivos que la clínica no eligió; el caso
  //     sube a persona por la vía compat con motivo visible.
  let objetivosConfig: readonly ObjetivoAgente[];
  try {
    objetivosConfig = await objetivosDeClinica(ctx.clinicaId ?? e.clinicaId ?? null);
  } catch (err) {
    console.error("[evaluar-entrante] configuración de objetivos ilegible:", err instanceof Error ? err.message : err);
    if (e.presupuestoId) {
      const { updatePresupuestoRaw } = await import("../presupuestos/repo");
      await updatePresupuestoRaw(e.presupuestoId, {
        Requiere_persona: true,
        Motivo_quiebre: "La configuración de objetivos de la clínica no se pudo leer",
        Urgencia_intervencion: "MEDIO",
        Accion_sugerida: "Revisar la configuración",
      });
    }
    return;
  }
  const objetivosAbiertos = ctx.objetivosAbiertos
    .map((etapa) => objetivosConfig.find((o) => o.etapa === etapa))
    .filter((o): o is ObjetivoAgente => o != null);

  // 3 · Hilo, log de aplazamientos, no-reversión y próxima cita — todo del
  //     borde, contado por código.
  const datos = await runWithClienteDb(cliente, async (trx) => {
    const hiloRows = await trx
      .selectFrom("mensajes_whatsapp")
      .select(["direccion", "contenido", "timestamp"])
      .where("telefono", "=", e.telefono)
      .orderBy("timestamp", "desc")
      .limit(80)
      .execute();

    const eventos = await trx
      .selectFrom("eventos_automatizacion")
      .select(["evento", "clave_aplazado", "motivo_texto", "created_at"])
      .where("tipo_caso", "=", "conversacion")
      .where("caso_id", "=", e.telefono)
      .where("evento", "in", ["aplazado", "aplazado_resuelto"])
      .orderBy("created_at", "asc")
      .execute();

    let proximaCita: Date | null = null;
    if (ctx.pacienteId) {
      const c: any = await sql`select min(hora_inicio) as prox from citas
          where paciente_id = ${ctx.pacienteId} and hora_inicio >= now()`.execute(trx);
      proximaCita = c.rows?.[0]?.prox ?? null;
    }
    return { hiloRows, eventos, proximaCita };
  });

  const hilo: MensajeHilo[] = datos.hiloRows
    .reverse()
    .filter((m) => m.direccion === "Entrante" || m.direccion === "Saliente")
    .map((m) => ({
      direccion: m.direccion as "Entrante" | "Saliente",
      contenido: String(m.contenido ?? ""),
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
    }));

  const evsAplazamiento: EventoAplazamiento[] = datos.eventos
    .filter((x) => x.evento === "aplazado" || x.evento === "aplazado_resuelto")
    .map((x) => ({
      evento: x.evento as "aplazado" | "aplazado_resuelto",
      clave: x.clave_aplazado as ClaveAplazado,
      motivoTexto: x.motivo_texto,
      createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at),
    }));
  const pendientes = pendientesDeAplazados(evsAplazamiento);
  const aplazadosPorClave: Partial<Record<ClaveAplazado, number>> = {};
  for (const x of evsAplazamiento) {
    if (x.evento !== "aplazado") continue;
    aplazadosPorClave[x.clave] = (aplazadosPorClave[x.clave] ?? 0) + 1;
  }

  // EL SEMÁFORO (026): el agente calla mientras el ASUNTO derivado siga sin
  // resolver (hecho del sistema o resuelto_manual) o el hilo esté asumido.
  // Ya no es un EXISTS eterno — el derivado de una prueba de agosto dejó
  // mudo a Carlos tras un reset, y en producción cada derivación mataba su
  // hilo para siempre. La ESPERA no calla al evaluador: responder a quien
  // escribe no es contactar — la espera suspende lo PROACTIVO (cadencias).
  const sem = await semaforoDeContacto(e.telefono, { hoy: e.hoy });
  const yaDerivado = !sem.verde && sem.motivo !== "espera";

  let diasHastaProximaCita: number | null = null;
  if (datos.proximaCita) {
    const hoy = e.hoy ?? hoyISO();
    const diaCita = hoyISO(datos.proximaCita);
    diasHastaProximaCita = Math.round(
      (new Date(`${diaCita}T00:00:00Z`).getTime() - new Date(`${hoy}T00:00:00Z`).getTime()) / 86_400_000,
    );
  }

  // 4 · Evaluar y persistir.
  const evaluacion = await evaluarTurno({
    nombre: ctx.nombre,
    esPacienteConocido: ctx.pacienteId != null,
    objetivosAbiertos,
    presupuestosVivos: ctx.presupuestosVivos.map((p) => ({ tratamiento: p.tratamiento, importe: p.importe })),
    pendienteCobro: ctx.pendienteCobro,
    hilo,
    aplazadosPendientes: pendientes.flatMap((p) => p.motivos.map((motivo) => ({ clave: p.clave, motivo }))),
    aplazadosPorClave,
    diasHastaProximaCita,
    yaDerivado,
    hoy: e.hoy,
    // Punto 5: si hay espera vigente, el modelo juzga si este entrante
    // responde a su motivo; el levantamiento lo decide código.
    esperaVigente:
      !sem.verde && sem.motivo === "espera" && sem.hasta
        ? { hasta: sem.hasta, motivo: sem.esperaMotivo ?? null }
        : null,
  });

  if (!evaluacion.actuar) return;

  await persistirTurno({
    telefono: e.telefono,
    mensajeId: e.mensajeId,
    respuestaPaciente: e.contenido,
    evaluacion,
    presupuestoId: e.presupuestoId ?? null,
  });

  if (evaluacion.fallback) {
    console.error(`[evaluar-entrante] fallback en ${e.telefono} (${MOTIVO_FALLBACK_EVALUADOR})`);
    return;
  }

  // 5 · Push SOLO cola prioritaria: urgencia, antecedente con cita próxima,
  //     petición/queja con malestar. El resto va a la bandeja, sin ruido.
  if (evaluacion.decision === "deriva" && evaluacion.cola === "prioritaria") {
    try {
      const { crearNotificacion } = await import("../presupuestos/notificaciones");
      await crearNotificacion({
        usuario: "todos",
        tipo: "Intervencion_urgente",
        titulo: `Atención inmediata: ${ctx.nombre.split(" ")[0]}`,
        mensaje: e.contenido.slice(0, 120),
        link: e.presupuestoId ? `/presupuestos?tab=intervencion&item=${e.presupuestoId}` : "/mensajeria",
      });
    } catch (err) {
      console.error("[evaluar-entrante] notificación:", err instanceof Error ? err.message : err);
    }
  }
}
