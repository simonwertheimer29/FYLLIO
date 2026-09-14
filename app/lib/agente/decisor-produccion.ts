// app/lib/agente/decisor-produccion.ts
//
// EL AGENTE NUEVO EN PRODUCCIÓN, CON INTERRUPTOR (2026-09-15, encargo de Simon).
//
// Hasta hoy el mensaje que sale lo escribía `evaluarTurno` —el modelo con los
// objetivos y la lista de campos delante— y la decisión de pasar el caso la
// tomaba el código contando sobre sus juicios. El decisor «alcance», medido
// desde el 13-09 sobre los guiones, escribe él el mensaje y elige él el acto:
// ve los mismos HECHOS y, en vez de la lista de campos, su ALCANCE y su
// objetivo dichos como papel.
//
// QUÉ HACE ESTA PIEZA, y es deliberadamente poco: sustituye la RESPUESTA y,
// cuando toca, la DECISIÓN de una evaluación que ya está hecha. Todo lo de
// abajo —persistir, avisar, encolar, notificar— sigue leyendo los mismos
// campos y no se entera. Meter el decisor más adentro habría obligado a tocar
// el orquestador entero para poder apagarlo.
//
// LO QUE NO TOCA, NUNCA:
//  · Las ENTREGAS OBLIGATORIAS POR HECHO. Si el código ya decidió derivar por
//    urgencia, queja, antecedente con cita, mensaje no legible o callejón, eso
//    manda: el acto del decisor no puede devolver a «sigue» un caso que el
//    sistema garantiza que ve una persona.
//  · El fallback. Si el evaluador no respondió, el turno ya está derivado y
//    aquí no se entra.
//  · El opt-out y la espera, que los resuelve el código antes.
//
// FAIL-CLOSED: si el decisor no contesta (sin clave, 4xx, timeout, JSON
// ilegible) se devuelve la evaluación TAL CUAL y sale el mensaje de siempre.
// Un agente nuevo que no contesta no puede dejar a nadie sin respuesta.
//
// EL INTERRUPTOR es por CLIENTE y está apagado por defecto:
//   AGENTE_DECISOR_ALCANCE=DEMO      → solo la demo
//   AGENTE_DECISOR_ALCANCE=          → nadie (lo de hoy)
// Se lee en cada turno a propósito: encender o apagar no debe pedir un deploy.

import { controlarMensajeDelDecisor } from "./control-decisor";
import { renderDatosQueConstan, type EntradaEvaluador, type EvaluacionTurno } from "./evaluador";
import { pedirSombra } from "./sombra";
import { estadoDelContrato } from "../automatizacion/objetivos";
import { canonizarActo, type Acto } from "./actos";
import { colaDeDerivacion } from "../automatizacion/estado";

/** Actos que PASAN EL CASO a una persona. Los demás siguen la conversación. */
const ACTOS_QUE_ENTREGAN: readonly Acto[] = ["cerrar", "atender", "parar"];

export function decisorAlcanceActivo(cliente: string): boolean {
  const lista = (process.env["AGENTE_DECISOR_ALCANCE"] ?? "")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  return lista.includes(cliente.toUpperCase());
}

export type ResultadoDecisor = {
  evaluacion: EvaluacionTurno;
  /** Qué escribió el turno, para la traza y para que las métricas de mañana
   *  no mezclen dos agentes. */
  escritoPor: "codigo" | "alcance";
  /** Por qué NO lo escribió el nuevo, cuando estaba encendido. */
  motivoFallback?: string;
};

export async function aplicarDecisorAlcance(args: {
  cliente: string;
  entrada: EntradaEvaluador;
  evaluacion: EvaluacionTurno;
  /** Primer nombre con el que se le habla (para la plantilla de reemplazo). */
  nombre: string;
}): Promise<ResultadoDecisor> {
  const { entrada, evaluacion } = args;
  const tal_cual = (motivo?: string): ResultadoDecisor => ({ evaluacion, escritoPor: "codigo", ...(motivo ? { motivoFallback: motivo } : {}) });
  if (!decisorAlcanceActivo(args.cliente)) return tal_cual();
  // Un turno que el código resolvió sin modelo (no legible, fallback, opt-out)
  // no tiene conversación que escribir: no se le pide nada al decisor.
  if (!evaluacion.actuar || evaluacion.fallback || entrada.ultimoNoLegible) return tal_cual("turno resuelto sin modelo");

  const defObjetivo = evaluacion.objetivoActivo
    ? entrada.objetivosAbiertos.find((o) => o.etapa === evaluacion.objetivoActivo) ?? null
    : null;
  const contrato = defObjetivo
    ? estadoDelContrato(defObjetivo.etapa, defObjetivo.campos, evaluacion.camposRecogidos?.[defObjetivo.etapa], {
        esPacienteConocido: entrada.esPacienteConocido,
        hablaPorOtraPersona: evaluacion.juicios?.hablaPor != null,
      })
    : null;

  const s = await pedirSombra(entrada, {
    variante: "alcance",
    objetivo: defObjetivo
      ? { etapa: defObjetivo.etapa, proposito: defObjetivo.proposito, sabido: contrato?.sabido, falta: contrato?.falta }
      : null,
  });
  if (!s || !s.mensaje?.trim()) return tal_cual("el decisor no respondió");

  // EL MISMO CONTROL QUE YA CORRE, sobre el mensaje del decisor: veto → juez →
  // una reescritura → poda → descarte. No es una segunda revisión: es que el
  // mensaje ahora lo escribe otro, y el control va con el mensaje.
  const controlado = await controlarMensajeDelDecisor({
    mensaje: s.mensaje,
    nombre: args.nombre,
    nombrePersona: [entrada.nombre, entrada.nombrePerfil].filter(Boolean).join(" "),
    datosQueConstan: renderDatosQueConstan(entrada),
    ultimoMensaje: [...entrada.hilo].reverse().find((m) => m.direccion === "Entrante")?.contenido,
    dichoPorLaPersona: entrada.hilo.filter((m) => m.direccion === "Entrante").map((m) => m.contenido).join(" · ").slice(-1500),
    citaConsta: entrada.diasHastaProximaCita != null,
    descartesSeguidosAntes: entrada.descartesSeguidosAntes ?? 0,
  });
  if (!controlado.texto.trim()) return tal_cual("el control dejó el mensaje vacío");

  const acto = canonizarActo(s.acto);
  const entregaElDecisor = acto != null && ACTOS_QUE_ENTREGAN.includes(acto);
  // La entrega por HECHO manda siempre: lo que el código decidió derivar sigue
  // derivado, con su causa y su cola. El decisor solo puede AÑADIR entrega.
  const deriva = evaluacion.decision === "deriva" || entregaElDecisor || controlado.pasaAPersona;
  const causa = evaluacion.decision === "deriva" ? evaluacion.causa : deriva ? "caso_completo" : undefined;

  return {
    escritoPor: "alcance",
    evaluacion: {
      ...evaluacion,
      respuesta: controlado.texto,
      decision: deriva ? "deriva" : "sigue",
      ...(causa ? { causa, cola: evaluacion.cola ?? colaDeDerivacion(causa, null) } : {}),
    },
  };
}
