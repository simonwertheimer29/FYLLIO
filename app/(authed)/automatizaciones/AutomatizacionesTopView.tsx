"use client";

// /automatizaciones top-level — Motor v4 como tab por defecto.
// Las vistas Operativo/Reglas se conservan para admin sin el sufijo
// "(legacy)": Reglas contiene el único editor de objetivos mensuales
// por clínica y Operativo la cola de secuencias pendientes.

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
      <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)] p-4 lg:p-6">
        <MotorReglasView isAdmin={false} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center gap-1 shrink-0">
        <TabBtn active={tab === "motor"} onClick={() => setTab("motor")}>
          Motor
        </TabBtn>
        <TabBtn active={tab === "operativo"} onClick={() => setTab("operativo")}>
          Operativo
        </TabBtn>
        <TabBtn active={tab === "reglas"} onClick={() => setTab("reglas")}>
          Reglas y objetivos
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
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "bg-[var(--color-surface)] text-[var(--color-muted)] border border-[var(--color-border)] hover:text-[var(--color-foreground)]"
      }`}
    >
      {children}
    </button>
  );
}
