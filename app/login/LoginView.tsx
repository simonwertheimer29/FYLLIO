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

        {/* Tarjeta Administrador — tarjeta entera clickable */}
        <Link
          href="/login/admin"
          className="block rounded-3xl bg-white border border-slate-200 shadow-sm p-5 flex items-center gap-4 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
          aria-label="Entrar como Administrador"
        >
          <div className="w-12 h-12 shrink-0 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl">
            👤
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">Administrador</p>
            <p className="text-xs text-slate-500">Todas las clínicas</p>
          </div>
          <span aria-hidden="true" className="text-slate-400 text-xl">
            ›
          </span>
        </Link>

        {/* Separador clínicas */}
        {clinicas.length > 0 && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px bg-slate-200 flex-1" />
              <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                Clínicas
              </span>
              <div className="h-px bg-slate-200 flex-1" />
            </div>

            <div className="space-y-3">
              {clinicas.map((c) => (
                <Link
                  key={c.id}
                  href={`/login/clinica/${c.id}`}
                  className="block rounded-3xl bg-white border border-slate-200 shadow-sm p-5 flex items-center gap-4 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
                  aria-label={`Entrar como Coordinación ${c.nombre}`}
                >
                  <div className="w-12 h-12 shrink-0 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center text-xl">
                    🏥
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{c.nombre}</p>
                    <p className="text-xs text-slate-500 truncate">Coordinación {c.nombre}</p>
                  </div>
                  <span aria-hidden="true" className="text-slate-400 text-xl">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        {clinicas.length === 0 && (
          <p className="text-xs text-center text-slate-500">
            No hay clínicas activas. Contacta con el administrador.
          </p>
        )}
      </div>
    </div>
  );
}
