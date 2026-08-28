"use client";

// Frontera de error de la sección Agenda (G2, §12): un fallo de render aquí
// no tumba la navegación del producto.

import { SeccionRota, type ErrorDeSeccion } from "../../components/ui/SeccionRota";

export default function Error({
  error,
  reset,
}: {
  error: ErrorDeSeccion;
  reset: () => void;
}) {
  return <SeccionRota seccion="Agenda" error={error} reset={reset} />;
}
