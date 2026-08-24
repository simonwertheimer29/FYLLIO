"use client";

// /automatizaciones — F6 (fase F): VER, NO EDITAR. La ventana enseña qué
// hace el sistema solo (catálogo + estado + dónde se ve cada resultado);
// configurar es navegar a la config del agente. La pestaña «Motor» murió
// con el motor de reglas visible: en toda base limpia su tabla estaba
// vacía, no había UI para crear reglas y su acción de WhatsApp nunca envió
// nada (WA_ENGINE_OPERATIVO=false desde siempre). «Operativo» (las
// secuencias del clasificador viejo) aguanta hasta B5 y muere con él.

import { useState } from "react";
import type { UserSession } from "../../lib/presupuestos/types";
import AutomatizacionesView from "../../components/presupuestos/AutomatizacionesView";
import { CatalogoAutomatizaciones } from "./CatalogoAutomatizaciones";
import { CoincidenciaView } from "../../components/automatizacion/CoincidenciaView";

type Tab = "catalogo" | "coincidencia" | "operativo";

export function AutomatizacionesTopView({
  user,
  isAdmin,
}: {
  user: UserSession;
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<Tab>("catalogo");

  if (!isAdmin) {
    // Coord: el catálogo — qué hace el sistema y dónde ver cada cosa.
    return (
      <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)] p-4 lg:p-6">
        <CatalogoAutomatizaciones isAdmin={false} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center gap-1 shrink-0">
        <TabBtn active={tab === "catalogo"} onClick={() => setTab("catalogo")}>
          Qué hace el sistema
        </TabBtn>
        {/* «¿Escribe bien?» y no «Coincidencia»: la coordinadora no tiene por
            qué saber qué es una tasa de coincidencia, pero sí quiere saber si
            puede fiarse de lo que le proponen. */}
        <TabBtn active={tab === "coincidencia"} onClick={() => setTab("coincidencia")}>
          ¿Escribe bien?
        </TabBtn>
        <TabBtn active={tab === "operativo"} onClick={() => setTab("operativo")}>
          Operativo
        </TabBtn>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4 lg:p-6">
        {tab === "catalogo" && <CatalogoAutomatizaciones isAdmin />}
        {tab === "coincidencia" && <CoincidenciaView />}
        {tab === "operativo" && <AutomatizacionesView user={user} />}
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
      aria-selected={active}
      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)]"
      }`}
    >
      {children}
    </button>
  );
}
