"use client";

// Panel de gestión — tarjeta Administrador (botón "Entrar") + tarjetas de clínica
// (botón "PIN" que navega a /login/clinica/[id] con keypad).

import Link from "next/link";

type ClinicaCard = { id: string; nombre: string; ciudad: string | null };

export function LoginView({ clinicas }: { clinicas: ClinicaCard[] }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo + título */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-violet-600 text-white text-3xl font-extrabold shadow-lg">
            F
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Fyllio</h1>
          <p className="text-sm text-slate-500">Panel de gestión</p>
        </div>

        {/* Tarjeta Administrador */}
        <div className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-12 h-12 shrink-0 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl">
            👤
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">Administrador</p>
            <p className="text-xs text-slate-500">Todas las clínicas</p>
          </div>
          <Link
            href="/login/admin"
            className="rounded-xl bg-slate-900 text-white text-xs font-bold px-4 py-2 hover:bg-slate-800 transition-colors"
          >
            Entrar
          </Link>
        </div>

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
                <div
                  key={c.id}
                  className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 flex items-center gap-4"
                >
                  <div className="w-12 h-12 shrink-0 rounded-2xl bg-violet-100 text-violet-700 flex items-center justify-center text-xl">
                    🏥
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{c.nombre}</p>
                    <p className="text-xs text-slate-500 truncate">Coordinación {c.nombre}</p>
                  </div>
                  <Link
                    href={`/login/clinica/${c.id}`}
                    className="rounded-xl bg-violet-600 text-white text-xs font-bold px-4 py-2 hover:bg-violet-700 transition-colors"
                  >
                    PIN
                  </Link>
                </div>
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
