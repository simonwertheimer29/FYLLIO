"use client";

// Frontera de error de la bandeja (§12b): un fallo de render en una burbuja no
// puede desmontar el árbol y dejar a la coordinadora sin menú.

import { ErrorState } from "../../components/ui/Feedback";

export default function MensajeriaError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--color-background)] p-4 lg:p-6">
      <ErrorState
        title="No se pudo montar la bandeja"
        detail="Vuelve a intentarlo. Ningún mensaje se pierde por esto: la conversación está guardada."
        onRetry={reset}
      />
    </div>
  );
}
