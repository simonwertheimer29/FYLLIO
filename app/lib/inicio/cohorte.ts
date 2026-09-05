// Reglas de la COHORTE de presupuestos — módulo PURO, sin dependencias.
//
// Viven aquí y no en `dashboard-red.ts` por una razón que costó un build de
// producción (06-09-2026): `InicioView` (cliente) importó estas dos constantes
// como valor desde dashboard-red, y con ellas se llevó al bundle del navegador
// el módulo entero — `db/context`, `kysely`, `pg`, `async_hooks`. `tsc` no lo
// ve (los tipos compilan igual); solo lo ve `next build`. Un `import type` se
// borra al compilar; un `import { const }` arrastra el archivo completo. Todo
// lo que un componente de cliente necesite como VALOR tiene que salir de un
// módulo como este: sin nada de servidor detrás.

/** Denominador mínimo para que un porcentaje se pinte como señal (y para que
 *  una clínica pueda encabezar el ranking de caídas). Con 2 presupuestos, un
 *  100 % es ruido con autoridad. */
export const BASE_MINIMA_COHORTE = 5;

/** Parte de la cohorte que puede seguir abierta sin invalidar la comparación. */
export const UMBRAL_COHORTE_ABIERTA = 0.2;

/** ¿La cohorte del mes ya dice algo? Base mínima Y no más del 20 % todavía
 *  abierto. La primera semana de cada mes casi todo está abierto y un «0 %» se
 *  lee como «no vende» (MEJORAS 156). Misma regla que `conversionDe` en el
 *  bloque de negocio. */
export function cohorteComparable(c: { presentadosMes: number; abiertosMes: number }): boolean {
  return c.presentadosMes >= BASE_MINIMA_COHORTE && c.abiertosMes / c.presentadosMes <= UMBRAL_COHORTE_ABIERTA;
}
