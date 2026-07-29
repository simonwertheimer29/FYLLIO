// UNA sola clasificación de conversaciones (decisión 2026-07-23).
//
// Antes había tres criterios distintos para "quién tiene la pelota": la cola
// de presupuestos comparaba dos timestamps persistidos, la lista de leads
// comparaba acciones_lead, y solo paneles/fichas miraban el hilo real. El
// mismo caso salía "esperando" en la cola y "respóndele" en su ficha.
//
// Modelo (derivado, nunca almacenado):
//   pendiente_responder — el último toque es DEL PACIENTE → hay que contestar.
//   en_espera_paciente  — el último toque es NUESTRO y hace < umbral → no se
//                         muestra como pendiente, no se insiste.
//   reactivable         — el último toque es nuestro, sin respuesta, y hace
//                         ≥ umbral → entra en la cola de reactivación.
//   sin_conversacion    — ni mensajes ni acciones registradas.
//
// Fuente primaria: el HILO (mensajes_whatsapp; todo camino de escritura deja
// fila desde el prerequisito 5417982). Complemento: la última ACCIÓN saliente
// registrada (llamada, apertura de chat sin texto) — sin ella, la función
// regañaría a la coordinadora justo después de llamar al paciente.
// Empate exacto de timestamps → gana el paciente (pendiente_responder): mejor
// contestar de más que dejar a alguien colgado.
//
// Módulo PURO y client-safe (sin datos, sin luxon): lo consumen rutas de API
// (cola de presupuestos, leads) y componentes (paneles, fichas).

export type EstadoConversacion =
  | "pendiente_responder"
  | "en_espera_paciente"
  | "reactivable"
  | "sin_conversacion";

/**
 * Umbral de reactivación (ahora constante; por clínica más adelante).
 * 48 h leads / 72 h presupuestos: son los valores que el producto ya usaba
 * (comparable antes/después) y la asimetría es comercial — un lead se enfría
 * en horas y a las 48 h insistir es correcto; un presupuesto es una decisión
 * lenta (familia, financiación) y a las 48 h insistir es presión, a las 72 h
 * es seguimiento. Coherente con el "Recordatorio 3d" del enum de fases.
 */
export const UMBRAL_REACTIVACION_MS = {
  lead: 48 * 60 * 60 * 1000,
  presupuesto: 72 * 60 * 60 * 1000,
} as const;

export type EntradaConversacion = {
  /** Último mensaje ENTRANTE del hilo (ISO). */
  ultimoEntranteAt?: string | null;
  /** Último mensaje SALIENTE del hilo (ISO). */
  ultimoSalienteAt?: string | null;
  /** Última acción saliente registrada sin texto: llamada, apertura de chat (ISO). */
  ultimaAccionSalienteAt?: string | null;
};

export type ConversacionClasificada = {
  estado: EstadoConversacion;
  /** Último toque nuestro (hilo o acción), ISO — null si nunca. */
  ultimoToqueClinicaAt: string | null;
  /** Milisegundos desde el toque que decide el estado (null en sin_conversacion). */
  haceMs: number | null;
};

function ms(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function estadoConversacion(
  entrada: EntradaConversacion,
  umbralMs: number,
  ahoraMs: number = Date.now(),
): ConversacionClasificada {
  const entrante = ms(entrada.ultimoEntranteAt);
  const salienteHilo = ms(entrada.ultimoSalienteAt);
  const accion = ms(entrada.ultimaAccionSalienteAt);
  const saliente =
    salienteHilo === null ? accion : accion === null ? salienteHilo : Math.max(salienteHilo, accion);
  const salienteIso =
    saliente === null
      ? null
      : saliente === salienteHilo
        ? (entrada.ultimoSalienteAt ?? null)
        : (entrada.ultimaAccionSalienteAt ?? null);

  if (entrante === null && saliente === null) {
    return { estado: "sin_conversacion", ultimoToqueClinicaAt: null, haceMs: null };
  }
  // Empate → gana el paciente.
  if (entrante !== null && (saliente === null || entrante >= saliente)) {
    return {
      estado: "pendiente_responder",
      ultimoToqueClinicaAt: salienteIso,
      haceMs: Math.max(0, ahoraMs - entrante),
    };
  }
  const haceMs = Math.max(0, ahoraMs - (saliente as number));
  return {
    estado: haceMs < umbralMs ? "en_espera_paciente" : "reactivable",
    ultimoToqueClinicaAt: salienteIso,
    haceMs,
  };
}

/** Deriva la entrada desde un hilo ya cargado (paneles y fichas). */
export function entradaDesdeMensajes(
  mensajes: ReadonlyArray<{ direccion: string; timestamp?: string | null }>,
  ultimaAccionSalienteAt?: string | null,
): EntradaConversacion {
  let ultimoEntranteAt: string | null = null;
  let ultimoSalienteAt: string | null = null;
  for (const m of mensajes) {
    const t = m.timestamp ?? null;
    if (!t) continue;
    if (m.direccion === "Entrante") {
      if (!ultimoEntranteAt || t > ultimoEntranteAt) ultimoEntranteAt = t;
    } else {
      if (!ultimoSalienteAt || t > ultimoSalienteAt) ultimoSalienteAt = t;
    }
  }
  return { ultimoEntranteAt, ultimoSalienteAt, ultimaAccionSalienteAt };
}

/** "hace 2 h" / "hace 3 días" — para las cards y el formato XYZ. */
export function haceTexto(haceMs: number): string {
  const h = Math.floor(haceMs / 3_600_000);
  if (h < 1) return "hace menos de 1 hora";
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}
