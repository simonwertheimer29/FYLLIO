// Sprint 13 Bloque 3 — Login premium.
// Wordmark grande, cards generosas, layout con respiración estilo Linear.

import Image from "next/image";
import Link from "next/link";
import { User as UserIcon, Building2, ChevronRight } from "../components/icons";

type ClinicaCard = { id: string; nombre: string; ciudad: string | null };

export function LoginView({ clinicas }: { clinicas: ClinicaCard[] }) {
  return (
    <div className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-between p-6">
      <div className="flex-1 flex items-center justify-center w-full">
        <div className="w-full max-w-2xl space-y-12">
          {/* Wordmark — escala mayor, respiración generosa. */}
          <div className="text-center space-y-4 mt-12">
            <Image
              src="/fyllio-wordmark.png"
              alt="Fyllio"
              width={320}
              height={96}
              priority
              className="mx-auto h-20 w-auto"
            />
            <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)] tracking-tight">
              Accede a tu clínica
            </h1>
          </div>

          {/* Tarjeta Administrador — generosa. */}
          <Link
            href="/login/admin"
            style={{
              borderColor: "var(--card-border)",
              boxShadow: "var(--card-shadow-rest)",
            }}
            className="block min-h-24 rounded-xl bg-[var(--color-surface)] border p-6 flex items-center gap-5 cursor-pointer transition-[box-shadow,border-color] duration-150 hover:[border-color:var(--card-border-hover)] hover:[box-shadow:var(--card-shadow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]"
            aria-label="Entrar como Administrador"
          >
            <div className="w-14 h-14 shrink-0 rounded-xl bg-[var(--color-foreground)] text-[var(--color-background)] flex items-center justify-center">
              <UserIcon size={22} strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display text-lg font-semibold text-[var(--color-foreground)] tracking-tight">
                Administrador
              </p>
              <p className="text-sm text-[var(--color-muted)]">Todas las clínicas</p>
            </div>
            <ChevronRight size={20} strokeWidth={1.5} className="text-[var(--color-muted)]" />
          </Link>

          {/* Separador clínicas. */}
          {clinicas.length > 0 && (
            <>
              <div className="flex items-center gap-3 my-10">
                <div className="h-px bg-[var(--color-border)] flex-1" />
                <span className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-muted)]">
                  Clínicas
                </span>
                <div className="h-px bg-[var(--color-border)] flex-1" />
              </div>

              <div className="space-y-3">
                {clinicas.map((c) => (
                  <Link
                    key={c.id}
                    href={`/login/clinica/${c.id}`}
                    style={{
                      borderColor: "var(--card-border)",
                      boxShadow: "var(--card-shadow-rest)",
                    }}
                    className="block min-h-24 rounded-xl bg-[var(--color-surface)] border p-6 flex items-center gap-5 cursor-pointer transition-[box-shadow,border-color] duration-150 hover:[border-color:var(--card-border-hover)] hover:[box-shadow:var(--card-shadow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]"
                    aria-label={`Entrar como Coordinación ${c.nombre}`}
                  >
                    <div className="w-12 h-12 shrink-0 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center">
                      <Building2 size={20} strokeWidth={1.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-lg font-semibold text-[var(--color-foreground)] truncate tracking-tight">
                        {c.nombre}
                      </p>
                      <p className="text-sm text-[var(--color-muted)] truncate">
                        Coordinación {c.nombre}
                      </p>
                    </div>
                    <ChevronRight
                      size={20}
                      strokeWidth={1.5}
                      className="text-[var(--color-muted)] shrink-0"
                    />
                  </Link>
                ))}
              </div>
            </>
          )}

          {clinicas.length === 0 && (
            <p className="text-sm text-center text-[var(--color-muted)]">
              No hay clínicas activas. Contacta con el administrador.
            </p>
          )}
        </div>
      </div>

      {/* Footer sutil. */}
      <p className="text-xs text-[var(--color-muted)] mt-12">Fyllio · CRM dental</p>
    </div>
  );
}
