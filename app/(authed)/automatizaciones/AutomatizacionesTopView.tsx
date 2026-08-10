"use client";

// /automatizaciones — el MOTOR y la COLA. Aquí no se configura nada.
//
// Tenía una cuarta pestaña, «Reglas y objetivos», que era un menú lateral de
// siete secciones de configuración metido dentro de una pestaña. Todo eso vive
// ahora en /ajustes, con una URL por sección (MEJORAS 13, 2026-08-10). Lo que
// queda son las tres cosas que sí son operación: qué hace el motor, si escribe
// bien, y qué hay en la cola.

import { useState } from "react";
import type { UserSession } from "../../lib/presupuestos/types";
import AutomatizacionesView from "../../components/presupuestos/AutomatizacionesView";
import { MotorReglasView } from "./MotorReglasView";
import { CoincidenciaView } from "../../components/automatizacion/CoincidenciaView";

type Tab = "motor" | "coincidencia" | "operativo";

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
        {tab === "motor" && <MotorReglasView isAdmin={isAdmin} />}
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
