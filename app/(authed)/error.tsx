"use client";

// Frontera de error del grupo `(authed)` — la red de seguridad de las
// secciones que aún no tienen la suya (o de un fallo en el propio layout de
// una). El header y la navegación siguen montados.

import { SeccionRota, type ErrorDeSeccion } from "../components/ui/SeccionRota";

export default function Error({
  error,
  reset,
}: {
  error: ErrorDeSeccion;
  reset: () => void;
}) {
  return <SeccionRota seccion="Esta pantalla" error={error} reset={reset} />;
}
