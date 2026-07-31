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
// (cola de presupuestos, leads) y componentes (paneles, fichas). `lib/time` es
// puro también — Intl, sin datos ni async_hooks.

import { hoyISO } from "../time";

export type EstadoConversacion =
  | "pendiente_responder"
  | "en_espera_paciente"
  | "reactivable"
  | "sin_conversacion";

/**
 * Umbral de reactivación, en DÍAS DE CALENDARIO DE LA CLÍNICA (ahora constante;
 * por clínica más adelante). 2 días leads / 3 días presupuestos: la asimetría
 * es comercial — un lead se enfría rápido y al segundo día insistir es
 * correcto; un presupuesto es una decisión lenta (familia, financiación) y al
 * segundo día insistir es presión, al tercero es seguimiento. Coherente con el
 * "Recordatorio 3d" del enum de fases.
 *
 * POR QUÉ DÍAS Y NO 48/72 HORAS (2026-07-31). Eran 48 h y 72 h exactas contra
 * `Date.now()`, o sea una ventana RODANTE que se cruza al segundo. Efecto
 * medido en /red: el titular «cuánto hay en juego hoy» subía de 38.215 € a
 * 39.965 € en DOS MINUTOS y un 62 % en 24 h, sin que nadie tocara nada, porque
 * cada caso que cumplía sus 72 h se sumaba al instante. Y como el seed ancla
 * los mensajes al mismo momento de generación, había cruces a 1,2 segundos de
 * distancia: dos F5 seguidos daban dos cifras distintas. El cálculo era
 * correcto; lo que fallaba es que una cifra que se presenta como «tu dinero
 * hoy» y se mueve entre dos recargas destruye la confianza en todas las demás.
 *
 * El negocio de una clínica se mide en días de calendario, no en milisegundos:
 * «hace tres días que le escribimos y no contesta». Anclado al día, la cifra
 * cambia UNA VEZ, a las 00:00 de la clínica, y nunca en mitad de una demo.
 * Misma doctrina que `hoyISO()` (MEJORAS 52).
 *
 * El umbral en MILISEGUNDOS se retiró a propósito y no vuelve: los dos eran
 * `number`, así que un caller sin migrar habría compilado y significado 172
 * millones de días — nada volvería a ser reactivable, en silencio.
 */
export const UMBRAL_REACTIVACION_DIAS = {
  lead: 2,
  presupuesto: 3,
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

/** Días de calendario COMPLETOS entre dos instantes, contados en el día de la
 *  clínica. Escribir a las 23:50 del lunes y mirar a las 00:10 del martes es 1
 *  día, no 20 minutos: es como lo cuenta una persona en una clínica. */
export function diasDeClinicaEntre(desde: Date, hasta: Date): number {
  const a = Date.parse(`${hoyISO(desde)}T00:00:00Z`);
  const b = Date.parse(`${hoyISO(hasta)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function estadoConversacion(
  entrada: EntradaConversacion,
  /** Umbral en DÍAS de la clínica — `UMBRAL_REACTIVACION_DIAS.lead|presupuesto`. */
  umbralDias: number,
  /** El instante de referencia. Se pasa explícito desde las rutas para que el
   *  QA pueda afirmar algo: antes el `ahora` del dashboard era un parámetro
   *  muerto porque esta función llamaba a `Date.now()` por dentro. */
  ahora: Date = new Date(),
): ConversacionClasificada {
  const ahoraMs = ahora.getTime();
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
  // El estado se decide en DÍAS de la clínica (estable, cambia a medianoche);
  // `haceMs` sigue siendo el tiempo real transcurrido, porque es lo que las
  // cards escriben ("sin respuesta hace 4 días") y ahí sí se quiere precisión.
  const haceMs = Math.max(0, ahoraMs - (saliente as number));
  const haceDias = diasDeClinicaEntre(new Date(saliente as number), ahora);
  return {
    estado: haceDias < umbralDias ? "en_espera_paciente" : "reactivable",
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
