"use client";

// Frontera de error de esta sección (§12b): sin esto, un fallo de render aquí
// tumbaría la navegación entera de la aplicación.

import { SeccionRota, type ErrorDeSeccion } from "../../components/ui/SeccionRota";

export default function Error({
  error,
  reset,
}: {
  error: ErrorDeSeccion;
  reset: () => void;
}) {
  return <SeccionRota seccion="Envíos" error={error} reset={reset} />;
}
