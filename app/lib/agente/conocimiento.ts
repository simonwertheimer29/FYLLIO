// app/lib/agente/conocimiento.ts
//
// FASE D, grupo 2 — QUÉ SABE EL AGENTE: lo publicado por la clínica.
//
// MÓDULO PURO y client-safe, el mismo reparto que `objetivos.ts`: aquí los
// tipos, el VACÍO por defecto, el parser y el render; la lectura con datos en
// `automatizacion/pg.ts`; la pantalla (fase D) valida al guardar con ESTE
// MISMO parser — un solo criterio para guardar y leer.
//
// LA FRONTERA (§6 del plan, no cambia): el agente INFORMA de lo que ya está
// decidido; la persona decide lo que no lo está. Todo lo de aquí es «lo ya
// decidido y publicado» — leerlo no es negociar. Adaptarlo a una persona
// concreta (SU descuento, SU cobertura) sigue aplazándose siempre.
//
// PRECIOS COMO TEXTO, no number, a propósito: lo publicado en dental es
// «desde 35 €/mes», «600–900 € según caso», «primera visita gratuita». Un
// number obligaría a inventar precisión que la clínica no publicó.

import type { HorarioLaboral } from "../automatizaciones/types";

export type TratamientoPublicado = {
  nombre: string;
  /** El precio TAL CUAL está publicado («desde 35 €/mes»). null = el
   *  tratamiento se menciona sin precio: el agente puede decir que se hace,
   *  no cuánto cuesta. */
  precio: string | null;
  /** Matiz publicado («financiación 24 meses», «incluye revisión»). */
  nota: string | null;
};

export type PoliticaPublicada = {
  /** «Vías de pago» · «Seguros con los que trabajamos» · «Cancelaciones»… */
  titulo: string;
  texto: string;
};

export type EnlacePublicado = {
  etiqueta: string;
  url: string;
};

/** LOS NIVELES DE AGENDA (acordados, PLAN §11 — el aplazamiento con más
 *  volumen y el único que la clínica elimina sola conectando una fuente):
 *    1 · sin conexión — el agente recoge la disponibilidad DECLARADA de la
 *        persona (días/franjas) y el equipo confirma. Es el comportamiento
 *        base del system: por eso el nivel 1 NO se renderiza al prompt.
 *    2 · solo lectura — el agente informa de huecos, no reserva. Requiere
 *        la conexión de agenda (MEJORAS 97): hasta que exista, la pantalla
 *        lo enseña BLOQUEADO Y VISIBLE, y el parser no lo acepta — un 2
 *        guardado hoy haría al agente prometer huecos que no puede ver.
 *    3 · escritura — FUERA de A-F: ni se ofrece ni se menciona.
 */
export type NivelAgenda = 1 | 2;

/** GRUPO 1 — QUIÉNES SOIS: identidad y trato. El TONO base (cálido,
 *  profesional, sin emojis) es del system y no se configura; esto es lo que
 *  la clínica sí decide: cómo se presenta y si tutea. */
export type QuienesSois = {
  /** 1–2 frases de presentación («Clínica familiar en Chamberí, 20 años
   *  cuidando bocas del barrio»). El agente la usa como identidad. */
  presentacion: string | null;
  /** null = tuteo (el default de siempre). */
  trato: "tu" | "usted" | null;
};

/** GRUPO 3 — HASTA DÓNDE LLEGA. Los tres campos alimentan hooks que el
 *  evaluador YA tiene (`umbralInsistencia`, `urgencias`): configurar es
 *  pasar el valor, no cambiar reglas. */
export type AlcanceAgente = {
  /** Vueltas sobre el mismo tema aplazado antes de derivar. Default 2;
   *  CON TOPE 1–4 (dictado): más de 4 es marear a una persona que insiste. */
  umbralInsistencia: number | null;
  /** ¿La clínica atiende urgencias? Si NO, `textoNoAtiende` es OBLIGATORIO
   *  y se reproduce LITERAL — lo escribe y lo asume la clínica, el modelo
   *  no genera nada ahí. */
  urgencias: { atiende: boolean; textoNoAtiende: string | null } | null;
  /** Qué considera urgencia ESTA clínica, ADEMÁS de la definición base
   *  (dolor agudo, sangrado, traumatismo…). Entra al contexto del juicio. */
  urgenciaDefinicionExtra: string | null;
};

/** GRUPO 4 — PLAZOS DE RESPUESTA. Minutos LABORABLES antes de que un caso
 *  escale a Fuera de plazo, por obligación (null = default de la casa), y el
 *  HORARIO LABORAL de la clínica — que NACE aquí: no existía como dato en
 *  ninguna parte (solo staff.horario_laboral, por empleado). Esta config es
 *  LA fuente; el reloj de la cola la lee. Nada de esto va al prompt: son
 *  reglas del sistema, no conocimiento del modelo. */
export type PlazosRespuesta = {
  /** Default 30 · tope 10–120. */
  urgenciaMin: number | null;
  /** Default 120 · tope 30–480. */
  respuestaMin: number | null;
  /** Default 240 · tope 60–960. */
  cierreMin: number | null;
  /** Default 60 · tope 15–240. */
  leadNuevoMin: number | null;
  /** null = el default de la casa (L-V 9:00–20:00). */
  horario: HorarioLaboral | null;
  /** LA POLÍTICA DE COBRO (F5, dictado): no es una preferencia de plazo —
   *  es cuándo considera ESTA clínica que un pago está VENCIDO: N días
   *  después del plazo de pago sin liquidación, el caso entra en la cola.
   *  Default 7 · tope 0–60. En DÍAS de calendario de la clínica, no en
   *  minutos laborables: el vencimiento es del dinero, no de una persona
   *  esperando en horario. */
  cobroVencidoDias: number | null;
  /** Cuándo un vencido escala a Fuera de plazo. Default 30 · tope 2–180,
   *  y siempre mayor que cobroVencidoDias. */
  cobroFueraDePlazoDias: number | null;
};

export type ConocimientoClinica = {
  quienesSois: QuienesSois;
  tratamientos: TratamientoPublicado[];
  politicas: PoliticaPublicada[];
  enlaces: EnlacePublicado[];
  agendaNivel: NivelAgenda;
  alcance: AlcanceAgente;
  plazos: PlazosRespuesta;
};
// (22-08: el «horario de atención» de texto libre MURIÓ — era el hallazgo de
// los dos horarios vivo en la pantalla: la clínica rellenaba uno creyendo
// rellenar los dos. UN solo dato, `plazos.horario`, con dos consecuencias:
// el agente lo DICE (el texto se deriva con `horarioLegible`, determinista)
// y el reloj de plazos lo USA. Un JSON guardado con el campo viejo
// `horarios` no rompe: el parser ignora campos desconocidos.)

/** El plan básico: nada publicado, agenda sin conexión. Con esto el prompt
 *  es IDÉNTICO al de hoy (assert en qa:conocimiento) — una clínica sin
 *  configurar no se degrada. */
export const PLAZOS_VACIOS: PlazosRespuesta = {
  urgenciaMin: null,
  respuestaMin: null,
  cierreMin: null,
  leadNuevoMin: null,
  horario: null,
  cobroVencidoDias: null,
  cobroFueraDePlazoDias: null,
};

export const CONOCIMIENTO_VACIO: ConocimientoClinica = {
  quienesSois: { presentacion: null, trato: null },
  tratamientos: [],
  politicas: [],
  enlaces: [],
  agendaNivel: 1,
  alcance: { umbralInsistencia: null, urgencias: null, urgenciaDefinicionExtra: null },
  plazos: PLAZOS_VACIOS,
};

export function esConocimientoVacio(c: ConocimientoClinica): boolean {
  // `alcance.umbral/urgencias`, `agendaNivel` y los MINUTOS de plazos no
  // cuentan aquí: esta función decide si se emite el BLOQUE del prompt, y
  // esos viajan por sus propios canales (hooks del evaluador / reloj de la
  // cola). `plazos.horario` SÍ cuenta: definido, el agente lo dice.
  return (
    c.quienesSois.presentacion == null &&
    c.quienesSois.trato == null &&
    c.tratamientos.length === 0 &&
    c.politicas.length === 0 &&
    c.enlaces.length === 0 &&
    c.alcance.urgenciaDefinicionExtra == null &&
    c.plazos.horario == null
  );
}

// ─── El horario, LEGIBLE — derivado de la estructura, determinista ─────────
//
// Un solo dato con dos consecuencias: el reloj lo usa tal cual y el agente
// lo DICE con este texto («lun–vie 9:30–20:00 · sáb 10:00–14:00»). Días
// consecutivos con el mismo tramo se agrupan; el que no abre, no aparece.

const DIA_CORTO = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
const DIAS_ORDEN = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;
const sinCeroInicial = (hhmm: string) => hhmm.replace(/^0/, "");

export function horarioLegible(h: HorarioLaboral): string {
  const tramos: { desde: number; hasta: number; tramo: string }[] = [];
  DIAS_ORDEN.forEach((dia, i) => {
    const d = h[dia];
    if (!d.activo) return;
    const tramo = `${sinCeroInicial(d.inicio)}–${sinCeroInicial(d.fin)}`;
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.hasta === i - 1 && ultimo.tramo === tramo) ultimo.hasta = i;
    else tramos.push({ desde: i, hasta: i, tramo });
  });
  return tramos
    .map((t) => `${t.desde === t.hasta ? DIA_CORTO[t.desde] : `${DIA_CORTO[t.desde]}–${DIA_CORTO[t.hasta]}`} ${t.tramo}`)
    .join(" · ");
}

// ─── El parser — mismo contrato que parseObjetivos (endurecido 13-08) ──────
//
//   · NULL / vacío → CONOCIMIENTO_VACIO en silencio (estado normal).
//   · presente e ilegible → LANZA con el motivo. Caer al vacío aquí sería la
//     clínica creyendo que su agente contesta precios mientras los aplaza —
//     un fallback mudo con comportamiento, el pecado de siempre (§10).
//   · Se rechaza ENTERO si cualquier parte está mal.

export class ConocimientoIlegibleError extends Error {
  constructor(motivo: string, raw: string) {
    super(`conocimiento de la clínica ilegible (${motivo}): «${raw.slice(0, 120)}…»`);
    this.name = "ConocimientoIlegibleError";
  }
}

const esTextoNoVacio = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const esTextoONull = (v: unknown): v is string | null => v === null || typeof v === "string";

function esTratamientoValido(t: unknown): t is TratamientoPublicado {
  if (typeof t !== "object" || t === null) return false;
  const x = t as Record<string, unknown>;
  return esTextoNoVacio(x["nombre"]) && esTextoONull(x["precio"] ?? null) && esTextoONull(x["nota"] ?? null);
}

function esPoliticaValida(p: unknown): p is PoliticaPublicada {
  if (typeof p !== "object" || p === null) return false;
  const x = p as Record<string, unknown>;
  return esTextoNoVacio(x["titulo"]) && esTextoNoVacio(x["texto"]);
}

function esEnlaceValido(e: unknown): e is EnlacePublicado {
  if (typeof e !== "object" || e === null) return false;
  const x = e as Record<string, unknown>;
  return (
    esTextoNoVacio(x["etiqueta"]) &&
    esTextoNoVacio(x["url"]) &&
    /^https?:\/\/\S+$/i.test(String(x["url"]).trim())
  );
}

export function parseConocimiento(raw: string | null | undefined): ConocimientoClinica {
  if (raw == null || raw.trim() === "") return CONOCIMIENTO_VACIO;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConocimientoIlegibleError("JSON ilegible", raw);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConocimientoIlegibleError("forma no reconocida", raw);
  }
  const x = parsed as Record<string, unknown>;
  const tratamientos = x["tratamientos"] ?? [];
  const politicas = x["politicas"] ?? [];
  const enlaces = x["enlaces"] ?? [];
  if (!Array.isArray(tratamientos) || !tratamientos.every(esTratamientoValido)) {
    throw new ConocimientoIlegibleError("tratamientos no válidos", raw);
  }
  if (!Array.isArray(politicas) || !politicas.every(esPoliticaValida)) {
    throw new ConocimientoIlegibleError("políticas no válidas", raw);
  }
  if (!Array.isArray(enlaces) || !enlaces.every(esEnlaceValido)) {
    throw new ConocimientoIlegibleError("enlaces no válidos", raw);
  }
  // Agenda: ausente → nivel 1 (sin conexión). El nivel 2 se RECHAZA hasta
  // que la conexión de agenda exista (MEJORAS 97): guardarlo hoy sería un
  // agente prometiendo huecos que no puede ver.
  const agendaNivel = x["agendaNivel"] ?? 1;
  if (agendaNivel !== 1) {
    throw new ConocimientoIlegibleError("agendaNivel no disponible (solo 1 hasta conectar la agenda)", raw);
  }

  // Grupo 1 — quiénes sois.
  const qsRaw = (x["quienesSois"] ?? {}) as Record<string, unknown>;
  if (typeof qsRaw !== "object" || qsRaw === null || Array.isArray(qsRaw)) {
    throw new ConocimientoIlegibleError("quienesSois no válido", raw);
  }
  if (!esTextoONull(qsRaw["presentacion"] ?? null)) {
    throw new ConocimientoIlegibleError("presentación no válida", raw);
  }
  const trato = qsRaw["trato"] ?? null;
  if (trato !== null && trato !== "tu" && trato !== "usted") {
    throw new ConocimientoIlegibleError("trato no válido (tu | usted)", raw);
  }

  // Grupo 3 — hasta dónde llega.
  const alRaw = (x["alcance"] ?? {}) as Record<string, unknown>;
  if (typeof alRaw !== "object" || alRaw === null || Array.isArray(alRaw)) {
    throw new ConocimientoIlegibleError("alcance no válido", raw);
  }
  const umbral = alRaw["umbralInsistencia"] ?? null;
  if (umbral !== null && (!Number.isInteger(umbral) || (umbral as number) < 1 || (umbral as number) > 4)) {
    throw new ConocimientoIlegibleError("umbral de insistencia fuera de tope (1–4)", raw);
  }
  const urgRaw = alRaw["urgencias"] ?? null;
  let urgencias: AlcanceAgente["urgencias"] = null;
  if (urgRaw !== null) {
    if (typeof urgRaw !== "object" || Array.isArray(urgRaw) || typeof (urgRaw as Record<string, unknown>)["atiende"] !== "boolean") {
      throw new ConocimientoIlegibleError("urgencias no válidas", raw);
    }
    const atiende = (urgRaw as Record<string, unknown>)["atiende"] as boolean;
    const textoNoAtiende = (urgRaw as Record<string, unknown>)["textoNoAtiende"] ?? null;
    if (!esTextoONull(textoNoAtiende)) {
      throw new ConocimientoIlegibleError("texto de urgencias no válido", raw);
    }
    // El texto literal es OBLIGATORIO si no se atienden: sin él, el modelo
    // tendría que improvisar justo en el mensaje que la clínica debe asumir.
    if (!atiende && (typeof textoNoAtiende !== "string" || textoNoAtiende.trim() === "")) {
      throw new ConocimientoIlegibleError("si no se atienden urgencias, el texto literal es obligatorio", raw);
    }
    urgencias = { atiende, textoNoAtiende: typeof textoNoAtiende === "string" && textoNoAtiende.trim() !== "" ? textoNoAtiende.trim() : null };
  }
  if (!esTextoONull(alRaw["urgenciaDefinicionExtra"] ?? null)) {
    throw new ConocimientoIlegibleError("definición extra de urgencia no válida", raw);
  }

  // Grupo 4 — plazos con TOPE por obligación: un umbral fuera de rango no es
  // una preferencia, es la cola dejando de significar nada (1 min llenaría
  // Fuera de plazo cada pausa del café; 5 días la vaciaría para siempre).
  const plRaw = (x["plazos"] ?? {}) as Record<string, unknown>;
  if (typeof plRaw !== "object" || plRaw === null || Array.isArray(plRaw)) {
    throw new ConocimientoIlegibleError("plazos no válidos", raw);
  }
  const minutos = (clave: string, min: number, max: number): number | null => {
    const v = plRaw[clave] ?? null;
    if (v === null) return null;
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
      throw new ConocimientoIlegibleError(`${clave} fuera de tope (${min}–${max} min)`, raw);
    }
    return v as number;
  };
  const dias = (clave: string, min: number, max: number): number | null => {
    const v = plRaw[clave] ?? null;
    if (v === null) return null;
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
      throw new ConocimientoIlegibleError(`${clave} fuera de tope (${min}–${max} días)`, raw);
    }
    return v as number;
  };
  const cobroVencidoDias = dias("cobroVencidoDias", 0, 60);
  const cobroFueraDePlazoDias = dias("cobroFueraDePlazoDias", 2, 180);
  if (
    cobroVencidoDias != null && cobroFueraDePlazoDias != null &&
    cobroFueraDePlazoDias <= cobroVencidoDias
  ) {
    throw new ConocimientoIlegibleError(
      "la escalada de cobro debe ser posterior al vencido (cobroFueraDePlazoDias > cobroVencidoDias)",
      raw,
    );
  }
  const horRaw = plRaw["horario"] ?? null;
  let horario: HorarioLaboral | null = null;
  if (horRaw !== null) {
    if (typeof horRaw !== "object" || Array.isArray(horRaw)) {
      throw new ConocimientoIlegibleError("horario laboral no válido", raw);
    }
    const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;
    const h: Record<string, { activo: boolean; inicio: string; fin: string }> = {};
    for (const dia of DIAS) {
      const d = (horRaw as Record<string, unknown>)[dia];
      if (
        typeof d !== "object" || d === null ||
        typeof (d as Record<string, unknown>)["activo"] !== "boolean" ||
        !/^\d{2}:\d{2}$/.test(String((d as Record<string, unknown>)["inicio"])) ||
        !/^\d{2}:\d{2}$/.test(String((d as Record<string, unknown>)["fin"]))
      ) {
        throw new ConocimientoIlegibleError(`horario laboral: ${dia} no válido`, raw);
      }
      const dd = d as { activo: boolean; inicio: string; fin: string };
      if (dd.activo && dd.fin <= dd.inicio) {
        throw new ConocimientoIlegibleError(`horario laboral: ${dia} cierra antes de abrir`, raw);
      }
      h[dia] = { activo: dd.activo, inicio: dd.inicio, fin: dd.fin };
    }
    if (DIAS.every((d) => !h[d].activo)) {
      throw new ConocimientoIlegibleError("horario laboral sin ningún día activo", raw);
    }
    horario = h as HorarioLaboral;
  }

  return {
    quienesSois: {
      presentacion:
        typeof qsRaw["presentacion"] === "string" && qsRaw["presentacion"].trim() !== ""
          ? qsRaw["presentacion"].trim()
          : null,
      trato: (trato as "tu" | "usted" | null),
    },
    tratamientos: tratamientos.map((t) => ({
      nombre: t.nombre.trim(),
      precio: t.precio?.trim() || null,
      nota: t.nota?.trim() || null,
    })),
    politicas: politicas.map((p) => ({ titulo: p.titulo.trim(), texto: p.texto.trim() })),
    enlaces: enlaces.map((e) => ({ etiqueta: e.etiqueta.trim(), url: e.url.trim() })),
    agendaNivel: 1,
    alcance: {
      umbralInsistencia: (umbral as number | null),
      urgencias,
      urgenciaDefinicionExtra:
        typeof alRaw["urgenciaDefinicionExtra"] === "string" && alRaw["urgenciaDefinicionExtra"].trim() !== ""
          ? alRaw["urgenciaDefinicionExtra"].trim()
          : null,
    },
    plazos: {
      urgenciaMin: minutos("urgenciaMin", 10, 120),
      respuestaMin: minutos("respuestaMin", 30, 480),
      cierreMin: minutos("cierreMin", 60, 960),
      leadNuevoMin: minutos("leadNuevoMin", 15, 240),
      horario,
      cobroVencidoDias,
      cobroFueraDePlazoDias,
    },
  };
}

/** La política de cobro RESUELTA (defaults 7/30 dictados). Pura — la testea
 *  qa:conocimiento; la cola solo hace el wiring. */
export const POLITICA_COBRO_DEFAULT = { vencidoDias: 7, fueraDePlazoDias: 30 } as const;

export function politicaCobro(c: ConocimientoClinica): {
  vencidoDias: number;
  fueraDePlazoDias: number;
} {
  return {
    vencidoDias: c.plazos.cobroVencidoDias ?? POLITICA_COBRO_DEFAULT.vencidoDias,
    fueraDePlazoDias: c.plazos.cobroFueraDePlazoDias ?? POLITICA_COBRO_DEFAULT.fueraDePlazoDias,
  };
}

/** Lo que el RELOJ de la cola necesita de una config, con los null resueltos
 *  a nada (el caller aplica sus defaults). Pura — la testea qa:conocimiento;
 *  la cola solo hace el wiring. */
export function plazosParaReloj(c: ConocimientoClinica): {
  umbralesMin: Partial<Record<"urgencia" | "respuesta" | "cierre" | "lead_nuevo", number>>;
  horario: HorarioLaboral | null;
} {
  const umbralesMin: Partial<Record<"urgencia" | "respuesta" | "cierre" | "lead_nuevo", number>> = {};
  if (c.plazos.urgenciaMin != null) umbralesMin.urgencia = c.plazos.urgenciaMin;
  if (c.plazos.respuestaMin != null) umbralesMin.respuesta = c.plazos.respuestaMin;
  if (c.plazos.cierreMin != null) umbralesMin.cierre = c.plazos.cierreMin;
  if (c.plazos.leadNuevoMin != null) umbralesMin.lead_nuevo = c.plazos.leadNuevoMin;
  return { umbralesMin, horario: c.plazos.horario };
}

// ─── El render — el bloque «LA CLÍNICA» del contexto del evaluador ─────────
//
// CÓDIGO, no modelo: la config se imprime tal cual, con la instrucción de la
// frontera en la cabecera. Con conocimiento vacío devuelve [] — el prompt
// queda BYTE A BYTE igual que sin configuración (el assert del plan básico).
// El system no se toca: su regla «solo puedes afirmar datos que estén en el
// contexto» es exactamente la que hace que esto funcione — publicar es meter
// el dato en el contexto.

// ─── El barrido de capacidades — derivado de la config, NUNCA del modelo ───
//
// (Preguntarle al modelo qué cree que puede hacer diría que sí a casi todo.)
// En positivo Y EN NEGATIVO: el negativo es donde la clínica ve el hueco.
// `limites` va aparte: son límites del PRODUCTO — ninguna configuración los
// quita — y enseñarlos como huecos configurables sería vender un upgrade que
// no existe (duda_clinica, PLAN §6).

export type BarridoCapacidades = {
  puede: string[];
  noPuede: string[];
  /** Límites del producto: se muestran distinto, no son huecos. */
  limites: string[];
};

export function capacidadesDe(c: ConocimientoClinica): BarridoCapacidades {
  const puede: string[] = [
    "Contestar mensajes, recoger los datos de cada caso (decisión, disponibilidad, forma de pago elegida…) y entregarlo listo para cerrar",
  ];
  const noPuede: string[] = [];

  const conPrecio = c.tratamientos.filter((t) => t.precio != null);
  if (conPrecio.length > 0) {
    puede.push(`Decir el precio publicado de ${conPrecio.length === 1 ? "1 tratamiento" : `${conPrecio.length} tratamientos`}`);
  } else {
    noPuede.push("No puede decir precios — no hay ninguno publicado: «¿cuánto cuesta?» lo resuelve tu equipo");
  }
  if (c.plazos.horario) {
    puede.push("Decir el horario de atención");
  } else {
    noPuede.push("No puede decir horarios — no está definido el horario de la clínica");
  }
  if (c.politicas.length > 0) {
    puede.push(`Contestar las políticas publicadas (${c.politicas.map((p) => p.titulo.toLowerCase()).join(", ")})`);
  } else {
    noPuede.push("No puede contestar políticas (vías de pago, seguros con los que trabajáis, cancelaciones…) — no hay ninguna publicada");
  }
  if (c.enlaces.length > 0) {
    puede.push(`Compartir ${c.enlaces.length === 1 ? "el enlace publicado" : `los ${c.enlaces.length} enlaces publicados`}`);
  } else {
    noPuede.push("No puede compartir enlaces (reserva online, web) — no hay ninguno");
  }
  // El nivel de agenda — el aplazamiento con más volumen (PLAN §11). Con
  // nivel 1, recoger disponibilidad SÍ (ya está arriba, es el trabajo base);
  // el hueco es no ver la agenda, y es el único que se elimina conectando
  // una fuente — el argumento de esta pantalla.
  if (c.agendaNivel === 1) {
    noPuede.push("No puede decir los huecos libres de la agenda — recoge la disponibilidad de la persona y tu equipo confirma la cita. Se elimina conectando tu agenda (solo lectura)");
  } else {
    puede.push("Informar de los huecos libres de la agenda (solo lectura — reservar lo hace tu equipo)");
  }

  if (c.alcance.urgencias?.atiende === false) {
    puede.push("Ante una urgencia responde EXACTAMENTE tu texto (aquí no se atienden) y la deriva igualmente a una persona");
  }

  return {
    puede,
    noPuede,
    limites: [
      "Las dudas clínicas (dolor, riesgos, medicación, cuidados) SIEMPRE van al doctor — acompaña, no opina. Límite del producto: ninguna configuración lo cambia",
      "La cobertura del seguro DE una persona no se confirma nunca — informar con qué aseguradoras trabajáis sí, si lo publicas",
    ],
  };
}

// ─── Sugerencias para la pantalla — NUNCA datos (22-08) ────────────────────
//
// Un «Añadir tratamiento» sobre una lista vacía es un lienzo en blanco —
// justo lo que el producto existe para evitar. Estas sugerencias se ofrecen
// como chips que la clínica ACEPTA con un clic (con el precio vacío: ese lo
// pone ella), edita o ignora. JAMÁS se guardan solas: guardar «hacemos
// implantes» en una clínica que no los hace sería inventar un dato.

export const SUGERENCIAS_TRATAMIENTOS: readonly string[] = [
  "Primera visita y valoración",
  "Higiene bucodental (limpieza)",
  "Empaste",
  "Endodoncia",
  "Implante unitario",
  "Corona",
  "Ortodoncia invisible",
  "Brackets",
  "Blanqueamiento",
  "Extracción",
];

export const SUGERENCIAS_POLITICAS: readonly { titulo: string; ejemplo: string }[] = [
  { titulo: "Vías de pago", ejemplo: "Efectivo, tarjeta y transferencia" },
  { titulo: "Financiación", ejemplo: "Hasta 24 meses sin intereses, sujeta a aprobación" },
  { titulo: "Seguros", ejemplo: "Trabajamos con Sanitas, Adeslas y DKV" },
  { titulo: "Cancelaciones", ejemplo: "Cambiar o anular una cita hasta 24 h antes, sin coste" },
];

/** Las REGLAS DURAS — se muestran en la pantalla, no se editan (PLAN §6). */
export const REGLAS_DURAS: readonly string[] = [
  "No compromete dinero no decidido: ni precios, ni descuentos, ni plazos que no estén publicados o emitidos.",
  "No da criterio clínico jamás — tampoco «tranquilizar» con hechos médicos.",
  "No negocia: adaptar una condición a una persona concreta lo hace siempre tu equipo.",
  "En recordatorios, ningún dato de salud no pedido (art. 9): ni cifra ni tratamiento si la persona no lo pregunta.",
];

export function renderConocimiento(c: ConocimientoClinica | null | undefined): string[] {
  // El nivel de agenda NO se renderiza mientras solo exista el 1: recoger
  // disponibilidad declarada YA es el comportamiento del system — repetirlo
  // aquí rompería el assert del plan básico sin cambiar nada. Cuando el
  // nivel 2 exista (MEJORAS 97), su bloque entra aquí con sus huecos.
  if (!c || esConocimientoVacio(c)) return [];
  const lineas: string[] = [];
  // Grupo 1 — la identidad va ANTES de lo publicado: primero quién habla,
  // después qué puede afirmar.
  if (c.quienesSois.presentacion || c.quienesSois.trato) {
    lineas.push("QUIÉNES SOIS (tu identidad al hablar):");
    if (c.quienesSois.presentacion) lineas.push(`· ${c.quienesSois.presentacion}`);
    if (c.quienesSois.trato) {
      lineas.push(
        c.quienesSois.trato === "usted"
          ? "· Trata a la persona de USTED, siempre."
          : "· Tutea a la persona.",
      );
    }
    lineas.push("");
  }
  // Grupo 3 — la definición ampliada de urgencia de ESTA clínica: se SUMA a
  // la base del system, nunca la sustituye.
  if (c.alcance.urgenciaDefinicionExtra) {
    lineas.push(
      `URGENCIA — además de la definición base, esta clínica considera urgencia: ${c.alcance.urgenciaDefinicionExtra}`,
    );
    lineas.push("");
  }
  const hayPublicado =
    c.plazos.horario != null || c.tratamientos.length > 0 || c.politicas.length > 0 || c.enlaces.length > 0;
  if (hayPublicado) {
    lineas.push(
      "LO PUBLICADO POR LA CLÍNICA — puedes afirmarlo tal cual (leer no es negociar). Adaptarlo a esta persona (su descuento, su cobertura, su plan) NO: eso se anota siempre.",
    );
    // UN dato, dos consecuencias: el mismo horario que mide los plazos es el
    // que el agente dice — el texto se deriva, no se escribe dos veces.
    if (c.plazos.horario) lineas.push(`· Horario de APERTURA (cuándo abre la clínica): ${horarioLegible(c.plazos.horario)} — NO son huecos libres: los huecos no los ves. Se dice «abrimos de X a Y», jamás «tenemos disponibilidad de X a Y».`);
    if (c.tratamientos.length > 0) {
      lineas.push("· Tratamientos publicados:");
      for (const t of c.tratamientos) {
        const precio = t.precio ? `: ${t.precio}` : " (sin precio publicado — no des cifra)";
        lineas.push(`  - ${t.nombre}${precio}${t.nota ? ` — ${t.nota}` : ""}`);
      }
    }
    if (c.politicas.length > 0) {
      lineas.push("· Políticas publicadas:");
      for (const p of c.politicas) lineas.push(`  - ${p.titulo}: ${p.texto}`);
    }
    if (c.enlaces.length > 0) {
      lineas.push("· Enlaces que puedes compartir:");
      for (const e of c.enlaces) lineas.push(`  - ${e.etiqueta}: ${e.url}`);
    }
  }
  // Sin nada que decir, la última línea en blanco del bloque de identidad
  // sobra — el caller une con "\n" y el prompt no lleva colas vacías.
  while (lineas.length > 0 && lineas[lineas.length - 1] === "") lineas.pop();
  return lineas;
}
