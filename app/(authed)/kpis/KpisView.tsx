"use client";

// Sprint 8 D.4 — sub-tabs Presupuestos / Leads + botón Exportar informe
// (reutiliza InformesView embebido en drawer).

import NextDynamic from "next/dynamic";
import { useState } from "react";
import type { UserSession } from "../../lib/presupuestos/types";
import KpiView from "../../components/presupuestos/KpiView";

// InformesView depende de dom-to-image-more → ssr:false (mismo fix que
// PresupuestosShell).
const InformesView = NextDynamic(
  () => import("../../components/presupuestos/InformesView"),
  { ssr: false }
);

type SubTab = "presupuestos" | "leads";

export function KpisView({ user, isAdmin }: { user: UserSession; isAdmin: boolean }) {
  const [tab, setTab] = useState<SubTab>("presupuestos");
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden">
      {/* Barra superior con tabs + botón exportar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1">
          <SubTabButton
            active={tab === "presupuestos"}
            onClick={() => setTab("presupuestos")}
            label="Presupuestos"
          />
          <SubTabButton
            active={tab === "leads"}
            onClick={() => setTab("leads")}
            label="Leads"
          />
        </div>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="rounded-full bg-violet-600 text-white text-xs font-bold px-3 py-1.5 hover:bg-violet-700"
        >
          Exportar informe
        </button>
      </div>

      {/* Contenido */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "presupuestos" && (
          <div className="p-4 lg:p-6">
            <KpiView user={user} showBenchmark={isAdmin} />
          </div>
        )}
        {tab === "leads" && <KpisLeadsPlaceholder />}
      </div>

      {exportOpen && (
        <ExportDrawer onClose={() => setExportOpen(false)} user={user} />
      )}
    </div>
  );
}

function SubTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active
          ? "bg-slate-900 text-white"
          : "bg-white text-slate-600 border border-slate-200 hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

function KpisLeadsPlaceholder() {
  return (
    <div className="p-8">
      <div className="max-w-xl mx-auto rounded-3xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm font-bold text-slate-800">KPIs de Leads</p>
        <p className="text-xs text-slate-500 mt-2">
          Próximamente: tasa de conversión por fuente, tiempo medio de primera respuesta,
          distribución por clínica y embudo de estados.
        </p>
      </div>
    </div>
  );
}

function ExportDrawer({
  onClose,
  user,
}: {
  onClose: () => void;
  user: UserSession;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl bg-white border-l border-slate-200 flex flex-col overflow-y-auto shadow-xl"
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">Exportar informe</h2>
            <p className="text-[11px] text-slate-500">PDF / PPT mensuales e informes semanales</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-auto">
          <InformesView user={user} />
        </div>
      </aside>
    </div>
  );
}
