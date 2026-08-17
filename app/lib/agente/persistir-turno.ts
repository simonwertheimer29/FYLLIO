// app/lib/agente/persistir-turno.ts
//
// Persistencia del turno del evaluador (fase A, paso 4).
//
// LA LÍNEA: se persiste lo que el modelo JUZGÓ (eventos aplazado/derivado y
// el evento `evaluacion` con los juicios); NADA derivable se guarda — listo,
// cola, en-manos se calculan al leer, siempre. Ver migración 024.
//
// ORDEN (§1): aplazados → derivado → evaluación → proyección compat. Todo
// idempotente por (evento, clave, mensaje_id): un reintento del after() o
// una reentrega que se cuele tras el dedup de KV es un no-op, no un
// duplicado — y un aplazado duplicado derivaría por insistencia un caso que
// no tocaba.
//
// LA PROYECCIÓN COMPAT sobre `presupuestos` es una COPIA CON FECHA DE MUERTE
// (MEJORAS-PENDIENTES): existe porque la bandeja, /red y las cohortes leen
// hoy columnas de presupuestos; se RETIRA en la fase B cuando esas pantallas
// lean del log. El log manda.

import { DateTime } from "luxon";
import { registrarEventoIdempotente } from "../automatizacion/pg";
import type { EvaluacionTurno } from "./evaluador";
import { MOTIVO_FALLBACK_EVALUADOR } from "./evaluador";
import type { ClaveAplazado } from "../automatizacion/aplazamientos";
import { colaDeDerivacion } from "../automatizacion/estado";

const ZONE = "Europe/Madrid";

/** La forma del payload de `evaluacion_json`. Cambiarla es cambiar el
 *  histórico: solo añadir campos, nunca renombrar. */
export type PayloadEvaluacion = {
  v: 1;
  tema: string;
  peticionOQueja: boolean;
  malestar: boolean;
  urgenciaMedica: boolean;
  mencionaAntecedenteMedico: boolean;
  vuelveSobreAplazado: ClaveAplazado | null;
  camposRecogidos: EvaluacionTurno["camposRecogidos"];
  hiloTruncado: boolean;
  borradorDescartado: EvaluacionTurno["borradorDescartado"] | null;
  /** El borrador del turno — lo necesita la vista de supervisión (fase C) y
   *  es el único sitio donde vive en hilos sin presupuesto. */
  respuesta: string;
  /** 026 (aditivo) — la espera que fijó el turno, si la hubo. El evento
   *  espera_fijada es la verdad; aquí viaja para la supervisión. */
  esperaHasta?: string | null;
};

export type TurnoAPersistir = {
  /** Clave del hilo (E.164) — es el caso_id de tipo_caso='conversacion'. */
  telefono: string;
  /** waba_message_id del entrante evaluado — la clave de idempotencia. */
  mensajeId: string;
  /** El texto del entrante, para el motivo legible y la proyección compat. */
  respuestaPaciente: string;
  evaluacion: EvaluacionTurno;
  /** Si el hilo tiene presupuesto, se proyecta compat sobre sus columnas. */
  presupuestoId?: string | null;
};

const ACCION_POR_CAUSA: Record<string, string> = {
  urgencia: "Contactar de inmediato",
  antecedente_medico: "Revisar el antecedente antes de la cita",
  peticion_queja: "Atender a la persona",
  insistencia: "Responder lo que quedó aplazado",
  caso_completo: "Cerrar el caso",
};

export async function persistirTurno(t: TurnoAPersistir): Promise<{
  eventosNuevos: number;
  /** true = este mensaje ya estaba persistido (reentrega): no se emitió nada. */
  reentrega: boolean;
}> {
  const ev = t.evaluacion;

  // No-reversión: el caso es de una persona, el turno no produce nada.
  if (!ev.actuar) return { eventosNuevos: 0, reentrega: false };

  // Fallback: NO hubo juicio — sin eventos (un `evaluacion` vacío contaminaría
  // el «trabajado»). Solo la vía compat de siempre: que lo lea alguien.
  if (ev.fallback) {
    if (t.presupuestoId) {
      await proyectarCompatFallback(t.presupuestoId, t.respuestaPaciente);
    }
    return { eventosNuevos: 0, reentrega: false };
  }

  let nuevos = 0;
  let repetidos = 0;
  const cuenta = (r: { insertado: boolean }) => (r.insertado ? nuevos++ : repetidos++);

  // 1 · Aplazados — dedupe por clave dentro del turno (el modelo puede traer
  //     la misma clave como nueva y como re-pregunta; una emisión por clave).
  const porClave = new Map<ClaveAplazado, string>();
  for (const a of ev.aplazamientos) if (!porClave.has(a.clave)) porClave.set(a.clave, a.motivo);
  for (const [clave, motivo] of porClave) {
    cuenta(
      await registrarEventoIdempotente({
        tipoCaso: "conversacion",
        casoId: t.telefono,
        evento: "aplazado",
        claveAplazado: clave,
        motivoTexto: motivo,
        actorNombre: "agente",
        mensajeId: t.mensajeId,
      }),
    );
  }

  // 2 · Derivación, si la hubo — con el HECHO (causa, malestar, y desde la
  //     026 el objetivo que perseguía: sin él no se sabe qué hecho del
  //     sistema cierra el asunto); la cola se deriva al leer.
  if (ev.decision === "deriva" && ev.causa) {
    const frase = t.respuestaPaciente.trim().replace(/\s+/g, " ").slice(0, 120);
    cuenta(
      await registrarEventoIdempotente({
        tipoCaso: "conversacion",
        casoId: t.telefono,
        evento: "derivado",
        causaDerivacion: ev.causa,
        malestar: ev.causa === "peticion_queja" ? (ev.malestar ?? false) : null,
        objetivoActivo: ev.objetivoActivo,
        motivoTexto: frase ? `«${frase}»` : null,
        actorNombre: "agente",
        mensajeId: t.mensajeId,
      }),
    );
  }

  // 2b · La espera (026): el paciente pidió tiempo con fecha concreta y el
  //      tope ya lo aplicó evaluarTurno. Suspende cadencias vía el semáforo;
  //      idempotente por mensaje como todo lo del turno.
  if (ev.esperaHasta) {
    const frase = t.respuestaPaciente.trim().replace(/\s+/g, " ").slice(0, 120);
    cuenta(
      await registrarEventoIdempotente({
        tipoCaso: "conversacion",
        casoId: t.telefono,
        evento: "espera_fijada",
        hasta: ev.esperaHasta,
        motivoTexto: frase ? `«${frase}»` : null,
        actorNombre: "agente",
        mensajeId: t.mensajeId,
      }),
    );
  }

  // 3 · La evaluación del turno: los juicios, tal cual.
  const payload: PayloadEvaluacion = {
    v: 1,
    tema: ev.juicios?.tema ?? "ninguno",
    peticionOQueja: ev.juicios?.peticionOQueja ?? false,
    malestar: ev.juicios?.malestar ?? false,
    urgenciaMedica: ev.juicios?.urgenciaMedica ?? false,
    mencionaAntecedenteMedico: ev.juicios?.mencionaAntecedenteMedico ?? false,
    vuelveSobreAplazado: ev.juicios?.vuelveSobreAplazado ?? null,
    camposRecogidos: ev.camposRecogidos,
    hiloTruncado: ev.hiloTruncado,
    borradorDescartado: ev.borradorDescartado ?? null,
    respuesta: ev.respuesta,
    esperaHasta: ev.esperaHasta ?? null,
  };
  cuenta(
    await registrarEventoIdempotente({
      tipoCaso: "conversacion",
      casoId: t.telefono,
      evento: "evaluacion",
      evaluacionJson: JSON.stringify(payload),
      actorNombre: "agente",
      mensajeId: t.mensajeId,
    }),
  );

  // 4 · Proyección compat — SOLO después de que el log tenga la verdad.
  if (t.presupuestoId) {
    await proyectarCompatPresupuesto(t.presupuestoId, t.respuestaPaciente, ev);
  }

  return { eventosNuevos: nuevos, reentrega: nuevos === 0 && repetidos > 0 };
}

// ─── Proyección compat sobre `presupuestos` ─────────────────────────────────
//
// COPIA CON FECHA DE MUERTE (fase B): las pantallas actuales leen estas
// columnas; hasta que lean del log, esto evita que mientan. Escribe por el
// gate del dominio (recuento de filas, §1).

async function proyectarCompatPresupuesto(
  presupuestoId: string,
  respuestaPaciente: string,
  ev: EvaluacionTurno,
): Promise<void> {
  const { updatePresupuestoRaw } = await import("../presupuestos/repo");
  const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();
  const deriva = ev.decision === "deriva" && ev.causa != null;
  const cola = deriva ? colaDeDerivacion(ev.causa!, ev.malestar ?? null) : null;
  const frase = respuestaPaciente.trim().replace(/\s+/g, " ").slice(0, 120);
  // El borrador solo queda como sugerido cuando el agente sigue o entrega un
  // caso completo; en el resto de derivaciones, vacío — un borrador esperando
  // es una invitación a mandarlo sin pensar (regla del clasificador).
  const sugerible = ev.decision === "sigue" || ev.causa === "caso_completo";
  await updatePresupuestoRaw(presupuestoId, {
    Ultima_respuesta_paciente: respuestaPaciente,
    Fecha_ultima_respuesta: now,
    Requiere_persona: deriva,
    Motivo_quiebre: deriva ? `${ACCION_POR_CAUSA[ev.causa!] ?? ev.causa}: «${frase}»` : null,
    Urgencia_intervencion: deriva ? (cola === "prioritaria" ? "CRÍTICO" : "ALTO") : "BAJO",
    Accion_sugerida: deriva ? (ACCION_POR_CAUSA[ev.causa!] ?? "Revisar") : "Sigue el agente",
    Mensaje_sugerido: sugerible ? ev.respuesta : "",
    Fase_seguimiento: deriva ? "En intervención" : "Esperando respuesta",
  });
}

async function proyectarCompatFallback(presupuestoId: string, respuestaPaciente: string): Promise<void> {
  const { updatePresupuestoRaw } = await import("../presupuestos/repo");
  const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();
  await updatePresupuestoRaw(presupuestoId, {
    Ultima_respuesta_paciente: respuestaPaciente,
    Fecha_ultima_respuesta: now,
    Requiere_persona: true,
    Motivo_quiebre: MOTIVO_FALLBACK_EVALUADOR,
    Urgencia_intervencion: "MEDIO",
    Accion_sugerida: "Revisar manualmente",
    Mensaje_sugerido: "",
    Fase_seguimiento: "En intervención",
  });
}
