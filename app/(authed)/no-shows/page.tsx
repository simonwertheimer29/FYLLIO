// app/(authed)/no-shows/page.tsx
//
// Módulo congelado (MEJORAS 39 + 44, 2026-07-27). La zona vivía sobre Airtable
// y llevaba parada desde el Sprint B: sus rutas ya respondían 401 contra unas
// tablas vacías. Al retirar Airtable se congela de forma explícita, en vez de
// dejar una pantalla que finge funcionar.
//
// Lo que NO se toca y sigue vivo: el motor predictivo (lib/no-shows/predictor,
// lib/no-shows/score) y sus tablas de analítica en Supabase
// (eventos_comportamentales, factores_no_show, patrones_aprendidos), que se
// siguen alimentando desde la agenda. Lo congelado es la interfaz vieja.
//
// La entrada tampoco está en el nav: un módulo que no funciona no ocupa sitio
// en la barra. Vuelve cuando la zona se reconstruya sobre Postgres.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth/session";
import { EmptyState } from "../../components/ui/Feedback";
import { CalendarClock, ICON_STROKE } from "../../components/icons";

export const dynamic = "force-dynamic";

export default async function NoShowsPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] p-6 gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
          No-shows
        </h1>
        <p className="text-xs text-[var(--color-muted)] mt-0.5">Módulo en reconstrucción</p>
      </div>

      <div className="flex-1 flex items-start justify-center pt-8">
        <EmptyState
          className="max-w-md"
          icon={<CalendarClock size={24} strokeWidth={ICON_STROKE} />}
          title="Estamos reconstruyendo este módulo"
          hint="Mientras tanto Fyllio sigue midiendo qué citas tienen riesgo de fallar: esos datos se guardan y estarán aquí cuando el módulo vuelva. No hay que hacer nada."
          action={
            <Link
              href="/seguimiento"
              className="inline-flex items-center rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold px-4 py-2 hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              Ir a Seguimiento
            </Link>
          }
        />
      </div>
    </div>
  );
}
