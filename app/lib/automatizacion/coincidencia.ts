// app/lib/automatizacion/coincidencia.ts
//
// La tasa de coincidencia agente-humano: cuando la coordinadora envía un mensaje
// que preparó el agente, ¿salió tal cual, editado o reescrito?
//
// PARA QUÉ SIRVE, que es lo que decide cómo se mide: es el criterio objetivo que
// dice cuándo se puede subir de modo A a modo B. Sin ella, subir es una
// corazonada — y la corazonada se toma justo cuando más ilusión hace y menos
// evidencia hay.
//
// MÓDULO PURO y client-safe.
//
// ─── La decisión que ordena este archivo ────────────────────────────────────
//
// Se guarda LA MEDIDA (un número en [0,1]), no la categoría. `tal_cual` /
// `editado` / `reescrito` se derivan al leer, con un umbral que hay que CALIBRAR
// con datos reales. Si se guardara la categoría y el umbral resultara malo, el
// histórico estaría perdido y habría que empezar a medir de cero; guardando la
// medida se recalcula entero. Misma lección que el umbral en días frente al
// umbral en milisegundos.

/**
 * Normaliza antes de comparar. Esto es lo que evita el falso positivo del spec:
 * un espacio de más o un acento NO son una edición.
 *
 * Qué se neutraliza, y por qué cada cosa:
 *  · mayúsculas — «Hola» y «hola» no son una decisión editorial distinta.
 *  · acentos — se escriben o no según el teclado y la prisa, no según criterio.
 *  · espacios, saltos y tabuladores — colapsan a uno solo.
 *  · comillas tipográficas y guiones — los mete el sistema operativo, no la
 *    persona: «"» frente a «"» sería una edición fantasma en cada mensaje.
 *  · puntuación final — un punto de más al terminar no cambia el mensaje.
 */
export function normalizarParaComparar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // acentos
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'") // comillas simples tipográficas
    .replace(/[“”‟″]/g, '"') // comillas dobles tipográficas
    .replace(/[‐-―−]/g, "-") // guiones y menos
    .replace(/ /g, " ") // espacio duro
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?\s]+$/u, "")
    .trim();
}

/**
 * Distancia de Levenshtein. Implementación de dos filas: O(n) de memoria, que
 * importa porque esto corre en el camino de un envío y no en un batch.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  let actual = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    actual[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const coste = ca === b.charCodeAt(j - 1) ? 0 : 1;
      actual[j] = Math.min(actual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + coste);
    }
    [anterior, actual] = [actual, anterior];
  }
  return anterior[b.length];
}

export type MedidaCoincidencia = {
  /**
   * Distancia normalizada en [0,1]. 0 = salió tal cual tras normalizar.
   * `null` cuando NO se puede medir — ver `medible`.
   */
  distancia: number | null;
  /** Largo del sugerido normalizado. Para auditar después si el umbral se
   *  comporta distinto en mensajes cortos, donde una palabra pesa mucho más. */
  largoSugerido: number;
  /**
   * `false` cuando no había mensaje sugerido: ese envío **no entra en el
   * denominador**. Un mensaje escrito de cero por la coordinadora, sin que el
   * agente propusiera nada, no dice nada sobre si el agente acierta — contarlo
   * como «reescrito» hundiría la tasa con envíos que el agente nunca intentó.
   */
  medible: boolean;
};

/**
 * Mide un envío. `sugerido` es lo que el agente dejó en `mensaje_sugerido`;
 * `enviado` es lo que la coordinadora mandó de verdad.
 */
export function medirCoincidencia(
  sugerido: string | null | undefined,
  enviado: string | null | undefined,
): MedidaCoincidencia {
  const s = normalizarParaComparar(sugerido ?? "");
  const e = normalizarParaComparar(enviado ?? "");

  if (!s) return { distancia: null, largoSugerido: 0, medible: false };

  // Enviado vacío con sugerido presente no debería ocurrir (la ruta exige
  // contenido), pero si ocurre es un descarte total, no un dato ausente.
  if (!e) return { distancia: 1, largoSugerido: s.length, medible: true };

  const bruta = levenshtein(s, e);
  // Se divide por el MÁS LARGO de los dos: si no, alargar el mensaje al doble
  // daría distancia > 1, y añadir texto es una edición tan real como quitarlo.
  const distancia = Math.min(1, bruta / Math.max(s.length, e.length));

  return {
    distancia: Math.round(distancia * 1000) / 1000, // 3 decimales: lo que guarda la columna
    largoSugerido: s.length,
    medible: true,
  };
}

// ─── Derivación de la categoría (en la LECTURA, no en la escritura) ──────────

export type CategoriaCoincidencia = "tal_cual" | "editado" | "reescrito";

/**
 * Umbral PROVISIONAL, y está escrito aquí para que se pueda cambiar en un sitio
 * cuando haya datos reales que lo calibren. Hoy es un juicio, no una medida:
 *  · 0      → salió tal cual (idéntico tras normalizar).
 *  · ≤ 0.30 → editado: se cambió el tono, un dato, una frase.
 *  · > 0.30 → reescrito: la coordinadora no aprovechó lo que el agente propuso.
 *
 * NO se persiste ninguna de estas tres palabras. Si el 0.30 resulta estar mal,
 * se cambia esta constante y todo el histórico se reinterpreta solo.
 */
export const UMBRAL_EDITADO = 0.3;

export function categoriaDe(distancia: number): CategoriaCoincidencia {
  if (distancia === 0) return "tal_cual";
  return distancia <= UMBRAL_EDITADO ? "editado" : "reescrito";
}

export const ETIQUETA_COINCIDENCIA: Record<CategoriaCoincidencia, string> = {
  tal_cual: "Enviado tal cual",
  editado: "Editado",
  reescrito: "Reescrito",
};

export type ResumenCoincidencia = {
  total: number;
  talCual: number;
  editado: number;
  reescrito: number;
  /** Porcentaje enviado tal cual, 0-100. `null` si no hay ni un envío medible. */
  tasaTalCual: number | null;
};

/** Agrega una lista de distancias medibles. El denominador es `total`, que ya
 *  excluye los no medibles porque nunca llegan aquí. */
export function resumirCoincidencia(distancias: readonly number[]): ResumenCoincidencia {
  const total = distancias.length;
  let talCual = 0, editado = 0, reescrito = 0;
  for (const d of distancias) {
    const c = categoriaDe(d);
    if (c === "tal_cual") talCual++;
    else if (c === "editado") editado++;
    else reescrito++;
  }
  return {
    total,
    talCual,
    editado,
    reescrito,
    tasaTalCual: total === 0 ? null : Math.round((talCual / total) * 100),
  };
}
