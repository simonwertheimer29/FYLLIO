// app/lib/presupuestos/intenciones.ts
//
// QUÉ SIGNIFICA cada intención para el negocio, en UN solo sitio.
//
// ─── El bug que lo trajo, medido ────────────────────────────────────────────
//
// El significado de cada intención estaba repartido en cinco literales sueltos:
// un `Set` en `dashboard-red`, un `Array.includes` en dos rutas, dos `===` en
// dos paneles. Añadir una categoría al enum **no rompía nada**: simplemente
// dejaba de contar en cada uno de esos sitios, en silencio.
//
// Cuánto cuesta ese silencio, medido en DEMO el 2026-08-06 sobre el titular
// «próximos a cierre sin acción» de /red:
//
//     hoy                                       3 casos · 5.900 €
//     si una categoría nueva absorbiera
//     «Acepta sin condiciones»                  1 caso  · 1.200 €   (−80 %)
//
// **El dinero en pantalla caía un 80 % sin que fallara nada**, sin excepción,
// sin log y sin test en rojo. Es la misma familia que la ventana rodante de
// julio: una cifra que se mueve sola y destruye la confianza en todas las demás.
//
// ─── Las dos garantías, y por qué hacen falta las dos ───────────────────────
//
// 1. **Tipo exhaustivo** (`Record<IntencionDetectada, …>`, no `Partial`): añadir
//    un valor al enum **rompe la compilación** aquí y obliga a decidir qué
//    significa. No es un comentario pidiendo que alguien se acuerde.
//
// 2. **Lectura por `deDiccionario`**: el valor llega de la BASE, así que el tipo
//    no garantiza nada — un seed o una migración pueden escribir cualquier cosa.
//    `deDiccionario` devuelve el fallback **y avisa una vez** (§12), en vez de
//    degradar mudo.

import type { IntencionDetectada } from "./types";
import { deDiccionario } from "../diccionario";

/**
 * ¿Esta intención significa que el caso está A PUNTO DE CERRAR?
 *
 * Lo consumen el titular de dinero de /red, la cola de intervención y la tabla
 * máxima. Si cambia aquí, cambia en los tres — que es el objetivo.
 */
export const ES_CIERRE: Record<IntencionDetectada, boolean> = {
  "Acepta sin condiciones": true,
  "Acepta pero pregunta pago": true,
  "Tiene duda sobre tratamiento": false,
  "Pide oferta/descuento": false,
  "Quiere pensarlo": false,
  Rechaza: false,
  "Sin clasificar": false,
};

/**
 * Peso de la intención en el score de urgencia (0-40). Antes vivía duplicado en
 * dos rutas con `?? 15` — dos copias que ya habían empezado a poder divergir.
 */
export const SCORE_INTENCION: Record<IntencionDetectada, number> = {
  "Acepta sin condiciones": 40,
  "Acepta pero pregunta pago": 40,
  "Pide oferta/descuento": 25,
  "Tiene duda sobre tratamiento": 20,
  "Sin clasificar": 15,
  "Quiere pensarlo": 10,
  Rechaza: 5,
};

/** El peso de un valor que la base tiene y el producto no conoce. */
const SCORE_DESCONOCIDA = 15;

// ─── Lectores ────────────────────────────────────────────────────────────────
// Aceptan `string` porque es lo que llega de la base. El casteo a
// `IntencionDetectada` que hacían los callers era una promesa que nadie cumplía.

export function esIntencionDeCierre(intencion: string | null | undefined): boolean {
  return deDiccionario(ES_CIERRE, intencion, false, "presupuestos.intencion_detectada (cierre)");
}

export function scoreDeIntencion(intencion: string | null | undefined): number {
  return deDiccionario(
    SCORE_INTENCION,
    intencion ?? "Sin clasificar",
    SCORE_DESCONOCIDA,
    "presupuestos.intencion_detectada (score)",
  );
}

/**
 * ¿Aceptó PERO preguntando por las condiciones de pago? Dispara una
 * recomendación concreta («envíale los detalles de pago»), no una prioridad —
 * por eso va aparte de `ES_CIERRE`, que sí agrupa.
 */
export const PREGUNTA_POR_EL_PAGO: Record<IntencionDetectada, boolean> = {
  "Acepta pero pregunta pago": true,
  "Acepta sin condiciones": false,
  "Tiene duda sobre tratamiento": false,
  "Pide oferta/descuento": false,
  "Quiere pensarlo": false,
  Rechaza: false,
  "Sin clasificar": false,
};

export function preguntaPorElPago(intencion: string | null | undefined): boolean {
  return deDiccionario(
    PREGUNTA_POR_EL_PAGO,
    intencion,
    false,
    "presupuestos.intencion_detectada (pregunta pago)",
  );
}
