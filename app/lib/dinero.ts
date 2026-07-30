// El formateador de dinero de Fyllio, en un módulo PURO.
//
// `eur` nació en components/shared/Cifra.tsx y ese sigue siendo su sitio para
// la UI (`import { eur } from "…/shared/Cifra"` no cambia en ningún componente:
// Cifra lo reexporta). Pero Cifra es `"use client"`, y en cuanto una ruta de
// servidor necesitó formatear un importe —el aviso de "portal abierto"— habría
// tenido que importar un módulo de cliente desde el servidor.
//
// Regla ya pagada el 2026-07-29 con `tipos-paciente-puro.ts`, en el sentido
// contrario: si algo lo necesitan los dos lados, no puede compartir archivo con
// uno de los dos. La implementación es ÚNICA y vive aquí.

/** `useGrouping` explícito: es-ES omite el separador en los números de cuatro
 *  cifras, así que en una misma columna convivían "12.430 €" y "5100 €". */
export const eur = (n: number) =>
  n.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    useGrouping: true,
  });
