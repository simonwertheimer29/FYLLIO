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

export type ConocimientoClinica = {
  tratamientos: TratamientoPublicado[];
  politicas: PoliticaPublicada[];
  /** Lo que el agente puede DECIR del horario («L-V 9:30–20:00, sábados
   *  10–14»). Texto, no estructura: es para contestar, no para calcular —
   *  el horario que CALCULA plazos es clinicas.horario_laboral (grupo 4). */
  horarios: string | null;
  enlaces: EnlacePublicado[];
};

/** El plan básico: nada publicado. Con esto el prompt es IDÉNTICO al de hoy
 *  (assert en qa:conocimiento) — una clínica sin configurar no se degrada. */
export const CONOCIMIENTO_VACIO: ConocimientoClinica = {
  tratamientos: [],
  politicas: [],
  horarios: null,
  enlaces: [],
};

export function esConocimientoVacio(c: ConocimientoClinica): boolean {
  return (
    c.tratamientos.length === 0 &&
    c.politicas.length === 0 &&
    (c.horarios == null || c.horarios.trim() === "") &&
    c.enlaces.length === 0
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
  return {
    tratamientos: tratamientos.map((t) => ({
      nombre: t.nombre.trim(),
      precio: t.precio?.trim() || null,
      nota: t.nota?.trim() || null,
    })),
    politicas: politicas.map((p) => ({ titulo: p.titulo.trim(), texto: p.texto.trim() })),
    horarios: typeof horarios === "string" && horarios.trim() !== "" ? horarios.trim() : null,
    enlaces: enlaces.map((e) => ({ etiqueta: e.etiqueta.trim(), url: e.url.trim() })),
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

  return {
    puede,
    noPuede,
    limites: [
      "Las dudas clínicas (dolor, riesgos, medicación, cuidados) SIEMPRE van al doctor — acompaña, no opina. Límite del producto: ninguna configuración lo cambia",
      "La cobertura del seguro DE una persona no se confirma nunca — informar con qué aseguradoras trabajáis sí, si lo publicas",
    ],
  };
}

/** Las REGLAS DURAS — se muestran en la pantalla, no se editan (PLAN §6). */
export const REGLAS_DURAS: readonly string[] = [
  "No compromete dinero no decidido: ni precios, ni descuentos, ni plazos que no estén publicados o emitidos.",
  "No da criterio clínico jamás — tampoco «tranquilizar» con hechos médicos.",
  "No negocia: adaptar una condición a una persona concreta lo hace siempre tu equipo.",
  "En recordatorios, ningún dato de salud no pedido (art. 9): ni cifra ni tratamiento si la persona no lo pregunta.",
];

export function renderConocimiento(c: ConocimientoClinica | null | undefined): string[] {
  if (!c || esConocimientoVacio(c)) return [];
  const lineas: string[] = [];
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
  return lineas;
}
