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

export type ConocimientoClinica = {
  quienesSois: QuienesSois;
  tratamientos: TratamientoPublicado[];
  politicas: PoliticaPublicada[];
  /** Lo que el agente puede DECIR del horario («L-V 9:30–20:00, sábados
   *  10–14»). Texto, no estructura: es para contestar, no para calcular —
   *  el horario que CALCULA plazos es clinicas.horario_laboral (grupo 4). */
  horarios: string | null;
  enlaces: EnlacePublicado[];
  agendaNivel: NivelAgenda;
  alcance: AlcanceAgente;
};

/** El plan básico: nada publicado, agenda sin conexión. Con esto el prompt
 *  es IDÉNTICO al de hoy (assert en qa:conocimiento) — una clínica sin
 *  configurar no se degrada. */
export const CONOCIMIENTO_VACIO: ConocimientoClinica = {
  quienesSois: { presentacion: null, trato: null },
  tratamientos: [],
  politicas: [],
  horarios: null,
  enlaces: [],
  agendaNivel: 1,
  alcance: { umbralInsistencia: null, urgencias: null, urgenciaDefinicionExtra: null },
};

export function esConocimientoVacio(c: ConocimientoClinica): boolean {
  // `alcance` y `agendaNivel` no cuentan aquí a propósito: esta función
  // decide si se emite el BLOQUE del prompt, y esos dos viajan por sus
  // propios canales (hooks del evaluador / decisión de pantalla), no por el
  // bloque. El vacío del prompt es «nada que afirmar».
  return (
    c.quienesSois.presentacion == null &&
    c.quienesSois.trato == null &&
    c.tratamientos.length === 0 &&
    c.politicas.length === 0 &&
    (c.horarios == null || c.horarios.trim() === "") &&
    c.enlaces.length === 0 &&
    c.alcance.urgenciaDefinicionExtra == null
  );
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
  const horarios = x["horarios"] ?? null;
  const enlaces = x["enlaces"] ?? [];
  if (!Array.isArray(tratamientos) || !tratamientos.every(esTratamientoValido)) {
    throw new ConocimientoIlegibleError("tratamientos no válidos", raw);
  }
  if (!Array.isArray(politicas) || !politicas.every(esPoliticaValida)) {
    throw new ConocimientoIlegibleError("políticas no válidas", raw);
  }
  if (!esTextoONull(horarios)) {
    throw new ConocimientoIlegibleError("horarios no válidos", raw);
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
    horarios: typeof horarios === "string" && horarios.trim() !== "" ? horarios.trim() : null,
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
  };
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
  if (c.horarios) {
    puede.push("Decir el horario de atención");
  } else {
    noPuede.push("No puede decir horarios — no están publicados");
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
    c.horarios != null || c.tratamientos.length > 0 || c.politicas.length > 0 || c.enlaces.length > 0;
  if (hayPublicado) {
    lineas.push(
      "LO PUBLICADO POR LA CLÍNICA — puedes afirmarlo tal cual (leer no es negociar). Adaptarlo a esta persona (su descuento, su cobertura, su plan) NO: eso se anota siempre.",
    );
    if (c.horarios) lineas.push(`· Horario de atención: ${c.horarios}`);
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
