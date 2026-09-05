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
  | "dato_cita"
  | "duda_clinica"
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
  // OJO (C1-P1, 2026-08-14): precio_descuento solo aplaza cuando hay un
  // PRESUPUESTO EMITIDO que el paciente quiere mover. «¿Cuánto cuesta?» de un
  // lead nuevo se CONTESTA («depende de tu caso, te hacemos una valoración»).
  precio_descuento: "decision",
  plan_pago: "decision",
  cobertura_seguro: "decision",
  cambio_tratamiento: "decision",
  garantia_condiciones: "decision",
  dato_presupuesto: "dato_ausente",
  agenda_disponibilidad: "dato_ausente",
  /** 030 — dato de SU cita ya programada («¿cuándo era?», «¿a qué hora?»)
   *  que el sistema no ve en nivel 1. Se anota, jamás se inventa; con la
   *  agenda conectada (MEJORAS 97) constará y se contestará solo. */
  dato_cita: "dato_ausente",
  /** 022 — 9 de 69 casos anotados (R1+C1). Criterio del doctor: es la ÚNICA
   *  clave que NINGUNA configuración elimina (regla dura: el agente jamás da
   *  criterio clínico) — en el barrido de capacidades de la fase D no debe
   *  aparecer como hueco configurable. */
  duda_clinica: "decision",
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
  dato_cita: "Dato de su cita (día u hora)",
  duda_clinica: "Duda clínica (para el doctor)",
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

// ─── Vueltas (034, auditoría 2026-09-05) ─────────────────────────────────────
//
// El contador de insistencia contaba TODOS los `aplazado` de una clave, de
// toda la vida del hilo y uno por mensaje: una pregunta resuelta en junio
// seguía sumando en septiembre, y una ráfaga de tres mensajes en un minuto
// eran tres vueltas. Aquí se cuenta lo que la regla quiere decir: cuántas
// VECES ha vuelto la persona sobre el tema DESDE el último resuelto, y una
// ráfaga (aplazados a menos de `ventanaMs`) es una sola vuelta.

export type EventoConInstante = EventoAplazamiento;

export function vueltasPorClave(
  eventos: readonly EventoAplazamiento[],
  ventanaMs = 15 * 60_000,
): Partial<Record<ClaveAplazado, number>> {
  const ms = (t: string | number) => (typeof t === "number" ? t : new Date(t).getTime());
  const ultimoResuelto = new Map<ClaveAplazado, number>();
  for (const e of eventos) {
    if (e.evento !== "aplazado_resuelto") continue;
    const t = ms(e.createdAt);
    const previo = ultimoResuelto.get(e.clave);
    if (previo === undefined || t > previo) ultimoResuelto.set(e.clave, t);
  }
  const porClave = new Map<ClaveAplazado, number[]>();
  for (const e of eventos) {
    if (e.evento !== "aplazado") continue;
    const t = ms(e.createdAt);
    if (!Number.isFinite(t)) continue;
    const corte = ultimoResuelto.get(e.clave);
    if (corte !== undefined && t <= corte) continue;
    (porClave.get(e.clave) ?? porClave.set(e.clave, []).get(e.clave)!).push(t);
  }
  const out: Partial<Record<ClaveAplazado, number>> = {};
  for (const [clave, tiempos] of porClave) {
    tiempos.sort((a, b) => a - b);
    let vueltas = 0;
    let ultimo = -Infinity;
    for (const t of tiempos) {
      if (t - ultimo > ventanaMs) vueltas++;
      ultimo = t;
    }
    out[clave] = vueltas;
  }
  return out;
}
