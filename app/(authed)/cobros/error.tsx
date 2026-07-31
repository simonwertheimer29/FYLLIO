"use client";

// Frontera de error de esta sección (2026-07-31). Ver el porqué en
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
  return <SeccionRota seccion="Cobros" error={error} reset={reset} />;
}
