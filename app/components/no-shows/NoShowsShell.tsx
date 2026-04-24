"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { NoShowsUserSession } from "../../lib/no-shows/types";
import HoyView from "./HoyView";
import RiesgoView from "./RiesgoView";
import AgendaView from "./AgendaView";
import AccionesView from "./AccionesView";
import KpiView from "./KpiView";
import InformesView from "./InformesView";
import ConfigView from "./ConfigView";

type Tab = "hoy" | "riesgo" | "agenda" | "acciones" | "kpis" | "informes" | "config";
const VALID_TABS: Tab[] = ["hoy", "riesgo", "agenda", "acciones", "kpis", "informes", "config"];

// ─── Main Shell ───────────────────────────────────────────────────────────────

export default function NoShowsShell({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const isEncargada = user.rol === "encargada_ventas";

  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : (isManager ? "riesgo" : "hoy")
  );

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

  // Logout movido al GlobalHeader (Sprint 7 Fase 4).

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden">
      {/* Barra del área (Sprint 7 Fase 4). Logo, usuario, rol, selector y
          Salir viven en el GlobalHeader del layout (authed). */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 shrink-0">
        <p className="text-xs font-bold text-slate-900">No-Shows</p>
      </div>

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
        {tab === "hoy"      && <HoyView user={user} />}
        {tab === "riesgo"   && <RiesgoView user={user} />}
        {tab === "agenda"   && <AgendaView user={user} />}
        {tab === "acciones" && <AccionesView user={user} />}
        {tab === "kpis"     && <KpiView user={user} />}
        {tab === "informes" && <InformesView user={user} />}
        {tab === "config"   && <ConfigView user={user} />}
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
