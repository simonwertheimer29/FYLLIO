import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Geist } from "next/font/google";
import { AppToaster } from "./components/layout/AppToaster";

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
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-icon.png",
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
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
        {/* Sprint UI — aplica el tema guardado antes del primer paint
            (evita el destello claro→oscuro). Por defecto: claro. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("fyllio.theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}',
          }}
        />
        <Script
          defer
          data-domain="fyllio-theta.vercel.app"
          src="https://plausible.io/js/script.js"
        />
      </head>

      <body className="bg-[var(--color-background)] text-[var(--color-foreground)] overflow-x-hidden">
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
