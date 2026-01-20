import "./globals.css";
import type { Metadata } from "next";
import Image from "next/image";
import Script from "next/script";
import TrackedCta from "@/components/TrackedCta";

export const metadata: Metadata = {
  title: "FYLLIO – La IA que ordena tu día en la clínica",
  description: "Asistente de agenda con IA para clínicas pequeñas e independientes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const navH = 72;
  const scrollOffset = navH + 32; // para que NO se corte al navegar por anchors

  return (
    <html
      lang="es"
      style={{
        ["--nav-h" as any]: `${navH}px`,
        scrollPaddingTop: `${scrollOffset}px`,
      }}
    >
      <head>
        <Script
          defer
          data-domain="fyllio-theta.vercel.app"
          src="https://plausible.io/js/pa-J8CRB6mQ3FNWuXSX8H7tf.js"
        />
      </head>

      <body className="bg-white text-slate-900 overflow-x-hidden">
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
      </body>
    </html>
  );
}
