// app/lib/agente/sesion-prueba.ts
//
// LA SESIÓN DEL BANCO DE PRUEBAS — lo que producción PERSISTE entre turnos y
// vuelve a leer en el siguiente (11-09, la cuarta divergencia de MEJORAS 225,
// y la más grave).
//
// Producción escribe tras cada turno (persistir-turno: los `aplazado` del
// log, la espera fijada o levantada, el derivado; evaluar-entrante: el
// opt-out) y lo lee TODO antes del siguiente (evaluar-entrante §3 y el
// semáforo). El banco no escribe nada —regla dura— y hasta hoy pasaba esas
// piezas VACÍAS en cada turno: el agente del banco no veía los aplazados de
// turnos anteriores, la insistencia no contaba nunca, una espera pactada no
// existía al mensaje siguiente y un opt-out se olvidaba. Todo lo probado en
// el banco sobre insistencia no probaba nada.
//
// Aquí vive el estado que SUSTITUYE a esa escritura: el servidor lo devuelve
// tras cada turno, el cliente lo devuelve tal cual con el siguiente (es
// opaco para la pantalla, como el hilo), y `avanzarSesion` lo hace avanzar
// con LA MISMA regla que persistir-turno — una emisión por clave y turno,
// espera nueva tras levantar la vieja, el derivado no se revierte. Lo que
// no puede pasar en el banco (una persona resolviendo un aplazado) no pasa;
// lo que sí puede (el replay de una conversación real) llega con su log.
//
// MÓDULO PURO y client-safe: lo importan la vista, la ruta, el banco y
// `qa:banco-vs-runner`, que reconstruye la sesión desde el log del fixture
// de hilos jugados y exige que la entrada salga igual que la de producción.

import { CLAVES_APLAZADO, type ClaveAplazado, type EventoAplazamiento } from "../automatizacion/aplazamientos";

export type EstadoSesionPrueba = {
  /** El log de aplazamientos que producción tendría: uno por clave y turno
   *  (persistir-turno §1). Alimenta pendientes y vueltas por el MISMO camino
   *  que el orquestador (entrada-desde-contexto). */
  aplazamientos: EventoAplazamiento[];
  /** La última espera fijada y no levantada (026). Si a «hoy» ya venció, el
   *  constructor no la pasa — semaforo.ts:156, fecha inclusive. */
  espera: { hasta: string; motivo: string | null } | null;
  /** Pidió no recibir mensajes en un turno anterior (MEJORAS 135). */
  optOut: boolean;
  /** Un turno anterior entregó el caso: la no-reversión se enseña, no se
   *  esquiva (antes viajaba como `derivadoPrevio`). */
  derivado: boolean;
};

export const SESION_NUEVA: EstadoSesionPrueba = { aplazamientos: [], espera: null, optOut: false, derivado: false };

/** Lo que `avanzarSesion` necesita de un turno: el subconjunto de
 *  `EvaluacionTurno` que persistir-turno escribe. Estructural a propósito —
 *  el QA lo reconstruye desde el log del fixture sin fabricar una evaluación
 *  entera. */
export type TurnoParaSesion = {
  /** No hubo juicio: producción no persiste nada (persistir-turno). */
  fallback?: boolean;
  /** Entrante no legible: solo se persiste el derivado. */
  sinJuicio?: boolean;
  decision: "sigue" | "deriva";
  causa?: string | null;
  aplazamientos: readonly { clave: ClaveAplazado; motivo: string }[];
  esperaHasta: string | null;
  esperaLevantar: boolean;
  pideNoContacto?: boolean;
};

/**
 * La sesión tras un turno — la MISMA regla que `persistirTurno`, sin base:
 *   1 · aplazados: una emisión por clave dentro del turno, con el instante
 *       del turno (producción: `created_at` del evento, segundos después
 *       del entrante — a efectos de pendientes y vueltas, el mismo instante).
 *   2 · derivado: si deriva con causa, y no se revierte.
 *   2a· levantar la espera vieja ANTES de fijar la nueva (mismo orden).
 *   2b· la espera nueva guarda como motivo la frase del entrante, como el
 *       evento `espera_fijada`.
 *   3 · opt-out: si lo pidió, queda (marcarOptOut).
 */
export function avanzarSesion(
  prev: EstadoSesionPrueba,
  ev: TurnoParaSesion,
  turno: { instante: string; entrante: string },
): EstadoSesionPrueba {
  if (ev.fallback) return prev;
  const deriva = ev.decision === "deriva" && ev.causa != null;
  if (ev.sinJuicio) {
    return { ...prev, derivado: prev.derivado || deriva, espera: deriva && ev.esperaLevantar ? null : prev.espera };
  }
  const porClave = new Map<ClaveAplazado, string>();
  for (const a of ev.aplazamientos) if (!porClave.has(a.clave)) porClave.set(a.clave, a.motivo);
  const aplazamientos: EventoAplazamiento[] = [
    ...prev.aplazamientos,
    ...[...porClave].map(([clave, motivo]) => ({ evento: "aplazado" as const, clave, motivoTexto: motivo, createdAt: turno.instante })),
  ];
  let espera = ev.esperaLevantar ? null : prev.espera;
  if (ev.esperaHasta) {
    const frase = turno.entrante.trim().replace(/\s+/g, " ").slice(0, 120);
    espera = { hasta: ev.esperaHasta, motivo: frase ? `«${frase}»` : null };
  }
  return {
    aplazamientos,
    espera,
    optOut: prev.optOut || ev.pideNoContacto === true,
    derivado: prev.derivado || deriva,
  };
}

const TOPE_APLAZAMIENTOS = 200;

/**
 * La sesión que manda el cliente, validada. Viene de una pantalla de ensayo
 * y no toca datos reales, pero entra en la entrada del modelo: forma
 * estricta o nada. `undefined`/`null` = conversación nueva; cualquier otra
 * cosa mal formada = null (la ruta responde 400, nunca «lo intento igual»).
 */
export function leerSesionPrueba(raw: unknown): EstadoSesionPrueba | null {
  if (raw == null) return SESION_NUEVA;
  if (typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.aplazamientos) || r.aplazamientos.length > TOPE_APLAZAMIENTOS) return null;
  const aplazamientos: EventoAplazamiento[] = [];
  for (const e of r.aplazamientos as unknown[]) {
    if (!e || typeof e !== "object") return null;
    const x = e as Record<string, unknown>;
    if (x.evento !== "aplazado" && x.evento !== "aplazado_resuelto") return null;
    if (typeof x.clave !== "string" || !(CLAVES_APLAZADO as readonly string[]).includes(x.clave)) return null;
    if (x.motivoTexto != null && typeof x.motivoTexto !== "string") return null;
    if (typeof x.createdAt !== "string" || !Number.isFinite(Date.parse(x.createdAt))) return null;
    aplazamientos.push({
      evento: x.evento,
      clave: x.clave as ClaveAplazado,
      motivoTexto: x.motivoTexto == null ? null : x.motivoTexto.slice(0, 300),
      createdAt: x.createdAt,
    });
  }
  let espera: EstadoSesionPrueba["espera"] = null;
  if (r.espera != null) {
    if (typeof r.espera !== "object") return null;
    const e = r.espera as Record<string, unknown>;
    if (typeof e.hasta !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.hasta)) return null;
    if (e.motivo != null && typeof e.motivo !== "string") return null;
    espera = { hasta: e.hasta, motivo: e.motivo == null ? null : e.motivo.slice(0, 200) };
  }
  if (typeof r.optOut !== "boolean" || typeof r.derivado !== "boolean") return null;
  return { aplazamientos, espera, optOut: r.optOut, derivado: r.derivado };
}
