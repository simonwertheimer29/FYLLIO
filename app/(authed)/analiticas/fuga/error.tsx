"use client";

// Frontera de error de esta sección (§12 del skill de ingeniería): sin esto,
// un fallo de render aquí tumbaría la navegación entera de la aplicación.

import { SeccionRota, type ErrorDeSeccion } from "../../../components/ui/SeccionRota";

export default function Error({ error, reset }: { error: ErrorDeSeccion; reset: () => void }) {
  return <SeccionRota seccion="Dónde se pierde" error={error} reset={reset} />;
}
