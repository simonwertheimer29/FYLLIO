"use client";

// Navegación de Ajustes (2026-08-01).
//
// Vivía dentro del layout con Tailwind crudo —`bg-white`, `border-slate-200`,
// `text-slate-800`, `hover:bg-slate-100`— sin un solo `dark:`: en modo oscuro la
// barra era un rectángulo blanco. Era la última zona entera fuera del sistema de
// tokens del Sprint UI.
//
// Sale a componente propio por dos cosas que el layout, siendo servidor, no
// podía hacer: marcar la sección activa (`usePathname`) y ofrecer navegación en
// MÓVIL, donde la barra lateral era `hidden md:block` y simplemente no existía —
// desde un móvil no había forma de pasar de una sección a la otra.
//
// El comentario "siguientes secciones se añaden aquí" lleva desde el Sprint 7
// señalando este sitio; la fusión con /automatizaciones (MEJORAS 13) lo llenará.

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES = [
  { href: "/ajustes/clinica-equipo", label: "Clínica y equipo" },
  { href: "/ajustes/configuracion", label: "Configuración" },
];

export function AjustesNav() {
  const pathname = usePathname();
  const activa = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const clase = (href: string) =>
    `block rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
      activa(href)
        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        : "text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
    }`;

  return (
    <>
      {/* Escritorio: barra lateral */}
      <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:block">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          Ajustes
        </h2>
        <nav className="space-y-1">
          {SECCIONES.map((s) => (
            <Link key={s.href} href={s.href} className={clase(s.href)}>
              {s.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Móvil: la misma navegación en horizontal. Antes no había ninguna. */}
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 md:hidden">
        {SECCIONES.map((s) => (
          <Link key={s.href} href={s.href} className={`${clase(s.href)} whitespace-nowrap`}>
            {s.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
