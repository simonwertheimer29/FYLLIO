"use client";

// Sprint 8 D.4 — sub-tabs Presupuestos / Leads + botón Exportar informe
// (reutiliza InformesView embebido en drawer).

import NextDynamic from "next/dynamic";
import { useState } from "react";
import type { UserSession } from "../../lib/presupuestos/types";
import { X, ICON_STROKE } from "../../components/icons";
import KpiView from "../../components/presupuestos/KpiView";
import { KpisLeadsView } from "./KpisLeadsView";
import { KpisCobrosView } from "./KpisCobrosView";
import { KpisNoShowsView } from "./KpisNoShowsView";

// InformesView depende de dom-to-image-more → ssr:false (mismo fix que
// PresupuestosShell).
const InformesView = NextDynamic(
  () => import("../../components/presupuestos/InformesView"),
  { ssr: false }
);

type SubTab = "presupuestos" | "leads" | "cobros" | "no-shows";

export function KpisView({ user, isAdmin }: { user: UserSession; isAdmin: boolean }) {
  const [tab, setTab] = useState<SubTab>("presupuestos");
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      {/* Sprint 12 — barra superior estilo Linear: pills accent activas. */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
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
          <SubTabButton
            active={tab === "cobros"}
            onClick={() => setTab("cobros")}
            label="Cobros"
          />
          <SubTabButton
            active={tab === "no-shows"}
            onClick={() => setTab("no-shows")}
            label="No-shows"
          />
        </div>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold px-3 py-1.5 hover:bg-[var(--color-accent-hover)] transition-colors"
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
        {tab === "leads" && <KpisLeadsView />}
        {tab === "cobros" && <KpisCobrosView />}
        {tab === "no-shows" && <KpisNoShowsView />}
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
      className={`font-display px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
      }`}
    >
      {label}
    </button>
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
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl bg-[var(--color-surface)] border-l border-[var(--color-border)] flex flex-col overflow-y-auto shadow-xl"
      >
        <header className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
              Exportar informe
            </h2>
            <p className="text-[11px] text-[var(--color-muted)]">
              PDF / PPT mensuales e informes semanales
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-auto">
          <InformesView user={user} />
        </div>
      </aside>
    </div>
  );
}
