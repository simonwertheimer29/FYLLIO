"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import type { Presupuesto, PresupuestoEstado } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, PIPELINE_ORDEN, ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";

// ------------------------------------------------------------------
// CompactCard — tarjeta pequeña para el Kanban Panel
// ------------------------------------------------------------------

function UrgencyDot({ score }: { score: number }) {
  const color =
    score >= 60 ? "bg-rose-500" :
    score >= 35 ? "bg-amber-400" :
    "bg-emerald-400";
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${color}`} title={`Urgencia: ${score}`} />;
}

function CompactCard({
  presupuesto,
  onOpenHistory,
  onEdit,
}: {
  presupuesto: Presupuesto;
  onOpenHistory: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const p = presupuesto;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: p.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`rounded-xl border bg-white px-3 py-2.5 cursor-grab active:cursor-grabbing select-none transition-shadow ${
        isDragging ? "opacity-40 shadow-lg" : "hover:shadow-sm border-slate-200"
      }`}
    >
      {/* Name + urgency dot */}
      <div className="flex items-start gap-1.5">
        <UrgencyDot score={p.urgencyScore} />
        <p className="text-xs font-bold text-slate-900 leading-tight flex-1 min-w-0 truncate">{p.patientName}</p>
      </div>

      {/* Treatments — all, no truncate */}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {p.treatments.map((t, i) => (
          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 leading-tight">
            {t}
          </span>
        ))}
      </div>

      {/* Badges: tipo paciente + tipo visita */}
      {(p.tipoPaciente || p.tipoVisita) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {p.tipoPaciente && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
              p.tipoPaciente === "Privado" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"
            }`}>
              {p.tipoPaciente}
            </span>
          )}
          {p.tipoVisita && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
              {p.tipoVisita === "Primera Visita" ? "1ª Visita" : "Con Hist."}
            </span>
          )}
        </div>
      )}

      {/* Bottom row: importe + fecha + días */}
      <div className="flex items-center justify-between mt-1.5 gap-1">
        <div className="flex items-center gap-2">
          {p.amount != null && (
            <span className="text-[11px] font-extrabold text-slate-800">€{p.amount.toLocaleString("es-ES")}</span>
          )}
          <span className="text-[9px] text-slate-400">{p.fechaPresupuesto.slice(0, 7)}</span>
        </div>
        <span className="text-[9px] text-slate-400 shrink-0">{p.daysSince}d</span>
      </div>

      {/* Quick actions */}
      <div
        className="flex items-center gap-2 mt-2 pt-1.5 border-t border-slate-100"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {p.patientPhone && (
          <a
            href={`tel:${p.patientPhone}`}
            className="text-sm hover:scale-110 transition-transform"
            title="Llamar"
            draggable={false}
          >
            📞
          </a>
        )}
        <button
          onClick={() => onOpenHistory(p)}
          className="text-sm hover:scale-110 transition-transform"
          title="Historial"
          draggable={false}
        >
          📋
        </button>
        <button
          onClick={() => onEdit(p)}
          className="text-sm hover:scale-110 transition-transform"
          title="Editar"
          draggable={false}
        >
          ✏️
        </button>
      </div>
    </div>
  );
}

// Ghost card shown in DragOverlay
function GhostCard({ presupuesto }: { presupuesto: Presupuesto }) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 shadow-2xl w-48 opacity-90 rotate-2">
      <p className="text-xs font-bold text-slate-900 truncate">{presupuesto.patientName}</p>
      <p className="text-[10px] text-slate-500 truncate">{presupuesto.treatments[0]}</p>
    </div>
  );
}

// ------------------------------------------------------------------
// DroppableColumn
// ------------------------------------------------------------------

function DroppableColumn({
  estado,
  presupuestos,
  onOpenHistory,
  onEdit,
}: {
  estado: PresupuestoEstado;
  presupuestos: Presupuesto[];
  onOpenHistory: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const cfg = ESTADO_CONFIG[estado];
  const { setNodeRef, isOver } = useDroppable({ id: estado });
  const total = presupuestos.reduce((s, p) => s + (p.amount ?? 0), 0);

  return (
    <div className="flex flex-col w-full">
      {/* Column header */}
      <div
        className="rounded-t-xl px-3 py-2 shrink-0 border border-b-0"
        style={{
          background: cfg.hex + "18",
          borderColor: cfg.hex + "55",
          borderTop: `3px solid ${cfg.hex}`,
        }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-bold truncate" style={{ color: cfg.hex }}>
            {cfg.label}
          </span>
          <span className="text-[10px] font-semibold text-slate-500 shrink-0">
            {presupuestos.length}
          </span>
        </div>
        {presupuestos.length > 0 && total > 0 && (
          <p className="text-[10px] text-slate-500 mt-0.5">
            €{total.toLocaleString("es-ES")}
          </p>
        )}
        {cfg.accionable && (
          <p className="text-[9px] text-slate-400 mt-0.5 italic">{cfg.hint}</p>
        )}
      </div>

      {/* Cards container */}
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-b-xl border border-t-0 p-2 space-y-2 overflow-y-auto transition-colors ${
          isOver ? "bg-slate-100" : "bg-slate-50"
        }`}
        style={{
          borderColor: cfg.hex + "33",
          height: "calc(100vh - 180px)",
          minHeight: "200px",
        }}
      >
        {presupuestos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center mt-1">
            <p className="text-[10px] text-slate-400">Vacío</p>
          </div>
        ) : (
          presupuestos
            .sort((a, b) => b.urgencyScore - a.urgencyScore)
            .map((p) => (
              <CompactCard
                key={p.id}
                presupuesto={p}
                onOpenHistory={onOpenHistory}
                onEdit={onEdit}
              />
            ))
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// KanbanBoard (main export)
// ------------------------------------------------------------------

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const activePresupuesto = presupuestos.find((p) => p.id === activeId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const targetEstado = over.id as PresupuestoEstado;
    const card = presupuestos.find((p) => p.id === active.id);
    if (!card || card.estado === targetEstado) return;

    onChangeEstado(String(active.id), targetEstado);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="overflow-x-auto pb-2">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: "repeat(6, minmax(160px, 1fr))", minWidth: "960px" }}
        >
          {PIPELINE_ORDEN.map((estado) => (
            <DroppableColumn
              key={estado}
              estado={estado}
              presupuestos={presupuestos.filter((p) => p.estado === estado)}
              onOpenHistory={onOpenHistory}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activePresupuesto ? <GhostCard presupuesto={activePresupuesto} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
