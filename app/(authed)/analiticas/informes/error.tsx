"use client";

// Frontera de error de /informes (§12b): un fallo al renderizar una gráfica no
// puede desmontar el árbol y dejar al usuario sin menú, con la URL como única
// salida. Esta pantalla monta gráficas y captura nodos a PNG, así que tiene más
// superficie de fallo de render que la media.

import { ErrorState } from "../../../components/ui/Feedback";

export default function InformesError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--color-background)] p-4 lg:p-6">
      <ErrorState
        title="No se pudo montar el informe"
        detail="Vuelve a intentarlo. Si sigue fallando, el historial de informes guardados no se ha perdido."
        onRetry={reset}
      />
    </div>
  );
}
