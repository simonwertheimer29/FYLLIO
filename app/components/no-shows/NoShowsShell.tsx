"use client";

import { useState } from "react";
import type { NoShowsUserSession } from "../../lib/no-shows/types";

type Tab = "hoy" | "riesgo" | "agenda" | "acciones" | "kpis" | "informes" | "config";

const ROLE_LABEL: Record<NoShowsUserSession["rol"], string> = {
  manager_general:  "Manager",
  encargada_ventas: "Encargada",
  ventas:           "Ventas",
};

// ─── Stub placeholders para fases futuras ────────────────────────────────────

function StubView({ tab, emoji, fase }: { tab: string; emoji: string; fase: number }) {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center">
      <div className="text-center space-y-3 p-8 max-w-xs">
        <p className="text-4xl">{emoji}</p>
        <p className="text-base font-bold text-slate-800">{tab}</p>
        <p className="text-xs text-slate-400 leading-relaxed">
          Esta sección se implementa en FASE {fase}.
        </p>
        <div className="inline-block px-3 py-1 rounded-full bg-cyan-50 border border-cyan-200 text-xs font-semibold text-cyan-700">
          En construcción
        </div>
      </div>
    </div>
  );
}

// ─── Main Shell ───────────────────────────────────────────────────────────────

export default function NoShowsShell({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const isEncargada = user.rol === "encargada_ventas";

  const [tab, setTab] = useState<Tab>(isManager ? "riesgo" : "hoy");

  const TABS: { id: Tab; label: string; icon: string }[] = isManager
    ? [
        { id: "hoy",      label: "Hoy",      icon: "🏥" },
        { id: "riesgo",   label: "Riesgo",   icon: "⚠️" },
        { id: "agenda",   label: "Agenda",   icon: "📅" },
        { id: "acciones", label: "Acciones", icon: "✓" },
        { id: "kpis",     label: "KPIs",     icon: "📊" },
        { id: "informes", label: "Informes", icon: "📋" },
        { id: "config",   label: "Config",   icon: "⚙" },
      ]
    : isEncargada
    ? [
        { id: "hoy",      label: "Hoy",      icon: "🏥" },
        { id: "riesgo",   label: "Riesgo",   icon: "⚠️" },
        { id: "agenda",   label: "Agenda",   icon: "📅" },
        { id: "acciones", label: "Acciones", icon: "✓" },
        { id: "kpis",     label: "KPIs",     icon: "📊" },
      ]
    : [
        // ventas
        { id: "hoy",      label: "Hoy",      icon: "🏥" },
        { id: "riesgo",   label: "Riesgo",   icon: "⚠️" },
        { id: "agenda",   label: "Agenda",   icon: "📅" },
        { id: "acciones", label: "Acciones", icon: "✓" },
      ];

  // Bottom nav mobile — primeras 4 tabs
  const BOTTOM_TABS = TABS.slice(0, 4);

  async function handleLogout() {
    await fetch("/api/no-shows/auth/logout", { method: "POST" });
    location.href = "/no-shows/login";
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 overflow-hidden shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/fyllio-wordmark.png"
              alt="Fyllio"
              className="h-8 w-auto"
              style={{ maxWidth: "none" }}
            />
          </div>
          <div className="border-l border-slate-200 pl-3">
            <p className="text-xs font-bold text-slate-900 leading-tight">No-Shows</p>
            <p className="text-[10px] text-slate-400">
              {user.clinica ?? "Todas las clínicas"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block text-right mr-1">
            <p className="text-xs font-semibold text-slate-700">{user.nombre}</p>
            <p className="text-[10px] text-slate-400">{ROLE_LABEL[user.rol]}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          >
            Salir
          </button>
        </div>
      </header>

      {/* ── Tabs desktop ── */}
      <div className="hidden lg:block bg-white border-b border-slate-200 px-4 shrink-0">
        <div className="flex gap-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === t.id
                  ? "border-cyan-600 text-cyan-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <main className="flex-1 min-h-0 overflow-auto flex flex-col p-4 gap-4 w-full pb-20 lg:pb-4">
        {tab === "hoy"      && <StubView tab="HOY"      emoji="🏥" fase={2} />}
        {tab === "riesgo"   && <StubView tab="RIESGO"   emoji="⚠️" fase={2} />}
        {tab === "agenda"   && <StubView tab="AGENDA"   emoji="📅" fase={3} />}
        {tab === "acciones" && <StubView tab="ACCIONES" emoji="✓"  fase={3} />}
        {tab === "kpis"     && <StubView tab="KPIs"     emoji="📊" fase={4} />}
        {tab === "informes" && <StubView tab="INFORMES" emoji="📋" fase={5} />}
        {tab === "config"   && <StubView tab="CONFIG"   emoji="⚙"  fase={6} />}
      </main>

      {/* ── Bottom Navigation mobile/tablet ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 flex items-stretch h-16">
        {BOTTOM_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors min-h-[44px] ${
              tab === t.id
                ? "text-cyan-700 bg-cyan-50"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            <span className="hidden sm:block">{t.label}</span>
          </button>
        ))}
        {/* Overflow button — accede a tabs adicionales */}
        {TABS.length > 4 && (
          <button
            onClick={() => {
              const extraTabs = TABS.slice(4);
              const currentIdx = extraTabs.findIndex((t) => t.id === tab);
              const next = currentIdx >= 0
                ? extraTabs[(currentIdx + 1) % extraTabs.length]
                : extraTabs[0];
              setTab(next.id);
            }}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors min-h-[44px] ${
              ["kpis", "informes", "config"].includes(tab)
                ? "text-cyan-700 bg-cyan-50"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <span className="text-xl leading-none font-light">···</span>
            <span className="hidden sm:block">Más</span>
          </button>
        )}
      </nav>
    </div>
  );
}
