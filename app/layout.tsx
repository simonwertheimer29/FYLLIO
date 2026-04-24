import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "FYLLIO – La IA que ordena tu día en la clínica",
  description: "Asistente de agenda con IA para clínicas pequeñas e independientes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Scroll offset global para anchors, lo necesita también la landing.
  const navH = 72;
  const scrollOffset = navH + 32;

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
          src="https://plausible.io/js/script.js"
        />
      </head>

      <body className="bg-white text-slate-900 overflow-x-hidden">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
