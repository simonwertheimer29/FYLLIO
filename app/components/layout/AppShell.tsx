"use client";

// EL SHELL (fase F): barra vertical en TODA la app — el piloto en
// Seguimiento se aprobó el 23-08 y el condicional murió. Regla dictada al
// extender: TODA pantalla ocupa el ancho disponible (la barra ya cuesta
// espacio; el resto se aprovecha entero).
//
// MÓVIL (diagnóstico 23-08): la sidebar no cabe → patrón drawer, el mismo de
// Vercel/Supabase: barra superior mínima (hamburguesa + logo + campana) y la
// lista completa deslizante en overlay. Bottom-tabs se descartó: con 10
// entradas y grupos no caben. El drawer reutiliza EL MISMO SidebarNav.

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { SidebarNav } from "./SidebarNav";
import { Menu, X, ICON_STROKE } from "../icons";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const [drawer, setDrawer] = useState(false);

  // El drawer no sobrevive a una navegación (se cierra al cambiar de ruta).
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden">
      {/* Escritorio: la barra fija a la izquierda, nombres visibles. */}
      <aside className="hidden w-56 shrink-0 border-r border-[var(--color-border)] lg:block">
        <SidebarNav />
      </aside>

      {/* Móvil: top bar mínima + drawer. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 lg:hidden">
          <button
            type="button"
            aria-label="Abrir menú"
            onClick={() => setDrawer(true)}
            className="rounded-md p-1.5 text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
          >
            <Menu size={18} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
          <Link href="/" className="flex items-center gap-2" aria-label="Fyllio">
            <Image src="/isotipo.png" alt="Fyllio" width={24} height={24} className="h-6 w-6" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden flex flex-col">{children}</div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Cerrar menú"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawer(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="flex justify-end p-2">
              <button
                type="button"
                aria-label="Cerrar menú"
                onClick={() => setDrawer(false)}
                className="rounded-md p-1.5 text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              >
                <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </div>
            <div className="h-[calc(100%-2.5rem)]">
              <SidebarNav onNavegar={() => setDrawer(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
