"use client";

import { useEffect, useState, useMemo } from "react";
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
import type { Presupuesto, PresupuestoEstado, MotivoPerdida } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, PIPELINE_ORDEN, ORIGEN_LABEL } from "../../lib/presupuestos/colors";
import { calcularProbabilidad } from "../../lib/presupuestos/probability";
import MotivoPerdidaModal from "./MotivoPerdidaModal";
import { StatePill, type StatePillVariant } from "../ui/StatePill";

// Sprint 13 Bloque 4 — Kanban Presupuestos al estilo Leads.
// Helper: probabilidad → variante StatePill.
function probToVariant(prob: number): StatePillVariant {
  if (prob >= 60) return "success";
  if (prob >= 30) return "warning";
  return "danger";
}

// Tipo paciente / TipoVisita → variant neutral (todas).
const PILL_NEUTRAL: StatePillVariant = "neutral";

// Sprint 13.1 Bloque 3.2 — Barra de color superior por columna.
// 3px que se asienta UNA VEZ encima del header. Cards quedan blancas
// neutras como en Kanban Leads (sin border-left coloreado por card).
const COLUMN_TOP_BAR: Record<PresupuestoEstado, string> = {
  PRESENTADO: "bg-sky-300",
  INTERESADO: "bg-sky-500",
  EN_DUDA: "bg-amber-400",
  EN_NEGOCIACION: "bg-orange-500",
  ACEPTADO: "bg-emerald-500",
  PERDIDO: "bg-rose-400",
};

// ------------------------------------------------------------------
// Sprint 13 Bloque 4 — CompactCard al estilo Leads
// Sin border-left rojo (urgencia comunicada en Actuar Hoy, no kanban).
// Tags unificados con StatePill. Acciones aparecen en hover.
// ------------------------------------------------------------------

function CompactCard({
  presupuesto,
  prob,
  onOpenHistory,
  onEdit,
}: {
  presupuesto: Presupuesto;
  prob: number | null;
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
      style={{
        borderColor: "var(--card-border)",
        boxShadow: isDragging ? undefined : "var(--card-shadow-rest)",
      }}
      className={`group rounded-xl border bg-white px-3 py-2.5 cursor-grab active:cursor-grabbing select-none transition-[box-shadow,border-color] duration-150 ${
        isDragging
          ? "opacity-40"
          : "hover:[border-color:var(--card-border-hover)] hover:[box-shadow:var(--card-shadow-hover)]"
      }`}
    >
      {/* Nombre + score discreto a la derecha */}
      <div className="flex items-start gap-2">
        <a
          href={`/presupuestos/paciente/${encodeURIComponent(p.patientName)}`}
          className="text-sm font-semibold text-slate-900 leading-tight flex-1 min-w-0 truncate hover:text-sky-700 hover:underline"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {p.patientName}
        </a>
        {prob != null && (
          <StatePill variant={probToVariant(prob)} size="sm" title={`Prob. cierre ${prob}%`}>
            <span className="tabular-nums">{prob}%</span>
          </StatePill>
        )}
      </div>

      {/* Tag tratamiento principal + +N */}
      {p.treatments.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          <StatePill variant={PILL_NEUTRAL} size="sm">
            {p.treatments[0]}
          </StatePill>
          {p.treatments.length > 1 && (
            <StatePill variant={PILL_NEUTRAL} size="sm">
              +{p.treatments.length - 1}
            </StatePill>
          )}
        </div>
      )}

      {/* TipoPaciente + TipoVisita + OrigenLead — todos neutrales */}
      {(p.tipoPaciente || p.tipoVisita || p.origenLead) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {p.tipoPaciente && (
            <StatePill variant={PILL_NEUTRAL} size="sm">
              {p.tipoPaciente}
            </StatePill>
          )}
          {p.tipoVisita && (
            <StatePill variant={PILL_NEUTRAL} size="sm">
              {p.tipoVisita === "Primera Visita" ? "1ª Visita" : "Con historial"}
            </StatePill>
          )}
          {p.origenLead && (
            <StatePill variant={PILL_NEUTRAL} size="sm">
              {ORIGEN_LABEL[p.origenLead]}
            </StatePill>
          )}
        </div>
      )}

      {/* Bottom row: importe + fecha + dias */}
      <div className="flex items-center justify-between mt-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {p.amount != null && (
            <span className="font-display text-sm font-semibold text-slate-900 tabular-nums">
              €{p.amount.toLocaleString("es-ES")}
            </span>
          )}
          <span className="text-[10px] text-slate-400 tabular-nums">
            {p.fechaPresupuesto.split("-").reverse().join("/")}
          </span>
        </div>
        <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{p.daysSince}d</span>
      </div>

      {/* Quick actions — visibles solo en hover (consistencia con Leads) */}
      <div
        className="flex items-center gap-1 mt-2 pt-1.5 border-t border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {p.patientPhone && (
          <a
            href={`tel:${p.patientPhone}`}
            className="flex-1 text-center text-[10px] font-medium px-2 py-1 rounded-md bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
            title="Llamar"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          >
            Llamar
          </a>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenHistory(p);
          }}
          className="flex-1 text-[10px] font-medium px-2 py-1 rounded-md bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
          title="Historial"
          draggable={false}
        >
          Historial
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(p);
          }}
          className="flex-1 text-[10px] font-medium px-2 py-1 rounded-md bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
          title="Editar"
          draggable={false}
        >
          Editar
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
  probMap,
  velocidad,
  onOpenHistory,
  onEdit,
}: {
  estado: PresupuestoEstado;
  presupuestos: Presupuesto[];
  probMap: Map<string, number | null>;
  velocidad: { media: number; lenta: boolean } | null;
  onOpenHistory: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const cfg = ESTADO_CONFIG[estado];
  const { setNodeRef, isOver } = useDroppable({ id: estado });
  const total = presupuestos.reduce((s, p) => s + (p.amount ?? 0), 0);

  // Sprint 13 Bloque 4 — sub-info condensada a una línea.
  const subInfo = [
    total > 0 ? `€${total.toLocaleString("es-ES")}` : null,
    velocidad && velocidad.media > 0 ? `media: ${velocidad.media}d` : null,
    cfg.accionable ? cfg.hint : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="w-[260px] min-w-[260px] shrink-0 h-full flex flex-col overflow-hidden">
      {/* Sprint 13.1 Bloque 3.2 — Barra de color superior 3px que
          identifica la columna sin pintar el header completo. */}
      <div className={`h-[3px] rounded-t-md shrink-0 ${COLUMN_TOP_BAR[estado]}`} />

      {/* Header columna estilo Leads — sin fondo de color sólido, solo
          tipografia + contador; sub-info en una linea text-xs. */}
      <div className="px-3 py-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-700 truncate">
            {cfg.label}
          </span>
          <span className="text-xs text-slate-400 tabular-nums shrink-0">
            {presupuestos.length}
          </span>
        </div>
        {subInfo && (
          <p
            className="text-xs text-slate-500 mt-0.5 truncate"
            title={subInfo}
          >
            {subInfo}
          </p>
        )}
      </div>

      {/* Cards container — internal scroll */}
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-0 rounded-xl p-2 space-y-2 overflow-y-auto transition-colors border ${
          isOver ? "bg-sky-50/50 border-sky-200" : "bg-slate-50 border-[var(--card-border)]"
        }`}
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
                prob={probMap.get(p.id) ?? null}
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
  onChangeEstado: (id: string, estado: PresupuestoEstado, extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string; reactivar?: boolean }) => void;
  onOpenHistory: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<{ id: string; targetEstado: PresupuestoEstado } | null>(null);
  const [pendingPerdido, setPendingPerdido] = useState<{ id: string } | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(false);

  // Probabilidad de cierre — calculada una vez con el histórico en memoria
  const historico = useMemo(
    () => presupuestos.filter((p) => p.estado === "ACEPTADO" || p.estado === "PERDIDO"),
    [presupuestos]
  );
  const probMap = useMemo(() => {
    const map = new Map<string, number | null>();
    if (historico.length < 5) return map; // datos insuficientes
    presupuestos
      .filter((p) => p.estado !== "ACEPTADO" && p.estado !== "PERDIDO")
      .forEach((p) => map.set(p.id, calcularProbabilidad(p, historico)));
    return map;
  }, [presupuestos, historico]);

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

  function handleConfirmPerdido(motivo: MotivoPerdida, texto?: string, reactivar?: boolean) {
    if (!pendingPerdido) return;
    onChangeEstado(pendingPerdido.id, "PERDIDO", { motivoPerdida: motivo, motivoPerdidaTexto: texto, reactivar });
    setPendingPerdido(null);
  }

  // Velocidad de pipeline: media de daysSince por columna vs. media de ACEPTADOS
  const velocidadMap = useMemo(() => {
    const map = new Map<PresupuestoEstado, { media: number; lenta: boolean }>();
    const aceptados = presupuestos.filter((p) => p.estado === "ACEPTADO");
    const mediaHistorica = aceptados.length >= 3
      ? aceptados.reduce((s, p) => s + p.daysSince, 0) / aceptados.length
      : null;
    for (const estado of PIPELINE_ORDEN) {
      if (estado === "ACEPTADO" || estado === "PERDIDO") continue;
      const enEstado = presupuestos.filter((p) => p.estado === estado);
      if (enEstado.length === 0) { map.set(estado, { media: 0, lenta: false }); continue; }
      const media = Math.round(enEstado.reduce((s, p) => s + p.daysSince, 0) / enEstado.length);
      const lenta = mediaHistorica != null && media > 1.5 * mediaHistorica;
      map.set(estado, { media, lenta });
    }
    return map;
  }, [presupuestos]);

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
                probMap={probMap}
                velocidad={velocidadMap.get(estado) ?? null}
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
