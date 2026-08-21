// Ruta vieja de "Actuar hoy" → redirect permanente a /seguimiento.
// P4 (21-08): los parámetros viejos (?vista=, ?filtro=, ?cohorte= del
// vocabulario de cuatro/pipeline) ya no significan nada en la vista de tres
// cohortes — se descartan en vez de traducirse a medias. Un enlace guardado
// llega a la cola completa, que es donde está todo.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ActuarHoyRedirect() {
  redirect("/seguimiento");
}
