// app/lib/fetch-json.ts
//
// LA PIEZA QUE MATA `?? []`.
//
// El patrón que venimos pagando tres veces (401 en la cola de presupuestos,
// 401 en Cobros, y los ceros de /presupuestos del 2026-07-29) es siempre el
// mismo:
//
//     const d = await res.json();
//     setCosas(d.cosas ?? []);      // un 500 devuelve {error} → []
//     } catch { setCosas([]); }     // un fallo de red → []
//
// Y produce una pantalla que dice "no hay nada" cuando lo que pasa es que no
// se pudo preguntar. Para la coordinadora son indistinguibles, y la segunda es
// la que hace que deje de mirar.
//
// Este módulo es client-safe: sin imports de servidor, sin repos.

/** Error de carga con su causa legible: la UI la puede enseñar tal cual. */
export class ErrorDeCarga extends Error {
  readonly status: number | null;
  constructor(mensaje: string, status: number | null = null) {
    super(mensaje);
    this.name = "ErrorDeCarga";
    this.status = status;
  }
}

/**
 * `fetch` + JSON que **falla cuando hay que fallar**. Nunca devuelve un valor
 * por defecto: si algo va mal, lanza `ErrorDeCarga` y el caller decide qué
 * enseñar. Esa es toda la gracia — quitarle a cada pantalla la tentación de
 * poner `?? []`.
 *
 * Comprueba, en este orden:
 *   1. status HTTP (un 500 o un 401 son fallos, no listas vacías),
 *   2. que el cuerpo sea JSON,
 *   3. que el JSON no traiga un campo `error` (varias rutas lo mandan con 200),
 *   4. `validar`, si el caller pasa una: "esperaba una lista y vino otra cosa".
 */
export async function cargarJSON<T>(
  url: string,
  // `validar` es una comprobación EN TIEMPO DE EJECUCIÓN, no un type guard
  // completo: pedirle que demuestre el tipo entero obliga a escribir guardas
  // enormes y la gente acaba no poniendo ninguna.
  opciones: RequestInit & { validar?: (d: unknown) => boolean } = {},
): Promise<T> {
  const { validar, ...init } = opciones;

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ErrorDeCarga("Sin conexión con el servidor");
  }

  if (!res.ok) {
    // El cuerpo puede traer un mensaje útil; si no, el status ya dice bastante.
    const detalle = await res
      .json()
      .then((d) => (typeof d?.error === "string" ? d.error : null))
      .catch(() => null);
    throw new ErrorDeCarga(detalle ?? `El servidor respondió ${res.status}`, res.status);
  }

  let datos: unknown;
  try {
    datos = await res.json();
  } catch {
    throw new ErrorDeCarga("La respuesta del servidor no se pudo leer");
  }

  // Rutas que devuelven 200 con `{ error: "..." }`: el status miente, el
  // cuerpo no. Se cree al cuerpo.
  if (datos && typeof datos === "object" && typeof (datos as { error?: unknown }).error === "string") {
    throw new ErrorDeCarga((datos as { error: string }).error);
  }

  if (validar && !validar(datos)) {
    throw new ErrorDeCarga("El servidor devolvió algo que no esperábamos");
  }
  return datos as T;
}

/** Validador de uso constante: "esto tiene que traer una lista en `clave`". */
export function traeLista(clave: string) {
  return (d: unknown): boolean =>
    !!d && typeof d === "object" && Array.isArray((d as Record<string, unknown>)[clave]);
}

/** Texto para la UI. Siempre en lenguaje de coordinadora, nunca un stack. */
export function mensajeDeError(e: unknown): string {
  if (e instanceof ErrorDeCarga) return e.message;
  return "No se pudo cargar";
}
