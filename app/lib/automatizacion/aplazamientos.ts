// app/lib/automatizacion/aplazamientos.ts
//
// La taxonomía de lo que el agente aplaza (fase A, migración 021) y la
// derivación de pendientes. MÓDULO PURO y client-safe, como `estado.ts`.
//
// La taxonomía salió del CORPUS de evals (los 8 casos «A» de la anotación
// sellada del 2026-08-13), no de lo que sonaba razonable; la única clave que
// viene del plan y no del corpus es `agenda_disponibilidad` (§11: «el caso
// más frecuente») — si naciera fuera del enum, lo más frecuente caería todo
// en «otro» y la taxonomía quedaría ciega justo donde más volumen hay.

export type ClaveAplazado =
  | "precio_descuento"
  | "plan_pago"
  | "cobertura_seguro"
  | "cambio_tratamiento"
  | "garantia_condiciones"
  | "dato_presupuesto"
  | "agenda_disponibilidad"
  | "otro";

/**
 * Dos naturalezas, porque no son el mismo problema:
 *   · `decision`     → requiere criterio humano; se corrige CONFIGURANDO el
 *                      alcance del agente (más cosas decididas = menos aplazos)
 *   · `dato_ausente` → el sistema no tiene el dato; se corrige CONECTANDO una
 *                      fuente (una columna, la agenda)
 * Mezclarlas rompe la métrica de §10 («cuántas veces se aplaza antes de
 * romper») y ensucia la lista de la ficha §4 — un horario no exige criterio
 * de nadie.
 */
export type NaturalezaAplazado = "decision" | "dato_ausente";

/**
 * La naturaleza se DERIVA del enum, sin columna: el mapeo es 1:1 y estable
 * por construcción — la clave se define por lo que el paciente pide, y una
 * clave que pudiera caer de los dos lados está mal partida y se parte en dos
 * claves (así se separó `agenda_disponibilidad` de la disponibilidad
 * declarada, que es un dato del objetivo y no un aplazamiento).
 *
 * `otro` va al lado seguro (`decision`): hasta que alguien lo mire, exige
 * criterio. Qué cae en «otro» se revisa antes de cerrar la fase B.
 */
export const NATURALEZA_DE_CLAVE: Record<ClaveAplazado, NaturalezaAplazado> = {
  precio_descuento: "decision",
  plan_pago: "decision",
  cobertura_seguro: "decision",
  cambio_tratamiento: "decision",
  garantia_condiciones: "decision",
  dato_presupuesto: "dato_ausente",
  agenda_disponibilidad: "dato_ausente",
  otro: "decision",
};

export const CLAVES_APLAZADO = Object.keys(NATURALEZA_DE_CLAVE) as readonly ClaveAplazado[];

/** En el lenguaje de la coordinadora, para la ficha y la configuración. */
export const ETIQUETA_CLAVE: Record<ClaveAplazado, string> = {
  precio_descuento: "Precio o descuento",
  plan_pago: "Forma de pago a medida",
  cobertura_seguro: "Cobertura del seguro",
  cambio_tratamiento: "Cambio en el tratamiento",
  garantia_condiciones: "Garantías y condiciones",
  dato_presupuesto: "Dato del presupuesto que falta",
  agenda_disponibilidad: "Huecos de agenda",
  otro: "Otro",
};

// ─── Pendientes ──────────────────────────────────────────────────────────────

/** Lo mínimo de una fila del log que hace falta para derivar pendientes.
 *  El orden lo da `created_at`; se acepta cualquier representación ordenable. */
export type EventoAplazamiento = {
  evento: "aplazado" | "aplazado_resuelto";
  clave: ClaveAplazado;
  motivoTexto: string | null;
  /** ISO o epoch — solo se compara, no se interpreta. */
  createdAt: string | number;
};

export type PendienteAplazado = {
  clave: ClaveAplazado;
  naturaleza: NaturalezaAplazado;
  /** Los motivos VIVOS, en orden de llegada: los `motivo_texto` de los
   *  aplazados posteriores al último resuelto de su clave. Es la lista
   *  numerada de la ficha (§4). */
  motivos: string[];
};

/**
 * REGLA DE PENDIENTES (2026-08-13): una clave está pendiente ⇔ existe un
 * `aplazado` de esa clave POSTERIOR al último `aplazado_resuelto` de esa
 * clave en ese caso. Append-only, sin referencia 1:1 — resolver una clave la
 * resuelve entera, y si el paciente vuelve a sacarla después, vuelve a estar
 * pendiente sin que ningún contador se descuadre.
 *
 * Puro a propósito: recibe las filas de UN caso ya cargadas y no sabe de SQL.
 * La consulta vive en quien tenga el caso delante (ficha, cohorte, QA), la
 * regla vive aquí — una sola vez.
 */
export function pendientesDeAplazados(eventos: readonly EventoAplazamiento[]): PendienteAplazado[] {
  const ultimoResuelto = new Map<ClaveAplazado, string | number>();
  for (const e of eventos) {
    if (e.evento !== "aplazado_resuelto") continue;
    const previo = ultimoResuelto.get(e.clave);
    if (previo === undefined || e.createdAt > previo) ultimoResuelto.set(e.clave, e.createdAt);
  }

  const vivos = new Map<ClaveAplazado, string[]>();
  const ordenados = [...eventos].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  for (const e of ordenados) {
    if (e.evento !== "aplazado") continue;
    const corte = ultimoResuelto.get(e.clave);
    if (corte !== undefined && e.createdAt <= corte) continue;
    if (!vivos.has(e.clave)) vivos.set(e.clave, []);
    // El motivo es obligatorio en un aplazado (constraint de la 021); el
    // fallback aquí es solo defensa de tipos, no un estado esperado.
    vivos.get(e.clave)!.push(e.motivoTexto ?? ETIQUETA_CLAVE[e.clave]);
  }

  // En orden estable de taxonomía, para que la ficha no baile entre lecturas.
  return CLAVES_APLAZADO.filter((c) => vivos.has(c)).map((clave) => ({
    clave,
    naturaleza: NATURALEZA_DE_CLAVE[clave],
    motivos: vivos.get(clave)!,
  }));
}
