"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { NoShowsUserSession } from "../../lib/no-shows/types";
import {
  Building2,
  AlertTriangle,
  Calendar,
  Check,
  BarChart3,
  ClipboardList,
  Settings,
  Target,
  ICON_STROKE,
} from "../icons";
import HoyView from "./HoyView";
import RiesgoView from "./RiesgoView";
import AgendaView from "./AgendaView";
import AccionesView from "./AccionesView";
import KpiView from "./KpiView";
import InformesView from "./InformesView";
import ConfigView from "./ConfigView";
import MotorView from "./MotorView";

type Tab = "hoy" | "riesgo" | "agenda" | "acciones" | "kpis" | "informes" | "config" | "motor";
const VALID_TABS: Tab[] = ["hoy", "riesgo", "agenda", "acciones", "kpis", "informes", "config", "motor"];

// ─── Main Shell ───────────────────────────────────────────────────────────────

export default function NoShowsShell({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const isEncargada = user.rol === "encargada_ventas";

  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : (isManager ? "riesgo" : "hoy")
  );

  const TABS: { id: Tab; label: string; icon: LucideIcon }[] = isManager
    ? [
        { id: "hoy",      label: "Hoy",           icon: Building2 },
        { id: "riesgo",   label: "Riesgo",        icon: AlertTriangle },
        { id: "agenda",   label: "Agenda",        icon: Calendar },
        { id: "acciones", label: "Acciones",      icon: Check },
        { id: "kpis",     label: "KPIs",          icon: BarChart3 },
        { id: "informes", label: "Informes",      icon: ClipboardList },
        { id: "config",   label: "Configuración", icon: Settings },
        { id: "motor",    label: "Motor",         icon: Target },
      ]
    : isEncargada
    ? [
        { id: "hoy",      label: "Hoy",      icon: Building2 },
        { id: "riesgo",   label: "Riesgo",   icon: AlertTriangle },
        { id: "agenda",   label: "Agenda",   icon: Calendar },
        { id: "acciones", label: "Acciones", icon: Check },
        { id: "kpis",     label: "KPIs",     icon: BarChart3 },
        { id: "motor",    label: "Motor",    icon: Target },
      ]
    : [
        // ventas
        { id: "hoy",      label: "Hoy",      icon: Building2 },
        { id: "riesgo",   label: "Riesgo",   icon: AlertTriangle },
        { id: "agenda",   label: "Agenda",   icon: Calendar },
        { id: "acciones", label: "Acciones", icon: Check },
      ];

  // Bottom nav mobile — primeras 4 tabs
  const BOTTOM_TABS = TABS.slice(0, 4);

  // Logout movido al GlobalHeader (Sprint 7 Fase 4).

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      {/* Barra del área (Sprint 7 Fase 4). Logo, usuario, rol, selector y
          Salir viven en el GlobalHeader del layout (authed). */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 shrink-0">
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">No-Shows</h1>
      </div>

      {/* ── Tabs desktop ── */}
      <div className="hidden lg:block bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 shrink-0">
        <div className="flex gap-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === t.id
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
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
        {tab === "motor"    && <MotorView user={user} />}
      </main>

      {/* ── Bottom Navigation mobile/tablet ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--color-surface)] border-t border-[var(--color-border)] flex items-stretch h-16">
        {BOTTOM_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors min-h-[44px] ${
                tab === t.id
                  ? "text-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden />
              <span className="hidden sm:block">{t.label}</span>
            </button>
          );
        })}
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
              TABS.slice(4).some((t) => t.id === tab)
                ? "text-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
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
