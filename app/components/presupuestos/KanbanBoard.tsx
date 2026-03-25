"use client";

import type { Presupuesto, PresupuestoEstado } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, PIPELINE_ORDEN } from "../../lib/presupuestos/colors";
import PatientCard from "./PatientCard";

function KanbanColumn({
  estado,
  presupuestos,
  onChangeEstado,
  onOpenHistory,
  onEdit,
}: {
  estado: PresupuestoEstado;
  presupuestos: Presupuesto[];
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onOpenHistory: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const cfg = ESTADO_CONFIG[estado];
  const total = presupuestos.reduce((s, p) => s + (p.amount ?? 0), 0);

  return (
    <div className="flex flex-col min-w-[220px] w-full">
      {/* Column header */}
      <div
        className="rounded-2xl px-3 py-2.5 mb-2 shrink-0"
        style={{ background: cfg.hex + "22", borderLeft: `4px solid ${cfg.hex}` }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold" style={{ color: cfg.hex === "#FFFF00" ? "#a16207" : cfg.hex }}>
            {cfg.label}
          </span>
          <span className="text-xs font-semibold text-slate-500">{presupuestos.length}</span>
        </div>
        {presupuestos.length > 0 && total > 0 && (
          <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
            €{total.toLocaleString("es-ES")}
          </p>
        )}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 flex-1">
        {presupuestos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-center">
            <p className="text-xs text-slate-400">Sin presupuestos</p>
          </div>
        ) : (
          presupuestos
            .sort((a, b) => b.urgencyScore - a.urgencyScore)
            .map((p) => (
              <PatientCard
                key={p.id}
                presupuesto={p}
                onChangeEstado={onChangeEstado}
                onOpenHistory={onOpenHistory}
                onEdit={onEdit}
              />
            ))
        )}
      </div>
    </div>
  );
}

export default function KanbanBoard({
  presupuestos,
  onChangeEstado,
  onOpenHistory,
  onEdit,
}: {
  presupuestos: Presupuesto[];
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onOpenHistory: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const byEstado = (e: PresupuestoEstado) =>
    presupuestos.filter((p) => p.estado === e);

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max lg:min-w-0 lg:grid lg:grid-cols-6">
        {PIPELINE_ORDEN.map((estado) => (
          <KanbanColumn
            key={estado}
            estado={estado}
            presupuestos={byEstado(estado)}
            onChangeEstado={onChangeEstado}
            onOpenHistory={onOpenHistory}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}
