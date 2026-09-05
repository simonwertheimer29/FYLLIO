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
//
// AUDITORÍA 2026-09-05 — lo que cambió aquí:
//   · los fallos sistemáticos (config ilegible, contexto roto, modelo caído)
//     dejan de morir en consola: `avisarFalloAgente` (MEJORAS 128);
//   · la config, los objetivos y el conocimiento salen de la clínica del
//     NÚMERO que recibió, no de la ficha del paciente (MEJORAS 122);
//   · el hilo lleva `tipo`: lo no legible deriva sin modelo (034);
//   · la insistencia se cuenta desde el último resuelto y una ráfaga es una
//     vuelta (MEJORAS 123); la coletilla del cobro va una vez (120); tres
//     señales del hilo contadas por código (150); el opt-out se lee y se
//     marca en su fuente única (135).

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { contextoDeConversacion } from "./contexto-conversacion";
import { evaluarTurno, MOTIVO_FALLBACK_EVALUADOR, type MensajeHilo, type SenalesHilo } from "./evaluador";
import { persistirTurno } from "./persistir-turno";
import { objetivosDeClinica, conocimientoDeClinica } from "../automatizacion/pg";
import type { ConocimientoClinica } from "./conocimiento";
import { semaforoDeContacto } from "../automatizacion/semaforo";
import {
  pendientesDeAplazados,
  vueltasPorClave,
  type ClaveAplazado,
  type EventoAplazamiento,
} from "../automatizacion/aplazamientos";
import type { ObjetivoAgente } from "../automatizacion/objetivos";
import { hoyISO, horaClinica } from "../time";
import { esLegible, etiquetaDeTipo, type TipoMensaje } from "../mensajeria/tipos-mensaje";
import { avisarFalloAgente } from "./avisos";
import { optOutDeTelefono, marcarOptOut } from "../contacto/optout";
import { HORARIO_DEFAULT, type HorarioLaboral } from "../automatizaciones/types";

export type EntranteAEvaluar = {
  /** E.164 — la clave del hilo. */
  telefono: string;
  /** waba_message_id del entrante (idempotencia del turno). */
  mensajeId: string;
  contenido: string;
  /** 034 — tipo del entrante que dispara el turno. Ausente = texto. */
  tipo?: TipoMensaje | null;
  presupuestoId?: string | null;
  /** Clínica del NÚMERO que recibió el mensaje (019). Manda sobre la de la
   *  ficha para elegir configuración (MEJORAS 122). */
  clinicaId?: string | null;
  /** Día de clínica inyectado desde el borde (§14) — lo usan el calendario
   *  de la espera, el semáforo y la cuenta de días hasta la cita. Default:
   *  hoy real. Los recorridos del QA viajan en el tiempo con esto. */
  hoy?: string;
  /** Instante inyectado (§14) para las señales del hilo. Default: ahora. */
  ahora?: Date;
};

const FRASE_RECUERDO_COBRO = /pago pendiente|pendiente de pago|pago que tienes pendiente|tienes un pago/i;

/** Las señales del hilo (MEJORAS 150), contadas por código. */
function senalesDelHilo(
  hilo: readonly MensajeHilo[],
  ahora: Date,
  horario: HorarioLaboral | null,
): SenalesHilo {
  const orden = [...hilo].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  const iUltimo = orden.map((m) => m.direccion).lastIndexOf("Entrante");
  const previos = iUltimo >= 0 ? orden.slice(0, iUltimo) : orden;
  const ultimoSaliente = [...previos].reverse().find((m) => m.direccion === "Saliente") ?? null;
  const entrantePrevio = [...previos].reverse().find((m) => m.direccion === "Entrante") ?? null;
  const ref = iUltimo >= 0 ? new Date(orden[iUltimo]!.timestamp).getTime() : ahora.getTime();
  const minutos = (iso: string | null) =>
    iso ? Math.max(0, Math.round((ref - new Date(iso).getTime()) / 60_000)) : null;
  // Salientes seguidos justo antes de este entrante: «se le escribió N veces
  // sin respuesta».
  let salientesSinRespuestaAntes = 0;
  for (let i = previos.length - 1; i >= 0; i--) {
    if (previos[i]!.direccion === "Saliente") salientesSinRespuestaAntes++;
    else break;
  }
  const horaLocal = horaClinica(ahora);
  const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;
  const diaLocal = DIAS[new Date(`${hoyISO(ahora)}T12:00:00Z`).getUTCDay()];
  const h = (horario ?? HORARIO_DEFAULT)[diaLocal as keyof HorarioLaboral];
  const enHorario = Boolean(h?.activo) && horaLocal >= h.inicio && horaLocal < h.fin;
  return {
    minutosDesdeUltimoSaliente: minutos(ultimoSaliente?.timestamp ?? null),
    minutosDesdeEntrantePrevio: minutos(entrantePrevio?.timestamp ?? null),
    salientesSinRespuestaAntes,
    horaLocal,
    enHorario,
  };
}

export async function evaluarEntranteConversacion(e: EntranteAEvaluar): Promise<void> {
  const cliente = requireCliente("evaluarEntranteConversacion");

  // 1 · Contexto determinista. Un fallo de datos NO evalúa sobre un contexto
  //     inventado — y desde hoy se AVISA (MEJORAS 128), no solo se loguea.
  let ctx: Awaited<ReturnType<typeof contextoDeConversacion>>;
  try {
    ctx = await contextoDeConversacion(e.telefono);
  } catch (err) {
    await avisarFalloAgente({
      motivo: "contexto_no_disponible",
      detalle: err instanceof Error ? err.message : String(err),
      clinicaId: e.clinicaId ?? null,
      telefono: e.telefono,
    });
    return;
  }

  // 2 · Objetivos y conocimiento de la clínica DEL NÚMERO que recibió
  //     (MEJORAS 122): en una red, el paciente de la clínica A que escribe a
  //     la B recibe horarios y precios de la B, que es a quien escribió. La
  //     ficha solo desempata cuando el número no dice clínica.
  const clinicaConfig = e.clinicaId ?? ctx.clinicaId ?? null;
  let objetivosConfig: readonly ObjetivoAgente[];
  let conocimiento: ConocimientoClinica;
  try {
    objetivosConfig = await objetivosDeClinica(clinicaConfig);
    conocimiento = await conocimientoDeClinica(clinicaConfig);
  } catch (err) {
    // Config ilegible → fail-closed: el agente no actúa con objetivos que la
    // clínica no eligió. El caso queda visible por construcción (entrante
    // sin responder = Necesita respuesta) y el fallo llega a la campana.
    await avisarFalloAgente({
      motivo: "configuracion_ilegible",
      detalle: err instanceof Error ? err.message : String(err),
      clinicaId: clinicaConfig,
      telefono: e.telefono,
    });
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
      .select(["direccion", "contenido", "timestamp", "tipo"])
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
      tipo: (m as { tipo?: string | null }).tipo ?? null,
    }));

  // 034 — el último entrante del hilo (el que dispara el turno, o el más
  // reciente si llegaron varios): si NO es legible, el turno deriva sin
  // modelo y sin inventar respuesta.
  const ultimoEntrante = [...hilo].reverse().find((m) => m.direccion === "Entrante") ?? null;
  const tipoUltimo = (ultimoEntrante?.tipo ?? e.tipo ?? "text") as TipoMensaje;
  const ultimoNoLegible = !esLegible(tipoUltimo) ? { tipo: tipoUltimo, etiqueta: etiquetaDeTipo(tipoUltimo) } : null;

  const evsAplazamiento: EventoAplazamiento[] = datos.eventos
    .filter((x) => x.evento === "aplazado" || x.evento === "aplazado_resuelto")
    .map((x) => ({
      evento: x.evento as "aplazado" | "aplazado_resuelto",
      clave: x.clave_aplazado as ClaveAplazado,
      motivoTexto: x.motivo_texto,
      createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at),
    }));
  const pendientes = pendientesDeAplazados(evsAplazamiento);
  // MEJORAS 123: vueltas desde el último resuelto, ráfaga = una vuelta.
  const aplazadosPorClave = vueltasPorClave(evsAplazamiento);

  // EL SEMÁFORO (026): el agente calla mientras el ASUNTO derivado siga sin
  // resolver (hecho del sistema o resuelto_manual) o el hilo esté asumido.
  // La ESPERA no calla al evaluador: responder a quien escribe no es
  // contactar — la espera suspende lo PROACTIVO (cadencias).
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

  // MEJORAS 120: ¿ya se le recordó el pago en esta conversación? Contado
  // de los salientes del hilo, no juzgado.
  const cobroYaRecordado = hilo.some((m) => m.direccion === "Saliente" && FRASE_RECUERDO_COBRO.test(m.contenido));

  // MEJORAS 135: el opt-out, de su fuente única. Se lee siempre; un fallo
  // aquí no puede tumbar el turno (se degrada a «no consta», con log).
  let optOutVigente = false;
  try {
    optOutVigente = (await optOutDeTelefono(e.telefono)).activo;
  } catch (err) {
    console.error("[evaluar-entrante] opt-out no comprobable:", err instanceof Error ? err.message : err);
  }

  const ahora = e.ahora ?? new Date();

  // 4 · Evaluar y persistir.
  const evaluacion = await evaluarTurno({
    nombre: ctx.nombre,
    esPacienteConocido: ctx.pacienteId != null,
    objetivosAbiertos,
    presupuestosVivos: ctx.presupuestosVivos.map((p) => ({ id: p.id, tratamiento: p.tratamiento, importe: p.importe })),
    pendienteCobro: ctx.pendienteCobro,
    hilo,
    aplazadosPendientes: pendientes.flatMap((p) => p.motivos.map((motivo) => ({ clave: p.clave, motivo }))),
    aplazadosPorClave,
    conocimiento,
    umbralInsistencia: conocimiento.alcance.umbralInsistencia ?? undefined,
    urgencias: conocimiento.alcance.urgencias ?? undefined,
    diasHastaProximaCita,
    yaDerivado,
    hoy: e.hoy,
    esperaVigente:
      !sem.verde && sem.motivo === "espera" && sem.hasta
        ? { hasta: sem.hasta, motivo: sem.esperaMotivo ?? null }
        : null,
    ultimoNoLegible,
    cobroYaRecordado,
    senales: senalesDelHilo(hilo, ahora, conocimiento.plazos.horario),
    optOutVigente,
  });

  if (!evaluacion.actuar) return;

  await persistirTurno({
    telefono: e.telefono,
    mensajeId: e.mensajeId,
    respuestaPaciente: e.contenido,
    evaluacion,
  });

  if (evaluacion.fallback) {
    await avisarFalloAgente({
      motivo: "modelo_no_disponible",
      detalle: MOTIVO_FALLBACK_EVALUADOR,
      clinicaId: clinicaConfig,
      telefono: e.telefono,
    });
    return;
  }

  // MEJORAS 135: la persona pidió no recibir mensajes → se marca en la
  // fuente única (paciente + log), idempotente por mensaje.
  if (evaluacion.pideNoContacto) {
    try {
      await marcarOptOut({ telefono: e.telefono, frase: e.contenido, mensajeId: e.mensajeId });
    } catch (err) {
      // Un opt-out que no se pudo marcar es un dato perdido: se avisa.
      await avisarFalloAgente({
        motivo: "error_inesperado",
        detalle: `opt-out no marcado: ${err instanceof Error ? err.message : String(err)}`,
        clinicaId: clinicaConfig,
        telefono: e.telefono,
      });
    }
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
        link: e.presupuestoId ? `/pipeline/presupuestos?tab=intervencion&item=${e.presupuestoId}` : "/mensajeria",
      });
    } catch (err) {
      console.error("[evaluar-entrante] notificación:", err instanceof Error ? err.message : err);
    }
  }
}
