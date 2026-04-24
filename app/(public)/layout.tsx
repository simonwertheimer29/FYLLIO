// app/(public)/layout.tsx
// Envuelve la landing comercial y early-access con el header público
// (logo + nav + CTA). Separado del RootLayout para que las rutas de
// gestión interna (/login, /presupuestos, /no-shows, /dashboard, etc.)
// NO hereden esta navegación.

import Image from "next/image";
import TrackedCta from "@/components/TrackedCta";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const navH = 72;

  return (
    <div style={{ ["--nav-h" as any]: `${navH}px` }}>
      <header
        className="sticky top-0 z-50 border-b border-slate-200 bg-white"
        style={{ height: navH }}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center px-3 sm:px-6">
          {/* Logo */}
          <a href="/" className="flex items-center -ml-1">
            <div className="relative h-12 w-[300px] overflow-hidden">
              <Image
                src="/fyllio-wordmark.png"
                alt="FYLLIO"
                fill
                priority
                className="object-contain"
                style={{ transform: "scale(2.1) translateX(-10%)" }}
              />
            </div>
          </a>

          <div className="flex-1" />

          {/* Nav derecha */}
          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            <a href="#que-es" className="hover:text-slate-900">
              Sobre nosotros
            </a>
            <a href="#antes-despues" className="hover:text-slate-900">
              Por qué FYLLIO
            </a>
            <a href="#como-funciona" className="hover:text-slate-900">
              Cómo funciona
            </a>
          </nav>

          {/* CTA Navbar (trackeado) */}
          <TrackedCta
            href="#acceso"
            source="navbar"
            className="btn-fyllio ml-4 text-xs px-4 py-2"
          >
            Estoy interesado
          </TrackedCta>
        </div>
      </header>

      <div>{children}</div>
    </div>
  );
}
