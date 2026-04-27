// Panel de gestión — tarjetas clickables (Sprint 8 Bloque E).
// Toda la tarjeta es el área de click (sin botón separado), con hover que
// eleva la tarjeta y foco accesible para navegación por teclado.

import Image from "next/image";
import Link from "next/link";

type ClinicaCard = { id: string; nombre: string; ciudad: string | null };

export function LoginView({ clinicas }: { clinicas: ClinicaCard[] }) {
  return (
    <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Sprint 12 B — wordmark grande sustituye al logo tipográfico inline. */}
        <div className="text-center space-y-3">
          <Image
            src="/fyllio-wordmark.png"
            alt="Fyllio"
            width={220}
            height={64}
            priority
            className="mx-auto h-14 w-auto"
          />
          <p className="text-sm text-[var(--color-muted)] font-sans">Panel de gestión</p>
        </div>

        {/* Tarjeta Administrador — Sprint 12 H.1 estilo Linear. */}
        <Link
          href="/login/admin"
          className="block rounded-xl bg-white border border-[var(--color-border)] p-5 flex items-center gap-4 cursor-pointer transition-all duration-150 hover:border-sky-200 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
          aria-label="Entrar como Administrador"
        >
          <div className="w-11 h-11 shrink-0 rounded-lg bg-[var(--color-foreground)] text-white flex items-center justify-center text-lg">
            👤
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display text-sm font-semibold text-[var(--color-foreground)]">Administrador</p>
            <p className="text-xs text-[var(--color-muted)]">Todas las clínicas</p>
          </div>
          <span aria-hidden="true" className="text-[var(--color-muted)] text-lg">
            ›
          </span>
        </Link>

        {/* Separador clínicas */}
        {clinicas.length > 0 && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px bg-[var(--color-border)] flex-1" />
              <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-muted)]">
                Clínicas
              </span>
              <div className="h-px bg-[var(--color-border)] flex-1" />
            </div>

            <div className="space-y-2">
              {clinicas.map((c) => (
                <Link
                  key={c.id}
                  href={`/login/clinica/${c.id}`}
                  className="block rounded-xl bg-white border border-[var(--color-border)] p-5 flex items-center gap-4 cursor-pointer transition-all duration-150 hover:border-sky-200 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
                  aria-label={`Entrar como Coordinación ${c.nombre}`}
                >
                  <div className="w-11 h-11 shrink-0 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center text-lg">
                    🏥
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-sm font-semibold text-[var(--color-foreground)] truncate">{c.nombre}</p>
                    <p className="text-xs text-[var(--color-muted)] truncate">Coordinación {c.nombre}</p>
                  </div>
                  <span aria-hidden="true" className="text-[var(--color-muted)] text-lg">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        {clinicas.length === 0 && (
          <p className="text-xs text-center text-[var(--color-muted)]">
            No hay clínicas activas. Contacta con el administrador.
          </p>
        )}
      </div>
    </div>
  );
}
