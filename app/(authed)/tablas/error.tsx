"use client";

// Frontera de error de la sección Tablas (F4b). Ver el porqué en
// components/ui/SeccionRota: sin esto, un fallo de render aquí tumbaba la
// navegación entera de la aplicación.

import { SeccionRota, type ErrorDeSeccion } from "../../components/ui/SeccionRota";

export default function Error({
  error,
  reset,
}: {
  error: ErrorDeSeccion;
  reset: () => void;
}) {
  return <SeccionRota seccion="Tablas" error={error} reset={reset} />;
}
