"use client";

// Sprint 8 D.5 — /automatizaciones top-level.
// Coord: solo vista operativa (AutomatizacionesView).
// Admin: tabs Operativo + Reglas (ConfigAutomatizaciones).

import { useState } from "react";
import type { UserSession } from "../../lib/presupuestos/types";
import AutomatizacionesView from "../../components/presupuestos/AutomatizacionesView";
import ConfigAutomatizaciones from "../../components/presupuestos/ConfigAutomatizaciones";

type Tab = "operativo" | "reglas";

export function AutomatizacionesTopView({
  user,
  isAdmin,
}: {
  user: UserSession;
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<Tab>("operativo");

  if (!isAdmin) {
    // Coord: solo operativo, sin tabs.
    return (
      <div className="flex-1 min-h-0 overflow-auto bg-slate-50 p-4 lg:p-6">
        <AutomatizacionesView user={user} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-1 shrink-0">
        <TabBtn active={tab === "operativo"} onClick={() => setTab("operativo")}>
          Operativo
        </TabBtn>
        <TabBtn active={tab === "reglas"} onClick={() => setTab("reglas")}>
          Reglas
        </TabBtn>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4 lg:p-6">
        {tab === "operativo" && <AutomatizacionesView user={user} />}
        {tab === "reglas" && <ConfigAutomatizaciones user={user} />}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
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
      {children}
    </button>
  );
}
