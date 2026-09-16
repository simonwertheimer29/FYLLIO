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
// SI EL DECISOR NO CONTESTA, NO SALE NADA Y EL CASO PASA A UNA PERSONA
// (15-09, corrección de Simon). La primera versión caía al mensaje del agente
// VIEJO, y eso es tener dos agentes conviviendo con un backup que además está
// en retirada: el paciente recibiría, sin que nadie lo sepa, una respuesta
// escrita por el camino que estamos apagando. En un piloto lo correcto es lo
// contrario — **si el agente falla, que se vea**—, así que:
//   · no sale ningún mensaje (`respuesta: ""`, la misma convención que usa el
//     turno no legible),
//   · el caso se DERIVA con causa `sin_respuesta_valida` y un motivo en
//     castellano para que la coordinadora sepa qué pasó al abrirlo,
//   · y se levanta una INCIDENCIA visible (`avisarFalloAgente`), no una línea
//     de log: llevamos una semana cazando cosas que fallaban en silencio y
//     esta no puede ser una más.
// Antes de rendirse se REINTENTA una vez a los 2 s (el mismo reintento que el
// runner de guiones lleva desde el 14-09): sin backup detrás, el reintento
// barato deja de ser un lujo.
//
// EL INTERRUPTOR es por CLIENTE y está apagado por defecto:
//   AGENTE_DECISOR_ALCANCE=DEMO      → solo la demo
//   AGENTE_DECISOR_ALCANCE=          → nadie (lo de hoy)
// Se lee en cada turno a propósito: encender o apagar no debe pedir un deploy.

import { controlarMensajeDelDecisor } from "./control-decisor";
import { renderDatosQueConstan, type ControlSalida, type EntradaEvaluador, type EvaluacionTurno } from "./evaluador";
import { pedirSombra } from "./sombra";
import { estadoDelContrato } from "../automatizacion/objetivos";
import { canonizarActo, type Acto } from "./actos";
import { colaDeDerivacion } from "../automatizacion/estado";
import { avisarFalloAgente } from "./avisos";

/** SIN MENSAJE Y A UNA PERSONA, con el porqué a la vista. Es la única salida
 *  cuando el agente nuevo no puede contestar: ni se envía nada ni contesta
 *  otro por detrás. La incidencia se levanta aquí y no en el caller para que
 *  no dependa de que el caller se acuerde. */
async function aPersona(
  args: { entrada: EntradaEvaluador; evaluacion: EvaluacionTurno; mensajeId?: string | null; clinicaId?: string | null; telefono?: string | null },
  motivo: string,
): Promise<ResultadoDecisor> {
  await avisarFalloAgente({
    motivo: "decisor_sin_respuesta",
    detalle: `decisor «alcance»: ${motivo}`,
    clinicaId: args.clinicaId ?? null,
    telefono: args.telefono ?? null,
    mensajeId: args.mensajeId ?? null,
  });
  return {
    escritoPor: "alcance",
    motivoFallback: motivo,
    evaluacion: {
      ...args.evaluacion,
      respuesta: "",
      decision: "deriva",
      causa: "sin_respuesta_valida",
      cola: "normal",
      motivoDerivacion: `El agente no pudo contestar: ${motivo}. No se ha enviado ningún mensaje.`,
    },
  };
}

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
  /** Para que la incidencia se pueda seguir hasta el turno exacto. */
  mensajeId?: string | null;
  clinicaId?: string | null;
  telefono?: string | null;
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

  const fallo: { razon: string | null } = { razon: null };
  const opts = {
    fallo,
    variante: "alcance" as const,
    objetivo: defObjetivo
      ? { etapa: defObjetivo.etapa, proposito: defObjetivo.proposito, sabido: contrato?.sabido, falta: contrato?.falta }
      : null,
  };
  let s = await pedirSombra(entrada, opts);
  if (!s || !s.mensaje?.trim()) {
    // UN reintento, no tres: si la API está caída, insistir solo retrasa la
    // entrega del caso a la persona, que es lo que de verdad ayuda ahora.
    await new Promise((r) => setTimeout(r, 2000));
    s = await pedirSombra(entrada, opts);
  }
  if (!s || !s.mensaje?.trim())
    return await aPersona(args, fallo.razon ?? "el modelo no contestó y no dijo por qué (tras un reintento)");

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
  if (!controlado.texto.trim()) return await aPersona(args, "el agente escribió algo que la revisión de seguridad no dejó salir");

  const acto = canonizarActo(s.acto);
  const entregaElDecisor = acto != null && ACTOS_QUE_ENTREGAN.includes(acto);
  // La entrega por HECHO manda siempre: lo que el código decidió derivar sigue
  // derivado, con su causa y su cola. El decisor solo puede AÑADIR entrega.
  const deriva = evaluacion.decision === "deriva" || entregaElDecisor || controlado.pasaAPersona;
  const causa = evaluacion.decision === "deriva" ? evaluacion.causa : deriva ? "caso_completo" : undefined;

  // CORTE 1 del coste (16-09): EL NÚMERO QUE ENSEÑA EL PRODUCTO TIENE QUE
  // SUMAR TODAS LAS LLAMADAS. Hasta hoy el turno guardaba solo el `usage` del
  // evaluador y su control: decía $0,015 cuando el turno costaba $0,036, y de
  // ese número sale toda la cuenta de costes por clínica. Aquí se le añade lo
  // que cuestan el decisor y el control de SU mensaje, que es lo que faltaba.
  const sumar = (a: EvaluacionTurno["usage"], b: EvaluacionTurno["usage"]): EvaluacionTurno["usage"] => {
    if (!a) return b;
    if (!b) return a;
    return {
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      cacheEscritura: (a.cacheEscritura ?? 0) + (b.cacheEscritura ?? 0),
      cacheLectura: (a.cacheLectura ?? 0) + (b.cacheLectura ?? 0),
    };
  };
  // MEJORAS 255 (16-09): EL RASTRO DEL MENSAJE QUE SALE. Hasta hoy se tiraban
  // `borrador`, `control` y `nota` y en producción no había forma de saber qué
  // cambió el juez ni por qué — y es la condición de Simon para decidir su
  // futuro con datos. Va al payload de la evaluación, aditivo, cero llamadas.
  const controlSalida: ControlSalida = controlado.control && controlado.control.estado !== "pasa"
    ? {
        tocado: true,
        borrador: controlado.borrador,
        estado: controlado.control.estado,
        motivo: controlado.control.motivo ?? null,
        frase: controlado.control.frase ?? null,
        fuente: controlado.control.fuente ?? null,
        reescrito: controlado.control.reescrito,
        nota: controlado.nota,
      }
    : { tocado: false };
  return {
    escritoPor: "alcance",
    evaluacion: {
      ...evaluacion,
      usage: sumar(sumar(evaluacion.usage, s.usage), controlado.usage),
      respuesta: controlado.texto,
      controlSalida,
      decision: deriva ? "deriva" : "sigue",
      ...(causa ? { causa, cola: evaluacion.cola ?? colaDeDerivacion(causa, null) } : {}),
    },
  };
}
