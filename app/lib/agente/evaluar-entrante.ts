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
import { evaluarTurno, MOTIVO_FALLBACK_EVALUADOR, type EntradaEvaluador, type MensajeHilo, type SenalesHilo } from "./evaluador";
import { persistirTurno, leerPayloadEvaluacion } from "./persistir-turno";
import { sombraDelTurno } from "./sombra";
import { entradaDesdeContexto } from "./entrada-desde-contexto";
import { objetivosDeClinica, conocimientoDeClinica } from "../automatizacion/pg";
import type { ConocimientoClinica } from "./conocimiento";
import { semaforoDeContacto } from "../automatizacion/semaforo";
import { type ClaveAplazado, type EventoAplazamiento } from "../automatizacion/aplazamientos";
import type { ObjetivoAgente } from "../automatizacion/objetivos";
import { hoyISO, horaClinica } from "../time";
import { type TipoMensaje } from "../mensajeria/tipos-mensaje";
import { avisarFalloAgente, falloReintentable, type MotivoFalloAgente } from "./avisos";
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

// (La coletilla del cobro, el orden de objetivos, la pista de perfil y el
// resto de la ENTRADA se construyen en entrada-desde-contexto — el mismo
// constructor que usa el banco de pruebas. MEJORAS 225.)

/** MEJORAS 145 — tope de turnos por conversación en 24 h. El banco de pruebas
 *  tenía 100/día; el camino real, nada: un bucle (dos bots, un número que
 *  reenvía) quemaría modelo sin límite. Configurable por entorno. */
const TOPE_TURNOS_24H_DEFAULT = 50;
export function topeTurnos24h(): number {
  const v = Number(process.env["AGENTE_TOPE_TURNOS_24H"]);
  return Number.isInteger(v) && v > 0 ? v : TOPE_TURNOS_24H_DEFAULT;
}

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

/** Lo que devuelve un turno. Los callers de siempre lo ignoran; la cola de
 *  trabajos (MEJORAS 164) decide con él si pide reintento: solo un `fallo`
 *  reintentable merece un 5xx. */
export type ResultadoTurno =
  /** `entrada`: lo que se le dio al evaluador (hilos jugados, 10-09). Los
   *  hilos jugados la guardan en su fixture para rejugar el turno contra
   *  otra versión del prompt sin base ni contexto. */
  | { estado: "evaluado"; entrada: EntradaEvaluador }
  | { estado: "saltado"; motivo: "ya_evaluado" | "sin_actuar" }
  | { estado: "fallo"; motivo: MotivoFalloAgente; reintentable: boolean };

const fallo = (motivo: MotivoFalloAgente): ResultadoTurno => ({ estado: "fallo", motivo, reintentable: falloReintentable(motivo) });

/** ¿Este entrante ya tiene su turno persistido? La clave de idempotencia del
 *  turno es el mensaje_id (waba). Un reintento de la cola, una reentrega de
 *  Meta o el barrido llegando tarde no gastan modelo ni duplican nada. */
export async function turnoYaEvaluado(mensajeId: string): Promise<boolean> {
  const cliente = requireCliente("turnoYaEvaluado");
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<{ ok: number }>`select 1 as ok from eventos_automatizacion
        where tipo_caso = 'conversacion' and mensaje_id = ${mensajeId}
          and evento in ('evaluacion', 'derivado')
        limit 1`.execute(trx),
  );
  return (r.rows?.length ?? 0) > 0;
}

export async function evaluarEntranteConversacion(e: EntranteAEvaluar): Promise<ResultadoTurno> {
  const cliente = requireCliente("evaluarEntranteConversacion");

  // 0 · Idempotencia por mensaje (MEJORAS 164): si el turno ya está, no se
  //     vuelve a evaluar. Antes la persistencia lo deduplicaba al escribir;
  //     ahora tampoco se gasta el modelo.
  if (await turnoYaEvaluado(e.mensajeId)) return { estado: "saltado", motivo: "ya_evaluado" };

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
      mensajeId: e.mensajeId,
    });
    return fallo("contexto_no_disponible");
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
      mensajeId: e.mensajeId,
    });
    return fallo("configuracion_ilegible");
  }
  // (los objetivos abiertos los resuelve el constructor de la entrada)

  const ahora = e.ahora ?? new Date();

  // 3 · Hilo, log de aplazamientos, no-reversión y próxima cita — todo del
  //     borde, contado por código.
  const datos = await runWithClienteDb(cliente, async (trx) => {
    const hiloRows = await trx
      .selectFrom("mensajes_whatsapp")
      .select(["direccion", "contenido", "timestamp", "tipo", "clinica_id"])
      .where("telefono", "=", e.telefono)
      // MEJORAS 130: un saliente pendiente de confirmar no está en el hilo que
      // lee el modelo — leería «Clínica: …» sobre algo que quizá nunca salió.
      .where(sql<boolean>`coalesce(fuente, '') <> 'Modo_A_manual_pendiente'`)
      .orderBy("timestamp", "desc")
      .limit(80)
      .execute();

    // MEJORAS 122 — la red: por qué clínicas ha pasado el hilo, con nombre.
    const idsClinicas = [...new Set(hiloRows.map((m) => m.clinica_id).filter((x): x is string => Boolean(x)))];
    if (clinicaConfig && !idsClinicas.includes(clinicaConfig)) idsClinicas.push(clinicaConfig);
    const nombresClinicas = idsClinicas.length
      ? await trx.selectFrom("clinicas").select(["id", "nombre"]).where("id", "in", idsClinicas).execute()
      : [];

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
      const c = await sql<{ prox: Date | null }>`select min(hora_inicio) as prox from citas
          where paciente_id = ${ctx.pacienteId} and hora_inicio >= now()`.execute(trx);
      proximaCita = c.rows?.[0]?.prox ?? null;
    }
    // MEJORAS 145 — cuántos turnos ha consumido ESTA conversación en las
    // últimas 24 h (rodante a propósito: guarda técnica, no umbral de negocio).
    const t24 = await sql<{ n: number }>`select count(*)::int as n from eventos_automatizacion
        where tipo_caso = 'conversacion' and caso_id = ${e.telefono} and evento = 'evaluacion'
          and created_at > ${ahora}::timestamptz - interval '24 hours'`.execute(trx);
    const turnos24h = Number(t24.rows?.[0]?.n ?? 0);
    // MEJORAS 233 — descartes SEGUIDOS antes de este turno. No hace falta
    // recorrer el hilo: cada turno escribe su propia cuenta corrida, así que
    // basta el ÚLTIMO turno persistido. Un turno que no descartó escribe 0 y
    // el contador se reinicia solo.
    const ult = await sql<{ json: unknown }>`select evaluacion_json as json from eventos_automatizacion
        where tipo_caso = 'conversacion' and caso_id = ${e.telefono} and evento = 'evaluacion'
        order by created_at desc limit 1`.execute(trx);
    const nSeguidos = leerPayloadEvaluacion(ult.rows?.[0]?.json)?.descartesSeguidos;
    const descartesSeguidosAntes = typeof nSeguidos === "number" && Number.isFinite(nSeguidos) ? Math.max(0, nSeguidos) : 0;
    return { hiloRows, eventos, proximaCita, nombresClinicas, turnos24h, descartesSeguidosAntes };
  });

  // MEJORAS 145 — el tope. El caso queda VISIBLE como «Sin evaluar» y con
  // aviso en la campana (uno por hora); el barrido lo reintenta sin coste
  // hasta que la ventana baje del tope.
  if (datos.turnos24h >= topeTurnos24h()) {
    await avisarFalloAgente({
      motivo: "tope_turnos",
      detalle: `${datos.turnos24h} turnos en 24 h (tope ${topeTurnos24h()})`,
      clinicaId: clinicaConfig,
      telefono: e.telefono,
      mensajeId: e.mensajeId,
    });
    return fallo("tope_turnos");
  }

  const nombreDe = (id: string | null) => datos.nombresClinicas.find((c) => String(c.id) === id)?.nombre ?? null;
  const otrasClinicas = [...new Set(datos.hiloRows.map((m) => m.clinica_id).filter((x): x is string => Boolean(x)))]
    .filter((id) => id !== clinicaConfig)
    .map((id) => nombreDe(id) ?? id);
  const clinicasDelHilo = otrasClinicas.length ? { actual: nombreDe(clinicaConfig), otras: otrasClinicas } : null;

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

  const evsAplazamiento: EventoAplazamiento[] = datos.eventos
    .filter((x) => x.evento === "aplazado" || x.evento === "aplazado_resuelto")
    .map((x) => ({
      evento: x.evento as "aplazado" | "aplazado_resuelto",
      clave: x.clave_aplazado as ClaveAplazado,
      motivoTexto: x.motivo_texto,
      createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at),
    }));
  // MEJORAS 123: vueltas desde el último resuelto, ráfaga = una vuelta.

  // EL SEMÁFORO (026): el agente calla mientras el ASUNTO derivado siga sin
  // resolver (hecho del sistema o resuelto_manual) o el hilo esté asumido.
  // La ESPERA no calla al evaluador: responder a quien escribe no es
  // contactar — la espera suspende lo PROACTIVO (cadencias).
  const sem = await semaforoDeContacto(e.telefono, { hoy: e.hoy });

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

  // MEJORAS 135: el opt-out, de su fuente única. Se lee siempre; un fallo
  // aquí no puede tumbar el turno (se degrada a «no consta», con log).
  let optOutVigente = false;
  try {
    optOutVigente = (await optOutDeTelefono(e.telefono)).activo;
  } catch (err) {
    console.error("[evaluar-entrante] opt-out no comprobable:", err instanceof Error ? err.message : err);
  }

  // 4 · Evaluar y persistir. La entrada se construye aparte y viaja en el
  //     resultado: es lo que un replay por versión necesita (hilos jugados).
  //     MEJORAS 225: la entrada la construye entrada-desde-contexto, el MISMO
  //     constructor que el banco de pruebas. Aquí solo se traen las piezas.
  const entrada: EntradaEvaluador = entradaDesdeContexto({
    ctx,
    objetivosConfig,
    conocimiento,
    clinicaNombre: nombreDe(clinicaConfig),
    hilo,
    tipoEntrante: e.tipo ?? null,
    aplazamientos: evsAplazamiento,
    semaforo: sem,
    diasHastaProximaCita,
    senales: senalesDelHilo(hilo, ahora, conocimiento.plazos.horario),
    descartesSeguidosAntes: datos.descartesSeguidosAntes,
    optOutVigente,
    clinicasDelHilo,
    hoy: e.hoy,
  });
  const evaluacion = await evaluarTurno(entrada);

  if (!evaluacion.actuar) return { estado: "saltado", motivo: "sin_actuar" };

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
      mensajeId: e.mensajeId,
    });
    // No reintentable: el turno YA está persistido como fallback (derivado).
    return fallo("modelo_no_disponible");
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
        mensajeId: e.mensajeId,
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
  // 6 · FASE 1 EN SOMBRA (11-09): el modelo elige su acto en paralelo con la
  //     MISMA entrada; se persiste al lado del acto del código (agente_sombra)
  //     y se lee en /sombra. NO decide nada: el turno ya está persistido y
  //     avisado arriba, y sombraDelTurno nunca lanza (un fallo se ve en el
  //     visor como turno sin sombra). Corre solo donde AGENTE_SOMBRA lo diga
  //     (por defecto, el cliente DEMO).
  await sombraDelTurno({
    entrada,
    evaluacion,
    telefono: e.telefono,
    mensajeId: e.mensajeId,
    entrante: e.contenido,
    origen: "produccion",
    clinicaId: clinicaConfig,
    persona: ctx.nombre,
  });
  return { estado: "evaluado", entrada };
}
