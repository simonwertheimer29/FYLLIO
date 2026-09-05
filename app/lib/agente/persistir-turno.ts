// app/lib/agente/persistir-turno.ts
//
// Persistencia del turno del evaluador (fase A, paso 4).
//
// LA LÍNEA: se persiste lo que el modelo JUZGÓ (eventos aplazado/derivado y
// el evento `evaluacion` con los juicios); NADA derivable se guarda — listo,
// cola, en-manos se calculan al leer, siempre. Ver migración 024.
//
// ORDEN (§1): aplazados → derivado → evaluación. Todo idempotente por
// (evento, clave, mensaje_id): un reintento del after() o una reentrega que
// se cuele tras el dedup de KV es un no-op, no un duplicado — y un aplazado
// duplicado derivaría por insistencia un caso que no tocaba.
//
// LA PROYECCIÓN COMPAT sobre `presupuestos` MURIÓ AQUÍ (B4, 21-08 — MEJORAS
// 93 cumplida): las pantallas de la fase B leen del log — la cola de
// Seguimiento deriva cohortes de los eventos, la ficha lee el log, y la
// bandeja marca «necesita persona» también por derivado-sin-resolver del
// log. Las columnas de `presupuestos` (requiere_persona, mensaje_sugerido…)
// quedan como salida EXCLUSIVA del clasificador viejo (MEJORAS 94), que
// muere con B5. El log manda — y ya no tiene copia.

import { registrarEventoIdempotente } from "../automatizacion/pg";
import type { EvaluacionTurno } from "./evaluador";
import type { ClaveAplazado } from "../automatizacion/aplazamientos";

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
  /** Aditivo (17-08) — etiquetas del modelo fuera de vocabulario descartadas
   *  en el borde. CONTABLE como la tasa de descartes del juez: si sube, el
   *  modelo deriva de su vocabulario y se ve en un número, no en consola. */
  etiquetasDescartadas?: string[];
  /** Aditivo (21-08) — de QUÉ presupuesto habla el turno (id resuelto por
   *  código desde la letra del juicio). Mata el proxy del activo. */
  presupuestoReferidoId?: string | null;
  /** Aditivo (31-08) — el COSTE del turno: tokens del evaluador (+ juez,
   *  sumados) y el modelo con el que se tarifa. Antes se devolvía y se tiraba;
   *  el «cuánto costó este mes» del Inicio sale de sumar esto. Los turnos
   *  anteriores no lo tienen: la pantalla dice «desde el día X». */
  usage?: { inputTokens: number; outputTokens: number; cacheEscritura?: number; cacheLectura?: number };
  modelo?: string;
  /** Aditivo (2026-09-05, MEJORAS 136) — idioma del último mensaje. */
  idioma?: string | null;
  /** Aditivo (2026-09-05, MEJORAS 135) — pidió no recibir más mensajes. */
  pideNoContacto?: boolean;
};

export type TurnoAPersistir = {
  /** Clave del hilo (E.164) — es el caso_id de tipo_caso='conversacion'. */
  telefono: string;
  /** waba_message_id del entrante evaluado — la clave de idempotencia. */
  mensajeId: string;
  /** El texto del entrante, para el motivo legible del derivado. */
  respuestaPaciente: string;
  evaluacion: EvaluacionTurno;
};

export async function persistirTurno(t: TurnoAPersistir): Promise<{
  eventosNuevos: number;
  /** true = este mensaje ya estaba persistido (reentrega): no se emitió nada. */
  reentrega: boolean;
}> {
  const ev = t.evaluacion;

  // No-reversión: el caso es de una persona, el turno no produce nada.
  if (!ev.actuar) return { eventosNuevos: 0, reentrega: false };

  // Fallback: NO hubo juicio — sin eventos (un `evaluacion` vacío
  // contaminaría el «trabajado»). El caso queda VISIBLE por construcción:
  // el entrante sin responder es `pendiente_responder` → Necesita respuesta
  // en la cola y contador en la bandeja — ya no hace falta proyectar un
  // quiebre falso para que alguien lo lea (B4; el error queda logueado en
  // evaluar-entrante, §9).
  if (ev.fallback) {
    return { eventosNuevos: 0, reentrega: false };
  }

  let nuevos = 0;
  let repetidos = 0;
  const cuenta = (r: { insertado: boolean }) => (r.insertado ? nuevos++ : repetidos++);

  // 034 — SIN JUICIO (mensaje no legible): se persiste SOLO el derivado. Un
  // `evaluacion` vacío contaminaría «qué recogió» y la ficha seguiría
  // enseñando el último juicio real, que es lo correcto.
  if (ev.sinJuicio) {
    if (ev.decision === "deriva" && ev.causa) {
      cuenta(
        await registrarEventoIdempotente({
          tipoCaso: "conversacion",
          casoId: t.telefono,
          evento: "derivado",
          causaDerivacion: ev.causa,
          malestar: null,
          objetivoActivo: ev.objetivoActivo,
          motivoTexto: ev.motivoDerivacion ?? null,
          actorNombre: "agente",
          mensajeId: t.mensajeId,
        }),
      );
      if (ev.esperaLevantar) {
        cuenta(
          await registrarEventoIdempotente({
            tipoCaso: "conversacion",
            casoId: t.telefono,
            evento: "espera_levantada",
            motivoTexto: "el caso pasa a una persona",
            actorNombre: "agente",
            mensajeId: t.mensajeId,
          }),
        );
      }
    }
    return { eventosNuevos: nuevos, reentrega: nuevos === 0 && repetidos > 0 };
  }

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

  // 2a · Levantamiento de la espera (punto 5): la persona respondió al
  //      motivo, o el turno deriva y manda la persona. VA ANTES de una
  //      posible espera nueva del mismo turno («ya está decidido... os
  //      confirmo el jueves cuál»): levantar la vieja y fijar la nueva.
  if (ev.esperaLevantar) {
    cuenta(
      await registrarEventoIdempotente({
        tipoCaso: "conversacion",
        casoId: t.telefono,
        evento: "espera_levantada",
        motivoTexto: ev.decision === "deriva" ? "el caso pasa a una persona" : "respondió al motivo de la espera",
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
    etiquetasDescartadas: ev.etiquetasDescartadas?.length ? ev.etiquetasDescartadas : undefined,
    presupuestoReferidoId: ev.presupuestoReferidoId ?? null,
    usage: ev.usage,
    modelo: ev.modelo,
    idioma: ev.idioma ?? null,
    pideNoContacto: ev.pideNoContacto === true ? true : undefined,
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

  // (Aquí vivía la proyección compat sobre `presupuestos`. B4, 21-08: murió
  //  con las pantallas ya leyendo del log — ver la cabecera del archivo.)

  return { eventosNuevos: nuevos, reentrega: nuevos === 0 && repetidos > 0 };
}
