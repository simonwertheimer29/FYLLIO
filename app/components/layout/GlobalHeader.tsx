"use client";

// app/components/layout/GlobalHeader.tsx
//
// Header global de rutas autenticadas (Sprint 7 Fase 4). Sin rediseño visual:
// funcional, limpio, respeta Tailwind puro. El rediseño unificado vive en
// Sprint 8.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useClinic } from "../../lib/context/ClinicContext";
import { ClinicSelector } from "./ClinicSelector";

export function GlobalHeader() {
  const router = useRouter();
  const { session } = useClinic();
  const [loggingOut, setLoggingOut] = useState(false);

  const rolLabel = session.rol === "admin" ? "Administrador" : "Coordinación";

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Limpia la clínica persistida para evitar arrastrar selección entre sesiones.
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("fyllio.selectedClinicaId");
        } catch {}
      }
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-3 sm:px-6">
        {/* Logo */}
        <div className="flex items-center gap-2 font-extrabold text-slate-900 tracking-tight">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-violet-600 text-white text-sm">
            F
          </span>
          <span className="text-base">Fyllio</span>
        </div>

        {/* Selector de clínica */}
        <div className="flex-1 min-w-0">
          <ClinicSelector />
        </div>

        {/* Usuario + rol + salir */}
        <div className="flex items-center gap-3 text-xs">
          <div className="hidden sm:block text-right leading-tight">
            <p className="font-semibold text-slate-900 truncate max-w-[220px]">
              {session.nombre}
            </p>
            <p className="text-slate-500">{rolLabel}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {loggingOut ? "Saliendo…" : "Salir"}
          </button>
        </div>
      </div>
    </header>
  );
}
