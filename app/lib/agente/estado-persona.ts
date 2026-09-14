// app/lib/agente/estado-persona.ts
//
// LA REGLA DEL ESTADO DE LA PERSONA (11-09, hallazgos de Simon en los hilos
// simulados). Cuatro fallos con una sola raíz: el agente perseguía el
// objetivo a ciegas del estado de quien escribe — le pedía «¿qué días te
// vienen bien?» a quien ya dijo que no quiere cita (Nuria), la ficha decía
// «Quiere cita» de quien se queja de un cobro (Pablo), y la coletilla del
// pago se colaba en la respuesta a una queja (Rosa).
//
// Módulo PURO (sin base, sin modelo): lo llaman el evaluador (para decidir
// el turno) y la ficha (para contar qué quiere). Una regla, un sitio —
// antes la ficha copiaba «la misma regla que el evaluador» a mano
// (mandamiento 25: una construcción, un sitio).
//
// La regla, en tres frases:
//   1. Si la persona está en URGENCIA, QUEJA o PETICIÓN DE PERSONA, este
//      turno no se persigue ningún objetivo: ni campos, ni cobro. Se atiende
//      lo que trae y se entrega.
//   2. Una cita DECLINADA (motivo_no_cita con valor) cierra el objetivo:
//      deja de ser elegible y no se le vuelve a pedir día ni franja. CERRAR
//      NO ES BORRAR (13-09): si no queda nada más que perseguir, el caso se
//      ENTREGA con su motivo — ver `citaDeclinadaCubre`.
//   3. «Qué quiere» sale del ESTADO o del TEMA cuando no hay objetivo que
//      case — nunca del objetivo de relleno.

import { OBJETIVOS_POR_DEFECTO, type EtapaObjetivo } from "../automatizacion/objetivos";

export type EstadoPersona = "urgencia" | "queja" | "peticion" | null;

/** Los tres juicios del modelo que definen el estado; código decide. */
export function estadoDeLaPersona(j: {
  urgenciaMedica: boolean;
  peticionOQueja: boolean;
  malestar: boolean;
}): EstadoPersona {
  if (j.urgenciaMedica) return "urgencia";
  if (j.peticionOQueja) return j.malestar ? "queja" : "peticion";
  return null;
}

export type CamposPorEtapa = Partial<Record<string, Record<string, string | null> | undefined>>;

const conValor = (v: string | null | undefined): v is string =>
  typeof v === "string" && v.trim() !== "" && v.trim() !== "no_aplica";

/** Cita DECLINADA: la persona dijo por qué no quiere cita (MEJORAS 220).
 *  El modelo lo extrae del hilo entero cada turno, así que si más tarde
 *  pide cita el campo vuelve a null y el objetivo se reabre solo. */
export function citaDeclinada(campos: CamposPorEtapa | undefined): boolean {
  return conValor(campos?.cita?.motivo_no_cita);
}

/** Los objetivos abiertos que TODAVÍA tiene sentido perseguir. */
export function objetivosElegibles(
  abiertas: readonly EtapaObjetivo[],
  campos: CamposPorEtapa | undefined,
): EtapaObjetivo[] {
  const declinada = citaDeclinada(campos);
  return abiertas.filter((o) => !(o === "cita" && declinada));
}

/** DECLINAR CIERRA EL OBJETIVO, NO LO BORRA (13-09) — ¿este turno ENTREGA
 *  porque la cita está declinada?
 *
 *  La regla 2 saca la cita declinada de los elegibles para no volver a pedirle
 *  día ni franja a quien ya ha dicho que no. Hasta hoy eso, cuando no quedaba
 *  ningún otro objetivo, dejaba el turno SIN objetivo activo — y sin objetivo
 *  no hay caso completo, no hay entrega, y el hilo se muere con el motivo
 *  dentro. Es decir: `motivo_no_cita` existe para que una persona lo lea
 *  (MEJORAS 220) y no llegaba a nadie. Medido el 13-09 en el banco: en 3 de
 *  los 4 decisores de Carlos (implante desde 1.100 €) el motivo se recogió
 *  —«quiere pensarlo antes de decidir»— y el hilo terminó con `derivoEn: null`.
 *
 *  Un lead que dice «me lo pienso» es un caso TERMINADO CON MOTIVO, no un caso
 *  sin caso: el contrato de la cita está CUBIERTO —a quien no viene no se le
 *  piden día ni franja—, así que se entrega. La ficha ya sabía decirlo
 *  («No quiere cita — …», `queQuiereDe`); lo que faltaba era entregarlo.
 *
 *  Las tres condiciones, y cada una tapa un falso positivo:
 *   · `estado == null` — con urgencia, queja o petición manda la regla 1: este
 *     turno no se persigue NADA, y el caso se entrega igual por su causa, que
 *     dice más («se queja» pesa más que «no quiere cita»).
 *   · la cita está ABIERTA y declinada con motivo — sin objetivo abierto no
 *     hay contrato que cubrir.
 *   · no queda NINGÚN otro objetivo elegible — si lo hay, ese sigue recogiendo
 *     y entregará al cubrirse, con el motivo dentro. Entregar antes cortaría
 *     una conversación viva (el presupuesto a medias de quien no quiere cita). */
export function citaDeclinadaCubre(args: {
  abiertas: readonly EtapaObjetivo[];
  campos: CamposPorEtapa | undefined;
  estado: EstadoPersona;
}): boolean {
  if (args.estado != null) return false;
  if (!args.abiertas.includes("cita") || !citaDeclinada(args.campos)) return false;
  return objetivosElegibles(args.abiertas, args.campos).length === 0;
}

/** El objetivo que se persigue ESTE turno. null = solo contestar.
 *  · estado ≠ null → ninguno (regla 1);
 *  · el tema si está abierto y elegible;
 *  · si no, el elegible de mayor precedencia (el diseño ofensivo: «hola»
 *    de un lead nuevo sigue abriendo identificar/cita; sin este fallback,
 *    cualquier tangente mataría la recogida). */
export function objetivoActivoDe(args: {
  tema: string;
  abiertas: readonly EtapaObjetivo[];
  campos: CamposPorEtapa | undefined;
  estado: EstadoPersona;
}): EtapaObjetivo | null {
  if (args.estado != null) return null;
  const elegibles = objetivosElegibles(args.abiertas, args.campos);
  if ((elegibles as string[]).includes(args.tema)) return args.tema as EtapaObjetivo;
  return elegibles[0] ?? null;
}

// ─── «Qué quiere», en lenguaje de coordinadora ─────────────────────────────

export const ETIQUETA_OBJETIVO: Record<EtapaObjetivo, string> = {
  cita: "Quiere cita",
  mover_cita: "Quiere mover su cita",
  presupuesto: "Decidir su presupuesto",
  cobro: "Su pago pendiente",
  identificar: "Contacto nuevo",
};

/** De qué habla, cuando el tema es uno de los nuestros pero no hay objetivo
 *  abierto que case (Pablo: tema cobro sin cobro abierto → «un pago»). */
const DE_QUE: Partial<Record<string, string>> = {
  cobro: "un pago",
  presupuesto: "su presupuesto",
  cita: "una cita",
};

/** La frase de «qué quiere», determinista: etiqueta del objetivo + los
 *  valores reales recogidos. Sin modelo — no hay nada que verificar. */
export function componerQueQuiere(
  objetivo: EtapaObjetivo,
  campos: Record<string, string | null> | undefined,
): string {
  // MEJORAS 173 — el ORDEN es dato: jsonb normaliza el orden de las claves del
  // payload, así que la frase no puede depender de él. Se ordena por la
  // definición del objetivo (las claves que no estén, al final, por nombre).
  const orden = OBJETIVOS_POR_DEFECTO.find((o) => o.etapa === objetivo)?.campos.map((c) => c.clave) ?? [];
  const pos = (clave: string) => {
    const i = orden.indexOf(clave);
    return i === -1 ? orden.length : i;
  };
  const valores = Object.entries(campos ?? {})
    .sort(([a], [b]) => pos(a) - pos(b) || a.localeCompare(b))
    .map(([, v]) => v)
    .filter(conValor)
    .map((v) => v.trim());
  return valores.length ? `${ETIQUETA_OBJETIVO[objetivo]} — ${valores.join(" · ")}` : ETIQUETA_OBJETIVO[objetivo];
}

/** El titular de la ficha y de la cola. null = no hay nada que decir
 *  (solo conversación). Regla 3: el estado manda; luego el tema; el
 *  objetivo de relleno solo cuando ya tiene algún dato — «Quiere cita» de
 *  quien solo ha dicho «hola» es lo que pasó con Pablo. */
export function queQuiereDe(args: {
  estado: EstadoPersona;
  tema: string;
  abiertas: readonly EtapaObjetivo[];
  campos: CamposPorEtapa | undefined;
}): string | null {
  const { estado, tema, abiertas, campos } = args;
  const deQue = DE_QUE[tema];
  if (estado === "urgencia") return "Urgencia — pide que le vean ya";
  if (estado === "queja") return `Se queja${deQue ? ` de ${deQue}` : ""} — lo tiene que ver una persona`;
  if (estado === "peticion") return `Pide hablar con una persona${deQue ? ` por ${deQue}` : ""}`;

  const elegibles = objetivosElegibles(abiertas, campos);
  if ((elegibles as string[]).includes(tema)) {
    return componerQueQuiere(tema as EtapaObjetivo, campos?.[tema]);
  }
  if (tema === "cita" && citaDeclinada(campos)) {
    return `No quiere cita — ${String(campos?.cita?.motivo_no_cita).trim()}`;
  }
  if (deQue) return `Pregunta por ${deQue}`;
  if (citaDeclinada(campos)) {
    return `No quiere cita — ${String(campos?.cita?.motivo_no_cita).trim()}`;
  }
  const relleno = elegibles[0];
  if (relleno == null) return null;
  const tieneDatos = Object.values(campos?.[relleno] ?? {}).some(conValor);
  return tieneDatos ? componerQueQuiere(relleno, campos?.[relleno]) : "Aún no ha dicho qué quiere";
}

/** Quita del borrador las frases que recuerdan el pago (la coletilla), sin
 *  tocar el resto. Devuelve "" si no queda nada. */
export function sinRecuerdoDeCobro(texto: string, frase: RegExp): string {
  return texto
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => !frase.test(s))
    .join(" ")
    .trim();
}
