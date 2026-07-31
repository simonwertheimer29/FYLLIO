"use client";

// Frontera de error de una sección (2026-07-31).
//
// POR QUÉ EXISTE: hasta hoy no había ni una en toda la aplicación. Un fallo de
// render en un widget —el crash de Automatizaciones → Operativo, un diccionario
// estado→color sin la clave que traía el dato— desmontaba el árbol ENTERO y
// dejaba la pantalla en blanco con el error genérico de Next: sin menú, sin
// cabecera, sin más salida que recargar escribiendo la URL a mano.
//
// Lo que cambia: `error.tsx` es la frontera nativa del App Router, y vive DENTRO
// del layout de su segmento. El header, el selector de clínica y la navegación
// siguen montados; lo único que se sustituye es el contenido de la sección rota.
// Una pantalla rota vuelve a ser una pantalla rota, no el producto caído.
//
// Honestidad (estándar visual §4): dice que falló ESTA sección, ofrece
// reintentar sin recargar (`reset()` re-renderiza el segmento) y deja irse a
// otra parte. Nunca se disfraza de vacío.
//
// Observabilidad (lecciones §9): un fallo que solo se ve en pantalla es un
// fallo que nadie arregla. El error se loguea con la sección y el `digest` que
// Next asigna, que es lo que permite encontrarlo después en los logs.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, ArrowRight, ICON_STROKE } from "../icons";

export type ErrorDeSeccion = Error & { digest?: string };

export function SeccionRota({
  seccion,
  error,
  reset,
}: {
  /** Nombre de la sección en lenguaje de coordinadora ("Automatizaciones"). */
  seccion: string;
  error: ErrorDeSeccion;
  reset: () => void;
}) {
  useEffect(() => {
    // Contexto suficiente para actuar: qué sección, qué error y el digest con
    // el que Next lo referencia en los logs de servidor.
    console.error(`[seccion-rota] ${seccion}`, {
      mensaje: error?.message,
      digest: error?.digest,
      stack: error?.stack,
    });
  }, [seccion, error]);

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)] p-4 lg:p-6">
      <div className="mx-auto max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
        <AlertTriangle
          size={22}
          strokeWidth={ICON_STROKE}
          className="mx-auto text-[var(--color-danger)]"
          aria-hidden
        />
        <h1 className="font-display mt-3 text-base font-semibold text-[var(--color-foreground)]">
          {seccion} no se ha podido mostrar
        </h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          El fallo es de esta pantalla; el resto de Fyllio sigue funcionando y
          tus datos están intactos. Vuelve a intentarlo, y si sigue igual pasa a
          otra sección desde el menú.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]"
          >
            <RefreshCw size={14} strokeWidth={ICON_STROKE} aria-hidden />
            Reintentar
          </button>
          <Link
            href="/red"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-muted)]"
          >
            Ir al panel
            <ArrowRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
