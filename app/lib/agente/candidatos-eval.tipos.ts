// app/lib/agente/candidatos-eval.tipos.ts
//
// MÓDULO PURO (§22/§24): lo que el panel «por qué» (Client Component) y el
// servidor comparten sobre el botón «el agente se equivocó aquí» (2.7,
// MEJORAS 182). Sin db, sin Node. El módulo de servidor lo reexporta.

/** Qué falló, en código cerrado. El texto libre va aparte (`correccion`). */
export const FALLOS_CANDIDATO = ["decision", "entendio_mal", "borrador", "recogida", "otro"] as const;
export type FalloCandidato = (typeof FALLOS_CANDIDATO)[number];

export type DecisionAgente = "siguio" | "entrego";
export type EstadoCandidato = "pendiente" | "aceptado" | "descartado";

/** Con estos dos, sin el texto de la persona no hay nada que aprender. */
export const FALLOS_CON_TEXTO_OBLIGATORIO: ReadonlySet<FalloCandidato> = new Set<FalloCandidato>(["borrador", "otro"]);
export const TOPE_CORRECCION = 2000;

export function esFalloCandidato(v: unknown): v is FalloCandidato {
  return typeof v === "string" && (FALLOS_CANDIDATO as readonly string[]).includes(v);
}

/** La etiqueta en palabras de coordinadora. La de la decisión va en la
 *  dirección CONTRARIA a lo que hizo el agente (el bucle afina el quiebre
 *  en las dos direcciones, PLAN-AGENTE fase 4). */
export function etiquetaFallo(fallo: FalloCandidato, decision: DecisionAgente): string {
  switch (fallo) {
    case "decision":
      return decision === "entrego" ? "No hacía falta pasarlo a una persona: podía seguir él" : "Debería haberlo pasado a una persona";
    case "entendio_mal":
      return "Entendió mal lo que quería el paciente";
    case "borrador":
      return "El mensaje que propuso no está bien";
    case "recogida":
      return "Apuntó mal un dato";
    case "otro":
      return "Otra cosa";
  }
}

export const ETIQUETA_ESTADO_CANDIDATO: Record<EstadoCandidato, string> = {
  pendiente: "Pendiente de revisar",
  aceptado: "Revisado: se usará para mejorar el agente",
  descartado: "Revisado: no cambia nada",
};

/** Devuelve el motivo por el que la corrección no vale, o null si vale.
 *  La misma regla en el formulario y en la ruta. */
export function motivoCorreccionInvalida(fallo: unknown, correccion: unknown): string | null {
  if (!esFalloCandidato(fallo)) return "Elige qué falló.";
  const texto = typeof correccion === "string" ? correccion.trim() : "";
  if (texto.length > TOPE_CORRECCION) return `La corrección no puede pasar de ${TOPE_CORRECCION} caracteres.`;
  if (FALLOS_CON_TEXTO_OBLIGATORIO.has(fallo) && !texto) return "Cuéntanos qué debería haber hecho o dicho.";
  return null;
}

/** Lo que el panel enseña de un turno ya marcado. */
export type CandidatoMarcado = {
  id: string;
  fallo: FalloCandidato;
  correccion: string | null;
  porNombre: string | null;
  /** ISO. */
  en: string;
  estado: EstadoCandidato;
};
