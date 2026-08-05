// app/lib/automatizacion/estado.ts
//
// La TERCERA coordenada de un caso: quién lo lleva. Las otras dos ya existen —
// en qué fase está (estado del caso) y quién tiene la pelota (estadoConversacion).
//
// MÓDULO PURO y client-safe: sin datos, sin async, sin luxon. Lo consumen las
// rutas de API, las tarjetas de todas las ventanas y el QA. Mismo contrato que
// `lib/presupuestos/estado-conversacion` y `lib/seguimiento/cohortes`.
//
// ─── Lo que NO se persiste, y por qué ──────────────────────────────────────
//
// No hay columna `estado_automatizacion`. De los seis estados, cuatro se derivan
// de datos que ya existen y el quiebre deriva su condición de `intencion_detectada`.
// Lo único que se guarda es la DECISIÓN HUMANA, en `eventos_automatizacion`
// (append-only). El estado se calcula aquí: derivado + último evento humano.
//
// Una columna tendría que sincronizarse con seis señales que cambian solas —
// llega un mensaje y `estadoConversacion` cambia sin que nadie escriba nada.

import type { EstadoConversacion } from "../presupuestos/estado-conversacion";
import type { IntencionDetectada } from "../presupuestos/types";

export type EstadoAutomatizacion =
  /** El flujo normal. Ver la nota de `residual` abajo. */
  | "esperando"
  /** Algo disparó el corte. El agente no toca nada hasta que actúe una persona. */
  | "quebrado"
  /** Lo cogió alguien. Ve la conversación entera y por qué se paró. */
  | "en_manos_de_alguien"
  /** Se acabó la cadencia sin respuesta: el texto ya no da más de sí. */
  | "agotado"
  /** «Sigo yo con este caso» — manual hasta el cierre. */
  | "manual"
  /** Aceptó, pagó, se perdió, o pasó a la fase siguiente. */
  | "cerrado";

/** Eventos humanos que persiste `eventos_automatizacion`. */
export type EventoAutomatizacion =
  | "quiebre_reconocido"
  | "asumido"
  | "devuelto_al_agente"
  | "asumido_manual"
  | "mensaje_enviado";

export type TipoCaso = "presupuesto" | "lead" | "cobro";

// ─── Los disparadores universales ────────────────────────────────────────────

/**
 * Los seis del documento de arquitectura. Fase 1 solo puede producir TRES:
 * el clasificador que existe responde a «¿acepta el presupuesto?», no a «¿qué
 * necesita esta persona?». Los otros tres van en la fase 2, con los evals
 * montados. Se declaran los seis aquí a propósito: el que lee este tipo tiene
 * que ver los que faltan, no solo los que hay.
 */
export type Disparador =
  | "dinero"
  | "criterio_clinico"
  | "ambiguedad"
  // ── Fase 2: el clasificador todavía no los detecta ──
  | "queja"
  | "pide_persona"
  | "tono_negativo";

/** Los que la fase 1 SÍ puede disparar. Lo usa la UI para declarar el resto. */
export const DISPARADORES_ACTIVOS: readonly Disparador[] = ["dinero", "criterio_clinico", "ambiguedad"];

/** Los que NO se detectan todavía. La UI los nombra en vez de callárselos. */
export const DISPARADORES_PENDIENTES: readonly Disparador[] = ["queja", "pide_persona", "tono_negativo"];

export const ETIQUETA_DISPARADOR: Record<Disparador, string> = {
  dinero: "Dinero",
  criterio_clinico: "Criterio clínico",
  ambiguedad: "Ambigüedad",
  queja: "Queja o problema",
  pide_persona: "Pide hablar con alguien",
  tono_negativo: "Tono negativo",
};

/**
 * Mapeo de la clasificación de intención QUE YA EXISTE al disparador universal.
 * Cero criterio nuevo: no se reinterpreta el mensaje del paciente, se traduce
 * una etiqueta que otro proceso ya puso.
 *
 * Las tres intenciones que NO quiebran son deliberadas:
 *   · «Acepta sin condiciones» → el agente cierra y avisa; no hay nada que decidir.
 *   · «Quiere pensarlo»        → es la cadencia normal, no una excepción.
 *   · «Rechaza»                → es un cierre, y va por su propio camino.
 */
const INTENCION_A_DISPARADOR: Partial<Record<IntencionDetectada, Disparador>> = {
  "Pide oferta/descuento": "dinero",
  "Acepta pero pregunta pago": "dinero",
  "Tiene duda sobre tratamiento": "criterio_clinico",
  "Sin clasificar": "ambiguedad",
};

export function disparadorDeIntencion(intencion: IntencionDetectada | null | undefined): Disparador | null {
  if (!intencion) return null;
  return INTENCION_A_DISPARADOR[intencion] ?? null;
}

// ─── El motivo legible ───────────────────────────────────────────────────────

/**
 * El motivo que lee la coordinadora: «Dinero · "¿me haríais descuento?"».
 *
 * Se compone de lo que ya hay —el disparador traducido y las palabras REALES
 * del paciente— y no se guarda en ninguna columna nueva. Citar la frase literal
 * es el patrón que ya usan las tarjetas de leads: un resumen generado obliga a
 * abrir el caso para saber si el resumen es fiel.
 */
export function motivoLegible(disparador: Disparador, respuestaPaciente?: string | null): string {
  const etiqueta = ETIQUETA_DISPARADOR[disparador];
  const frase = (respuestaPaciente ?? "").trim().replace(/\s+/g, " ");
  if (!frase) return etiqueta;
  const corta = frase.length > 90 ? `${frase.slice(0, 88)}…` : frase;
  return `${etiqueta} · «${corta}»`;
}

// ─── La derivación ───────────────────────────────────────────────────────────

export type EntradaEstado = {
  /** Cerrado por el propio caso (ACEPTADO/PERDIDO, lead convertido o cerrado). */
  cerrado: boolean;
  /** El estado de conversación YA calculado por el caller. No se recalcula aquí. */
  conversacion: EstadoConversacion;
  /**
   * Intención clasificada. **Solo existe en presupuestos**: el webhook guarda los
   * mensajes de leads sin clasificarlos, así que en un lead esto siempre es null
   * y un lead NO puede quebrar por intención en la fase 1. Está declarado en
   * PLAN-AGENTE §fase 1, recorte 4.
   */
  intencion?: IntencionDetectada | null;
  /** Toques salientes acumulados: `contact_count` o `whatsapp_enviados`. */
  toques: number;
  /** Umbral de la clínica (`configuracion_automatizaciones.toques_antes_de_agotar`). */
  toquesAntesDeAgotar: number;
  /** Último evento humano del caso, o null si nunca lo tocó nadie. */
  ultimoEvento?: EventoAutomatizacion | null;
};

export type EstadoDerivado = {
  estado: EstadoAutomatizacion;
  /** El disparador, solo cuando `estado === "quebrado"`. */
  disparador: Disparador | null;
};

/**
 * PRECEDENCIA — de más específico a más general. Cada rama dice por qué va donde va.
 *
 * Nota sobre `esperando`, que es el RESIDUAL: cubre tanto «el agente escribió y
 * espera» como «el paciente escribió y toca el flujo normal». En modo A no hay
 * turno de agente que permita distinguirlos, y separarlos sería reintroducir
 * «trabajando» por la puerta de atrás — el estado que se quitó justamente porque
 * ningún dato puede producirlo hoy. Qué toca hacer ya lo dice la cohorte; este
 * eje responde a quién lo lleva.
 */
export function estadoAutomatizacion(e: EntradaEstado): EstadoDerivado {
  const sin = (estado: EstadoAutomatizacion): EstadoDerivado => ({ estado, disparador: null });

  // 1 · Cerrado gana a todo: un caso terminado no lo lleva nadie.
  if (e.cerrado) return sin("cerrado");

  // 2 · Decisiones humanas explícitas. Ganan a cualquier derivación porque son
  //     lo único que una persona declaró a propósito: si alguien dijo «sigo yo»,
  //     el sistema no puede contradecirle porque el contador diga otra cosa.
  if (e.ultimoEvento === "asumido_manual") return sin("manual");
  if (e.ultimoEvento === "asumido" || e.ultimoEvento === "quiebre_reconocido") {
    return sin("en_manos_de_alguien");
  }
  // `devuelto_al_agente` y `mensaje_enviado` NO fijan estado: devuelven el caso
  // a la derivación, que es justo lo que significan. Por eso la reanudación
  // «donde estaba» no necesita guardar posición: el siguiente toque es
  // `toques + 1` y sale del contador que ya existe.

  // 3 · Quiebre. Solo si el paciente ha escrito lo último (si contestamos
  //     después, el quiebre ya se atendió aunque nadie lo registrara) y la
  //     intención mapea a un disparador.
  if (e.conversacion === "pendiente_responder") {
    const disparador = disparadorDeIntencion(e.intencion);
    if (disparador) return { estado: "quebrado", disparador };
  }

  // 4 · Agotado. El contador SOLO no basta: un caso con cinco toques que acaba
  //     de responder no está agotado, está esperando respuesta nuestra. Por eso
  //     exige `reactivable` — le escribimos, no contestó, y pasó el umbral.
  if (e.conversacion === "reactivable" && e.toques >= e.toquesAntesDeAgotar) {
    return sin("agotado");
  }

  // 5 · Residual.
  return sin("esperando");
}

// ─── Presentación ────────────────────────────────────────────────────────────

export const ETIQUETA_ESTADO: Record<EstadoAutomatizacion, string> = {
  esperando: "En curso",
  quebrado: "Necesita persona",
  en_manos_de_alguien: "Lo lleva una persona",
  agotado: "Toca llamar",
  manual: "Manual",
  cerrado: "Cerrado",
};

/**
 * Qué hacer, en la voz de la coordinadora. La etiqueta dice el estado; esto dice
 * la consecuencia — que es lo que se lee en una cola a las nueve de la mañana.
 */
export const ACCION_ESTADO: Record<EstadoAutomatizacion, string> = {
  esperando: "Sigue el curso normal",
  quebrado: "Léelo antes de responder",
  en_manos_de_alguien: "Ya lo está atendiendo alguien",
  agotado: "El texto se agotó: llama por teléfono",
  manual: "Fuera de automatización por decisión propia",
  cerrado: "Sin acción",
};

/** Orden de la cola: lo que más exige criterio, arriba. */
export const PRIORIDAD_ESTADO: Record<EstadoAutomatizacion, number> = {
  quebrado: 0,
  agotado: 1,
  en_manos_de_alguien: 2,
  esperando: 3,
  manual: 4,
  cerrado: 5,
};
