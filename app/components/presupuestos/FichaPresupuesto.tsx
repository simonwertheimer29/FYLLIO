"use client";

// Ficha de presupuesto abierta desde el kanban (unificación 2026-07-27).
//
// El kanban sólo tiene el `Presupuesto` plano; el panel de acción —el mismo
// que usan Seguimiento y la Vista Máxima— trabaja con `PresupuestoIntervencion`
// (clasificación del hilo, acción sugerida, intención). Este wrapper pide el
// caso enriquecido por id y monta AccionPanel cuando llega.
//
// Reglas que respeta: mientras carga, la cabecera real (nombre + tratamiento,
// que ya conocemos) sobre un esqueleto — nunca una pantalla en blanco; si la
// carga falla, error honesto con reintentar — nunca una ficha vacía que
// parezca "este paciente no tiene nada".

import { useCallback, useEffect, useState } from "react";
import type {
  Presupuesto,
  PresupuestoIntervencion,
  PresupuestoEstado,
} from "../../lib/presupuestos/types";
import { AccionPanel } from "../shared/AccionPanel";
import { PanelAccionShell, PanelCabecera } from "../shared/panel-accion-ui";
import { ErrorState } from "../ui/Feedback";
import { eur } from "../shared/Cifra";

export default function FichaPresupuesto({
  presupuesto,
  onClose,
  onChangeEstado,
  onRefresh,
}: {
  presupuesto: Presupuesto;
  onClose: () => void;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onRefresh: () => void;
}) {
  const [item, setItem] = useState<PresupuestoIntervencion | null>(null);
  const [error, setError] = useState(false);
  const id = presupuesto.id;

  const cargar = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(`/api/presupuestos/intervencion?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (!d?.item) throw new Error("sin item");
      setItem(d.item as PresupuestoIntervencion);
    } catch {
      setError(true);
    }
  }, [id]);

  useEffect(() => {
    setItem(null);
    cargar();
  }, [cargar]);

  if (item) {
    return (
      <AccionPanel
        kind="presupuesto"
        item={item}
        onClose={onClose}
        onChangeEstado={onChangeEstado}
        onRefresh={onRefresh}
      />
    );
  }

  const importe = presupuesto.amount != null ? eur(presupuesto.amount) : "sin importe";

  return (
    <PanelAccionShell onClose={onClose}>
      <PanelCabecera
        nombre={presupuesto.patientName}
        sub={`${presupuesto.treatments.join(", ") || "Sin tratamiento"} · ${importe}`}
        prioridad={null}
        onClose={onClose}
      />
      <div className="p-4">
        {error ? (
          <ErrorState detail="No se pudo abrir la ficha del paciente." onRetry={cargar} />
        ) : (
          <div className="space-y-3 animate-pulse">
            <div className="h-20 rounded-xl bg-[var(--color-surface-muted)]" />
            <div className="h-10 rounded-xl bg-[var(--color-surface-muted)] ml-8" />
            <div className="h-10 rounded-xl bg-[var(--color-surface-muted)] mr-8" />
          </div>
        )}
      </div>
    </PanelAccionShell>
  );
}
