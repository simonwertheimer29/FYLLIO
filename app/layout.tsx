import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import { Toaster } from "sonner";
import { Inter, Geist } from "next/font/google";

// Sprint 12 A — tipografías:
//  - Geist  → display (títulos, números KPI, headers).
//  - Inter  → body (UI, tablas, párrafos).
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});
const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

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
      className={`${inter.variable} ${geist.variable}`}
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
