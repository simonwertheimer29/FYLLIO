"use client";

// Sprint 8 D.2 — wrapper client de IntervencionView + su SidePanel.
// Reutiliza los componentes tal cual del módulo presupuestos; solo
// gestiona el state del drawer localmente y llama al mismo endpoint
// /api/presupuestos/kanban/:id para cambios de estado.

import { useState } from "react";
import type {
  UserSession,
  PresupuestoIntervencion,
  PresupuestoEstado,
  MotivoPerdida,
} from "../../lib/presupuestos/types";
import IntervencionView from "../../components/presupuestos/IntervencionView";
import IntervencionSidePanel from "../../components/presupuestos/IntervencionSidePanel";

export function ActuarHoyView({ user }: { user: UserSession }) {
  const [item, setItem] = useState<PresupuestoIntervencion | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  async function handleChangeEstado(
    id: string,
    estado: PresupuestoEstado,
    extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string; reactivar?: boolean }
  ) {
    try {
      const { reactivar, ...patchExtra } = extra ?? {};
      await fetch(`/api/presupuestos/kanban/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, ...patchExtra }),
      });
      if (reactivar && estado === "PERDIDO") {
        const fecha90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        await fetch("/api/presupuestos/contactos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presupuestoId: id,
            tipo: "whatsapp",
            resultado: "pidió tiempo",
            nota: "Reactivación programada — 90 días",
            fechaHora: fecha90,
          }),
        }).catch(() => {});
      }
      // Fuerza re-fetch interno de IntervencionView (su interval polling también lo hace).
      setReloadKey((k) => k + 1);
    } catch {
      // swallow: el interval de IntervencionView reintenta.
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col overflow-auto p-4 lg:p-6 gap-4">
        <IntervencionView
          key={reloadKey}
          user={user}
          onOpenDrawer={(p) => setItem(p)}
        />
      </div>

      {item && (
        <IntervencionSidePanel
          item={item}
          onClose={() => setItem(null)}
          onChangeEstado={(id, estado) => {
            handleChangeEstado(id, estado);
            setItem(null);
          }}
          onRefresh={() => setItem(null)}
        />
      )}
    </div>
  );
}
