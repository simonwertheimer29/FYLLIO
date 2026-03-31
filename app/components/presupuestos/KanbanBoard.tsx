"use client";

import { useEffect, useState } from "react";
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
import type { Presupuesto, PresupuestoEstado, MotivoPerdida, OrigenLead } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, PIPELINE_ORDEN } from "../../lib/presupuestos/colors";
import MotivoPerdidaModal from "./MotivoPerdidaModal";

// ------------------------------------------------------------------
// UrgencyDot
// ------------------------------------------------------------------

function UrgencyDot({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-rose-500" :
    score >= 40 ? "bg-amber-400" :
    "bg-emerald-400";
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${color}`} title={`Riesgo: ${score}`} />;
}

const ORIGEN_LABEL: Record<OrigenLead, string> = {
  google_ads:         "Google",
  seo_organico:       "SEO",
  referido_paciente:  "Referido",
  redes_sociales:     "RRSS",
  walk_in:            "Walk-in",
  otro:               "Otro",
};

// ------------------------------------------------------------------
// CompactCard
// ------------------------------------------------------------------

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
        {p.urgencyScore > 0 && <UrgencyDot score={p.urgencyScore} />}
        <p className="text-xs font-bold text-slate-900 leading-tight flex-1 min-w-0 truncate">{p.patientName}</p>
      </div>

      {/* Treatments */}
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

      {/* OrigenLead badge */}
      {p.origenLead && (
        <div className="mt-1">
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 font-medium">
            {ORIGEN_LABEL[p.origenLead]}
          </span>
        </div>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-1.5 gap-1">
        <div className="flex items-center gap-2">
          {p.amount != null && (
            <span className="text-[11px] font-extrabold text-slate-800">€{p.amount.toLocaleString("es-ES")}</span>
          )}
          <span className="text-[9px] text-slate-400">{p.fechaPresupuesto.split("-").reverse().join("/")}</span>
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
    <div className="w-[260px] min-w-[260px] shrink-0 h-full flex flex-col overflow-hidden">
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

      {/* Cards container — internal scroll */}
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-0 rounded-b-xl border border-t-0 p-2 space-y-2 overflow-y-auto transition-colors ${
          isOver ? "bg-slate-100" : "bg-slate-50"
        }`}
        style={{ borderColor: cfg.hex + "33" }}
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
// ConfirmMoveModal
// ------------------------------------------------------------------

function ConfirmMoveModal({
  patientName,
  targetEstado,
  onConfirm,
  onCancel,
}: {
  patientName: string;
  targetEstado: PresupuestoEstado;
  onConfirm: (skipFuture: boolean) => void;
  onCancel: () => void;
}) {
  const [skipFuture, setSkipFuture] = useState(false);
  const cfg = ESTADO_CONFIG[targetEstado];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <p className="text-sm font-bold text-slate-900 mb-1">Confirmar cambio de estado</p>
        <p className="text-xs text-slate-600 mb-4">
          Mover <span className="font-semibold">{patientName}</span> a{" "}
          <span className="font-bold" style={{ color: cfg.hex }}>{cfg.label}</span>
        </p>

        <label className="flex items-center gap-2 text-xs text-slate-500 mb-5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipFuture}
            onChange={(e) => setSkipFuture(e.target.checked)}
            className="rounded"
          />
          No volver a mostrar esta confirmación
        </label>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold py-2 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(skipFuture)}
            className="flex-1 rounded-xl text-white text-sm font-semibold py-2"
            style={{ background: cfg.hex }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// KanbanBoard (main export)
// ------------------------------------------------------------------

const SKIP_CONFIRM_KEY = "kanban_skip_confirm";

export default function KanbanBoard({
  presupuestos,
  onChangeEstado,
  onOpenHistory,
  onEdit,
}: {
  presupuestos: Presupuesto[];
  onChangeEstado: (id: string, estado: PresupuestoEstado, extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string }) => void;
  onOpenHistory: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<{ id: string; targetEstado: PresupuestoEstado } | null>(null);
  const [pendingPerdido, setPendingPerdido] = useState<{ id: string } | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(false);

  useEffect(() => {
    setSkipConfirm(localStorage.getItem(SKIP_CONFIRM_KEY) === "true");
  }, []);

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

    if (targetEstado === "PERDIDO") {
      setPendingPerdido({ id: String(active.id) });
    } else if (skipConfirm) {
      onChangeEstado(String(active.id), targetEstado);
    } else {
      setPendingChange({ id: String(active.id), targetEstado });
    }
  }

  function handleConfirm(skipFuture: boolean) {
    if (!pendingChange) return;
    if (skipFuture) {
      localStorage.setItem(SKIP_CONFIRM_KEY, "true");
      setSkipConfirm(true);
    }
    onChangeEstado(pendingChange.id, pendingChange.targetEstado);
    setPendingChange(null);
  }

  function handleConfirmPerdido(motivo: MotivoPerdida, texto?: string) {
    if (!pendingPerdido) return;
    onChangeEstado(pendingPerdido.id, "PERDIDO", { motivoPerdida: motivo, motivoPerdidaTexto: texto });
    setPendingPerdido(null);
  }

  const pendingCard = pendingChange ? presupuestos.find((p) => p.id === pendingChange.id) : null;
  const pendingPerdidoCard = pendingPerdido ? presupuestos.find((p) => p.id === pendingPerdido.id) : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Gray frame container — fills parent height */}
        <div className="bg-slate-100 rounded-2xl p-2 overflow-hidden h-full flex flex-col">
          <div className="flex flex-row flex-1 min-h-0 overflow-x-auto overflow-y-hidden gap-2">
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

      {pendingChange && pendingCard && (
        <ConfirmMoveModal
          patientName={pendingCard.patientName}
          targetEstado={pendingChange.targetEstado}
          onConfirm={handleConfirm}
          onCancel={() => setPendingChange(null)}
        />
      )}

      {pendingPerdido && pendingPerdidoCard && (
        <MotivoPerdidaModal
          patientName={pendingPerdidoCard.patientName}
          onConfirm={handleConfirmPerdido}
          onCancel={() => setPendingPerdido(null)}
        />
      )}
    </>
  );
}
