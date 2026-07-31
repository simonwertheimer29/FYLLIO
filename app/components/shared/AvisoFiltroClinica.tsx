"use client";

// "Estás viendo una sola clínica" — declarado EN LA PÁGINA (2026-07-31).
//
// EL PROBLEMA QUE RESUELVE. El selector de clínica de la cabecera persiste en
// localStorage, así que sobrevive a recargas y a cerrar la pestaña. Y /red hace
// dos cosas grandes cuando hay una clínica elegida: cambia TODAS las cifras y
// retira la tabla "Tus clínicas" (compararía una fila consigo misma, decisión
// del 2026-07-27). Una revisión externa cargó la pantalla dos veces con el
// filtro puesto sin saberlo y reportó "los euros cambian y desaparece una
// tarjeta entera" — leyó como avería lo que era el producto obedeciendo.
//
// LA REGLA QUE QUEDA: un estado persistido que cambia lo que se ve tiene que
// declararse en pantalla, no solo en el control que lo fija. El control cuenta
// lo que hiciste hace tres días; la página tiene que contar lo que estás
// viendo AHORA. Y la salida va aquí al lado, no de vuelta en el control.

import { Building2, X, ICON_STROKE } from "../icons";

export function AvisoFiltroClinica({
  nombre,
  onVerTodas,
  /** Qué deja de verse por tener el filtro puesto. Sin esto, la ausencia se lee
   *  como un fallo — que es exactamente lo que pasó. */
  ocultaAdemas,
}: {
  nombre: string;
  onVerTodas: () => void;
  ocultaAdemas?: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-4 py-3">
      <Building2
        size={16}
        strokeWidth={ICON_STROKE}
        className="shrink-0 text-[var(--color-accent)]"
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-[13px] text-[var(--color-accent)]">
        Estás viendo solo <strong className="font-semibold">{nombre}</strong>. Todas
        las cifras de esta pantalla son de esta clínica, no de la red.
        {ocultaAdemas && <span className="opacity-80"> {ocultaAdemas}</span>}
      </p>
      <button
        type="button"
        onClick={onVerTodas}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]"
      >
        <X size={13} strokeWidth={ICON_STROKE} aria-hidden />
        Ver toda la red
      </button>
    </div>
  );
}
