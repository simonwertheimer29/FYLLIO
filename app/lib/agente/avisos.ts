// app/lib/agente/avisos.ts
//
// LOS FALLOS DEL AGENTE DEJAN DE MORIR EN CONSOLA (auditoría 2026-09-05,
// punto 5 — MEJORAS 128). Config ilegible, contexto roto, modelo caído: cada
// uno es SISTEMÁTICO (falla el 100 % de los turnos de esa clínica mientras
// dure) y hasta hoy solo producía un `console.error` que nadie lee (§9).
//
// Desde el 6-sep (plan maestro 0.4, MEJORAS 207) el fallo se registra en
// `incidencias` — nuestra base, sin contenido ni teléfono, con la referencia
// del mensaje — y la campana se toca cuando toca: SIEMPRE para lo que es
// decisión (tope de turnos) o roto por definición (config ilegible), y solo
// cuando es SISTEMÁTICO (tres conversaciones distintas en una hora) para lo
// que la cola reintenta sola (modelo, contexto, error inesperado). Una por
// hora, motivo y clínica, como hasta hoy. Y nunca lanza: avisar de un fallo
// no puede producir otro.

import { registrarIncidencia, redactar } from "../incidencias";

export type MotivoFalloAgente =
  | "modelo_no_disponible"
  | "configuracion_ilegible"
  | "contexto_no_disponible"
  | "error_inesperado"
  /** MEJORAS 145 — la conversación superó el tope de turnos en 24 h. */
  | "tope_turnos"
  /** 15-09 — el DECISOR nuevo no contestó y no hay backup por diseño: no sale
   *  ningún mensaje y el caso pasa a una persona. Tiene motivo propio y no
   *  reutiliza `modelo_no_disponible` porque el aviso de aquel manda a
   *  «Mensajería › sin evaluar», y aquí el turno SÍ se evaluó: lo que hay es un
   *  caso esperando en la bandeja. Un aviso que manda a mirar donde no está es
   *  peor que no avisar. */
  | "decisor_sin_respuesta";

const TITULO: Record<MotivoFalloAgente, string> = {
  modelo_no_disponible: "El agente no está evaluando: el modelo no responde",
  configuracion_ilegible: "El agente no está evaluando: la configuración no se puede leer",
  contexto_no_disponible: "El agente no está evaluando: no pudo cargar el caso",
  error_inesperado: "El agente no está evaluando: error inesperado",
  decisor_sin_respuesta: "El agente no pudo contestar: el caso ha pasado a una persona",
  tope_turnos: "El agente ha parado en una conversación: superó el tope de turnos en 24 h",
};

/** ¿Un reintento del MISMO turno puede arreglarlo? El modelo caído no: el
 *  turno ya se persistió como fallback (derivado) y reintentar sería evaluar
 *  dos veces. El tope tampoco: es una decisión, no un fallo. */
const REINTENTABLE: Record<MotivoFalloAgente, boolean> = {
  modelo_no_disponible: false,
  configuracion_ilegible: true,
  contexto_no_disponible: true,
  error_inesperado: true,
  tope_turnos: false,
  // No reintentable desde fuera: el reintento ya lo hizo el propio decisor, y
  // el caso está entregado — repetirlo crearía un segundo turno.
  decisor_sin_respuesta: false,
};

const CAMPANA: Record<MotivoFalloAgente, "siempre" | "sistematico"> = {
  modelo_no_disponible: "sistematico",
  configuracion_ilegible: "siempre",
  contexto_no_disponible: "sistematico",
  error_inesperado: "sistematico",
  tope_turnos: "siempre",
  // SIEMPRE, no «sistemático»: durante el piloto, un solo turno en el que el
  // agente no contesta es exactamente lo que Simon quiere ver, y esperar a
  // que sea sistemático es enterarse por el paciente.
  decisor_sin_respuesta: "siempre",
};

export function falloReintentable(motivo: MotivoFalloAgente): boolean {
  return REINTENTABLE[motivo];
}

export async function avisarFalloAgente(args: {
  motivo: MotivoFalloAgente;
  detalle?: string | null;
  clinicaId?: string | null;
  /** Solo para la consola. No se guarda. */
  telefono?: string | null;
  /** La referencia que SÍ se guarda: el waba_message_id del turno. */
  mensajeId?: string | null;
}): Promise<void> {
  const detalle = args.detalle ? redactar(args.detalle) : "";
  await registrarIncidencia({
    tipo: "agente",
    motivo: args.motivo,
    origen: "agente/evaluar-entrante",
    clinicaId: args.clinicaId ?? null,
    referencia: args.mensajeId ?? null,
    error: args.detalle ?? undefined,
    reintentable: REINTENTABLE[args.motivo],
    avisar: CAMPANA[args.motivo],
    aviso: {
      titulo: TITULO[args.motivo],
      mensaje:
        args.motivo === "decisor_sin_respuesta"
          ? `NO se ha enviado ningún mensaje a la persona y su caso está en la bandeja esperando a alguien.${detalle ? ` Detalle: ${detalle}` : ""}`
          : `Los mensajes entran y se guardan, pero el agente no los evalúa: revísalos en Mensajería (filtro «Sin evaluar»).${detalle ? ` Detalle: ${detalle}` : ""}`,
      link: args.motivo === "decisor_sin_respuesta" ? "/mensajeria" : "/mensajeria?filtro=sin-evaluar",
    },
    soloLog: args.telefono ? `tel=${args.telefono}` : undefined,
  });
}
