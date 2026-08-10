"use client";

// La cáscara de cliente de /informes. `InformesView` depende de
// `dom-to-image-more`, que toca `window`, así que entra con ssr:false — el
// mismo motivo por el que ya lo hacía en /kpis y en PresupuestosShell.

import NextDynamic from "next/dynamic";
import type { UserSession } from "../../lib/presupuestos/types";

const InformesView = NextDynamic(
  () => import("../../components/presupuestos/InformesView"),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3 p-4 lg:p-6 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-[var(--color-surface-muted)]" />
        ))}
      </div>
    ),
  },
);

export function InformesCliente({ user }: { user: UserSession }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--color-background)]">
      <header className="px-4 lg:px-6 pt-4 lg:pt-6">
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
          Informe mensual
        </h1>
        <p className="text-[11px] text-[var(--color-muted)] mt-0.5">
          Se genera por mes de calendario. Los informes que guardes quedan aquí.
        </p>
      </header>
      {/* El padding lo pone la pantalla, no el componente: `InformesView` nunca
          lo tuvo — lo heredaba del cajón que lo envolvía en /kpis, y al sacarlo
          se quedaba pegado al borde izquierdo. */}
      <div className="px-4 lg:px-6 pb-8">
        <InformesView user={user} />
      </div>
    </div>
  );
}
