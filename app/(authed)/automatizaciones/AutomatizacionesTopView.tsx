"use client";

// Sprint 16b Bloque 3 — /automatizaciones top-level con motor v4 como
// tab default. Tabs legacy Operativo/Reglas conservadas para admin como
// reportes históricos del Sprint 8.

import { useState } from "react";
import type { UserSession } from "../../lib/presupuestos/types";
import AutomatizacionesView from "../../components/presupuestos/AutomatizacionesView";
import ConfigAutomatizaciones from "../../components/presupuestos/ConfigAutomatizaciones";
import { MotorReglasView } from "./MotorReglasView";

type Tab = "motor" | "operativo" | "reglas";

export function AutomatizacionesTopView({
  user,
  isAdmin,
}: {
  user: UserSession;
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<Tab>("motor");

  if (!isAdmin) {
    // Coord: solo Motor (read-only via permisos del endpoint PATCH).
    return (
      <div className="flex-1 min-h-0 overflow-auto bg-slate-50 p-4 lg:p-6">
        <MotorReglasView isAdmin={false} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-1 shrink-0">
        <TabBtn active={tab === "motor"} onClick={() => setTab("motor")}>
          Motor
        </TabBtn>
        <TabBtn active={tab === "operativo"} onClick={() => setTab("operativo")}>
          Operativo (legacy)
        </TabBtn>
        <TabBtn active={tab === "reglas"} onClick={() => setTab("reglas")}>
          Reglas (legacy)
        </TabBtn>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4 lg:p-6">
        {tab === "motor" && <MotorReglasView isAdmin={isAdmin} />}
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
