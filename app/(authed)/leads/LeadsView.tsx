"use client";

// Sprint 8 Bloque B — Kanban de leads con drag & drop.
// Consume ClinicContext para filtrar por clínica global + filtros locales
// de fecha y búsqueda.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, MessageCircle, Check, Copy, Plus, ICON_STROKE } from "../../components/icons";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useClinic } from "../../lib/context/ClinicContext";
import { contarPipeline, textoPipeline } from "../../lib/leads/pipeline";
import { NewLeadModal } from "./NewLeadModal";
import { AccionPanel } from "../../components/shared/AccionPanel";
import { AgendarModal } from "./AgendarModal";
import { MotivoNoInteresModal } from "./MotivoNoInteresModal";
import { esReactivable, labelMotivo } from "../../lib/leads/motivos";
import { AsistenciaModal } from "./AsistenciaModal";
import type { Lead, LeadEstado } from "./types";
import {
  RangoTemporal,
  RANGO_DEFAULT,
  dentroDeRango,
  type RangoKanban,
} from "../../components/shared/RangoTemporal";

export type { Lead } from "./types";

// 5 columnas del kanban. "Citados Hoy" es una columna derivada visualmente:
// leads con Estado="Citado" cuya Fecha_Cita=hoy aparecen ahí (no en Citado).
// Estado="Citados Hoy" como valor literal se mantiene como legacy (el seed
// ya lo migró a "Citado", pero algún registro antiguo podría sobrevivir).
const COLUMNS: Array<{ id: LeadEstado; label: string; accent: string; ringClass?: string }> = [
  {
    id: "Nuevo",
    label: "Nuevo",
    accent: "bg-[var(--color-surface-muted)] text-[var(--color-foreground)]",
  },
  {
    id: "Contactado",
    label: "Contactado",
    accent: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  },
  {
    id: "Citado",
    label: "Citado",
    accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  },
  {
    id: "Citados Hoy",
    label: "Citados Hoy",
    accent: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    // Sprint 12 H.3 — acento rose mas sutil (ring-1 + opacidad).
    ringClass: "ring-1 ring-rose-200/70 dark:ring-rose-500/30",
  },
  {
    id: "No Interesado",
    label: "No Interesado",
    accent: "bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
  },
];

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

// Cards pintadas por página en cada columna (carga progresiva).
const PAGINA_CARDS = 25;

function columnOf(lead: Lead, today: string): LeadEstado {
  // Citados Hoy = Estado legacy "Citados Hoy" OR Estado="Citado" con Fecha_Cita=hoy.
  if (lead.estado === "Citados Hoy") return "Citados Hoy";
  if (lead.estado === "Citado" && lead.fechaCita === today) return "Citados Hoy";
  return lead.estado;
}

type Doctor = { id: string; nombre: string; clinicaId: string | null };

export function LeadsView({
  initialLeads,
  clinicasSelectables,
  doctores,
}: {
  initialLeads: Lead[];
  clinicasSelectables: Array<{ id: string; nombre: string }>;
  doctores: Doctor[];
}) {
  const { selectedClinicaId } = useClinic();
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [search, setSearch] = useState("");
  const [rango, setRango] = useState<RangoKanban>(RANGO_DEFAULT);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [agendarLead, setAgendarLead] = useState<Lead | null>(null);
  const [asistenciaLead, setAsistenciaLead] = useState<Lead | null>(null);
  const [pendingNoInteres, setPendingNoInteres] = useState<{
    lead: Lead;
    destColumn: LeadEstado;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Actividad por lead (última acción o mensaje) — alimenta el rango
  // temporal del tablero. Sin dato conocido se usa la fecha de alta.
  const [ultimaActividadPorLead, setUltimaActividadPorLead] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/leads/ultima-saliente")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const out: Record<string, string> = { ...(d.ultimaSalientePorLead ?? {}) };
        for (const [id, ts] of Object.entries(d.ultimaEntrantePorLead ?? {})) {
          if (!out[id] || String(ts) > out[id]) out[id] = String(ts);
        }
        setUltimaActividadPorLead(out);
      })
      .catch(() => {
        /* sin el mapa, la columna muestra todos — degradación visible, no rota */
      });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // activar drag después de 6 px para no interferir con el click simple
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      // en táctil: mantener pulsado 200ms para arrastrar sin bloquear el scroll
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  // Filtrado por clínica global + búsqueda (SIN rango: el rango se aplica
  // después, para poder decir cuántos deja fuera cada columna).
  const leadsBase = useMemo(() => {
    let out = leads;
    if (selectedClinicaId) {
      out = out.filter((l) => l.clinicaId === selectedClinicaId);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      out = out.filter(
        (l) =>
          l.nombre.toLowerCase().includes(q) ||
          (l.telefono ?? "").toLowerCase().includes(q) ||
          (l.email ?? "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [leads, selectedClinicaId, search]);

  // Rango temporal — control único compartido con el kanban de Presupuestos
  // (2026-07-26). Aplica a TODAS las columnas: la fecha que cuenta es la de
  // actividad si la hay (última acción/mensaje) y si no la de alta. Sin fecha
  // conocida, el lead se muestra.
  // La fecha que cuenta es la del HITO del caso: cierre para los cerrados
  // (MEJORAS 37 — antes se usaba la actividad como proxy y un lead cerrado sin
  // mensajes no envejecía nunca), actividad para los vivos, alta si no hay nada.
  // Sin fecha conocida el lead se MUESTRA: nunca se esconde por falta de dato.
  const enRango = useCallback(
    (l: Lead) =>
      dentroDeRango(
        (l.fechaCierre ?? ultimaActividadPorLead[l.id] ?? l.createdAt)?.slice(0, 10),
        rango,
      ),
    [ultimaActividadPorLead, rango],
  );

  const filteredLeads = useMemo(() => leadsBase.filter(enRango), [leadsBase, enRango]);

  // Citados Hoy es derivada: Estado="Citados Hoy" legacy OR Estado="Citado"
  // con Fecha_Cita=hoy. Resto cae en su columna de Estado nativa.
  const leadsPorColumna = useMemo(() => {
    const today = TODAY_ISO();
    const m = new Map<LeadEstado, Lead[]>();
    for (const col of COLUMNS) m.set(col.id, []);
    for (const l of filteredLeads) {
      const col = columnOf(l, today);
      if (m.has(col)) m.get(col)!.push(l);
    }
    return m;
  }, [filteredLeads]);

  // Cuántos esconde el rango en cada columna — para decirlo en su pie.
  const ocultosPorColumna = useMemo(() => {
    const today = TODAY_ISO();
    const m = new Map<LeadEstado, number>();
    for (const col of COLUMNS) m.set(col.id, 0);
    for (const l of leadsBase) {
      if (enRango(l)) continue;
      const col = columnOf(l, today);
      if (m.has(col)) m.set(col, (m.get(col) ?? 0) + 1);
    }
    return m;
  }, [leadsBase, enRango]);

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setDraggingId(String(e.active.id));
  }, []);

  // Movimiento efectivo de un lead entre columnas. Separado del drag para que
  // el modal de motivo pueda reanudarlo con la respuesta de la coordinadora.
  const aplicarMovimiento = useCallback(
    async (lead: Lead, destColumn: LeadEstado, motivoElegido?: Lead["motivoNoInteres"]) => {
      const today = TODAY_ISO();
      const activeId = lead.id;
      // Citados Hoy es columna derivada: el Estado canónico que escribimos
      // en Airtable es "Citado" + Fecha_Cita=hoy.
      const destEstado: LeadEstado = destColumn === "Citados Hoy" ? "Citado" : destColumn;

      const patchBody: Record<string, any> = { estado: destEstado };
      if (destEstado === "No Interesado") {
        // El motivo lo declara la coordinadora en el modal — nunca se asume.
        if (motivoElegido) patchBody.motivoNoInteres = motivoElegido;
      } else if (lead.motivoNoInteres) {
        patchBody.motivoNoInteres = null;
      }
      // Drop en columna "Citados Hoy" desde cualquier Estado≠Contactado:
      // re-agendar a hoy (estado=Citado + Fecha_Cita=hoy).
      if (destColumn === "Citados Hoy") {
        patchBody.fechaCita = today;
      }

      // Optimistic update.
      setLeads((prev) =>
        prev.map((l) =>
          l.id === activeId
            ? {
                ...l,
                estado: destEstado,
                fechaCita:
                  patchBody.fechaCita === undefined ? l.fechaCita : patchBody.fechaCita,
                motivoNoInteres:
                  patchBody.motivoNoInteres === undefined
                    ? l.motivoNoInteres
                    : patchBody.motivoNoInteres,
              }
            : l
        )
      );
      try {
        const res = await fetch(`/api/leads/${activeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        if (!res.ok) throw new Error("update failed");
      } catch {
        // Rollback.
        setLeads((prev) =>
          prev.map((l) =>
            l.id === activeId
              ? {
                  ...l,
                  estado: lead.estado,
                  fechaCita: lead.fechaCita,
                  motivoNoInteres: lead.motivoNoInteres,
                }
              : l
          )
        );
        setError("No se pudo mover el lead. Inténtalo de nuevo.");
        toast.error("No se pudo mover el lead. Inténtalo de nuevo.");
      }
    },
    []
  );

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setDraggingId(null);
      const activeId = String(e.active.id);
      const overId = e.over?.id ? String(e.over.id) : null;
      if (!overId) return;
      // overId puede ser una columna (id) o una tarjeta.
      const today = TODAY_ISO();
      const overColumn = COLUMNS.find((c) => c.id === overId);
      const overLead = leads.find((l) => l.id === overId);
      const destColumn: LeadEstado | undefined = overColumn
        ? overColumn.id
        : overLead
          ? columnOf(overLead, today)
          : undefined;
      if (!destColumn) return;

      const lead = leads.find((l) => l.id === activeId);
      if (!lead) return;
      const fromColumn = columnOf(lead, today);
      if (fromColumn === destColumn) return;

      const destEstado: LeadEstado = destColumn === "Citados Hoy" ? "Citado" : destColumn;

      // Sprint 9 G.2: pasar a Citado requiere modal obligatorio (fecha/hora/
      // doctor/tratamiento/tipo_visita). Si la columna destino es Citados Hoy,
      // AgendarModal ya defaultea a hoy.
      // MEJORAS 50 (2026-07-27): la cita se declara, no se rellena. Antes el
      // modal solo se exigía VINIENDO de "Contactado", así que arrastrar de
      // Nuevo a Citado escribía el estado sin fecha: el lead quedaba citado sin
      // cuándo, y esa cita no existía para nadie más.
      if (destEstado === "Citado" && destColumn !== "Citados Hoy" && !lead.fechaCita) {
        setAgendarLead(lead);
        return;
      }

      // Coherencia de kanban (2026-07-27): descartar un lead PREGUNTA el
      // motivo, igual que su gemelo de Presupuestos. Antes se escribía
      // "Rechazo_Producto" en silencio y ese dato inventado alimentaba los
      // KPIs de motivo de pérdida.
      if (destEstado === "No Interesado" && !lead.motivoNoInteres) {
        setPendingNoInteres({ lead, destColumn });
        return;
      }

      await aplicarMovimiento(lead, destColumn);
    },
    [leads, aplicarMovimiento]
  );

  async function onLeadCreated(lead: Lead) {
    setLeads((prev) => [lead, ...prev]);
  }

  async function onLeadUpdated(lead: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l)));
    setDrawerLead(lead);
  }

  async function onLeadConverted(leadId: string) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, convertido: true } : l))
    );
    setDrawerLead(null);
  }

  // Fix 2: "No asistió" inline desde la card de Citados Hoy. PATCH directo a
  // No Interesado + Motivo_No_Interes=No_Asistio sin abrir modal.
  async function noAsistioInline(lead: Lead) {
    const prev = { estado: lead.estado, motivoNoInteres: lead.motivoNoInteres };
    setLeads((prevList) =>
      prevList.map((l) =>
        l.id === lead.id
          ? { ...l, estado: "No Interesado", motivoNoInteres: "No_Asistio" }
          : l
      )
    );
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "No Interesado", motivoNoInteres: "No_Asistio" }),
      });
      if (!res.ok) throw new Error("update failed");
    } catch {
      setLeads((prevList) =>
        prevList.map((l) => (l.id === lead.id ? { ...l, ...prev } : l))
      );
      setError("No se pudo marcar como no asistió. Inténtalo de nuevo.");
      toast.error("No se pudo marcar como no asistió. Inténtalo de nuevo.");
    }
  }

  const draggingLead = draggingId ? leads.find((l) => l.id === draggingId) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] p-6 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">Leads</h1>
          {/* Una sola definición de pipeline (lib/leads/pipeline): activos =
              las 4 columnas accionables; los No Interesado se desglosan para
              que el número cuadre con las tarjetas visibles del tablero. */}
          <p className="text-xs text-[var(--color-muted)] mt-0.5 tabular-nums">
            {textoPipeline(contarPipeline(filteredLeads))}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewLeadOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold px-3.5 py-2 hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
          Nuevo lead
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <RangoTemporal value={rango} onChange={setRango} />
        <input
          type="search"
          placeholder="Buscar lead…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] max-w-sm rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
      </div>

      {error && (
        <p className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] border border-[var(--color-border)] rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      {/* Kanban */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {COLUMNS.map((col) => {
            const items = leadsPorColumna.get(col.id) ?? [];
            return (
              <KanbanColumn
                key={col.id}
                estado={col.id}
                label={col.label}
                accent={col.accent}
                ringClass={col.ringClass}
                items={items}
                ocultos={ocultosPorColumna.get(col.id) ?? 0}
                onVerHistorico={() => setRango("todo")}
                onCardClick={(l) => setDrawerLead(l)}
                onAsistencia={(l) => setAsistenciaLead(l)}
                onNoAsistio={noAsistioInline}
              />
            );
          })}
        </div>

        <DragOverlay>
          {draggingLead && (
            <div className="rotate-1 opacity-90">
              <LeadCardBody lead={draggingLead} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {newLeadOpen && (
        <NewLeadModal
          clinicas={clinicasSelectables}
          defaultClinicaId={selectedClinicaId ?? undefined}
          onClose={() => setNewLeadOpen(false)}
          onCreated={(lead) => {
            onLeadCreated(lead);
            setNewLeadOpen(false);
          }}
        />
      )}

      {drawerLead && (
        <AccionPanel
          kind="lead"
          item={drawerLead}
          onClose={() => setDrawerLead(null)}
          onChanged={(updated) => onLeadUpdated(updated)}
          onAsistencia={(l) => setAsistenciaLead(l)}
          onAgendar={(l) => setAgendarLead(l)}
        />
      )}

      {agendarLead && (
        <AgendarModal
          lead={agendarLead}
          doctores={doctores}
          onClose={() => setAgendarLead(null)}
          onSaved={(updated) => {
            onLeadUpdated(updated);
            setAgendarLead(null);
          }}
        />
      )}

      {pendingNoInteres && (
        <MotivoNoInteresModal
          nombre={pendingNoInteres.lead.nombre}
          onCancel={() => setPendingNoInteres(null)}
          onConfirm={(motivo) => {
            const { lead, destColumn } = pendingNoInteres;
            setPendingNoInteres(null);
            aplicarMovimiento(lead, destColumn, motivo);
          }}
        />
      )}

      {asistenciaLead && (
        <AsistenciaModal
          lead={asistenciaLead}
          onClose={() => setAsistenciaLead(null)}
          onDone={(updated) => {
            onLeadUpdated(updated);
            setAsistenciaLead(null);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Columna + tarjeta sortable
// ═══════════════════════════════════════════════════════════════════════

function KanbanColumn({
  estado,
  label,
  accent,
  ringClass,
  items,
  ocultos,
  onVerHistorico,
  onCardClick,
  onAsistencia,
  onNoAsistio,
}: {
  estado: LeadEstado;
  label: string;
  accent: string;
  ringClass?: string;
  items: Lead[];
  /** Leads que el rango temporal deja fuera de esta columna. */
  ocultos: number;
  onVerHistorico: () => void;
  onCardClick: (l: Lead) => void;
  onAsistencia: (l: Lead) => void;
  onNoAsistio: (l: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: estado });
  // Carga progresiva: con "Histórico" una columna trae cientos de leads. Se
  // pintan por páginas con un "Ver más" honesto — nada oculto en silencio.
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [items.length, estado]);
  const pintados = items.slice(0, pagina * PAGINA_CARDS);
  const restantes = items.length - pintados.length;
  return (
    <div
      className={`flex flex-col min-h-0 rounded-xl bg-[var(--color-surface)] border transition-colors ${
        isOver ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
      } ${ringClass ?? ""}`}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
        <span className="font-display text-[13px] font-medium text-[var(--color-foreground)] tracking-tight">{label}</span>
        <span className={`text-[10px] font-semibold tabular-nums px-2 py-0.5 rounded-full ${accent}`}>
          {items.length}
        </span>
      </div>
      {/* El destino se ilumina al arrastrar por encima — venía del kanban de
          Presupuestos, que aquí era el mejor de los dos. */}
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] p-2 space-y-2 overflow-y-auto transition-colors ${
          isOver ? "bg-[var(--color-accent-soft)]" : ""
        }`}
        data-estado={estado}
      >
        {estado === "No Interesado" ? (
          <NoInteresadoGroups items={pintados} onCardClick={onCardClick} />
        ) : estado === "Citados Hoy" ? (
          pintados.map((l) => (
            <SortableLeadCard
              key={l.id}
              lead={l}
              onClick={() => onCardClick(l)}
              variant="citadosHoy"
              onAsistencia={onAsistencia}
              onNoAsistio={onNoAsistio}
            />
          ))
        ) : (
          pintados.map((l) => (
            <SortableLeadCard key={l.id} lead={l} onClick={() => onCardClick(l)} />
          ))
        )}
        {items.length === 0 && (
          <div className="h-full min-h-[80px] flex items-center justify-center text-[11px] text-[var(--color-muted)] italic">
            Sin leads
          </div>
        )}
        {restantes > 0 && (
          <button
            type="button"
            onClick={() => setPagina((n) => n + 1)}
            className="w-full text-center text-[11px] font-semibold text-[var(--color-accent)] hover:underline px-1 py-1.5"
          >
            Ver más ({restantes})
          </button>
        )}
        {/* Lo que el rango esconde se DICE, columna por columna (gemelo del
            pie de Presupuestos). */}
        {ocultos > 0 && (
          <button
            type="button"
            onClick={onVerHistorico}
            className="w-full text-center text-[11px] font-semibold text-[var(--color-accent)] hover:underline px-1 py-1.5"
          >
            Ver {ocultos} anterior{ocultos === 1 ? "" : "es"} →
          </button>
        )}
      </div>
    </div>
  );
}

// La columna de descartados se parte por lo único que cambia la decisión:
// ¿queda algo que intentar? (MEJORAS 42). Antes separaba "No asistió" del
// resto, cuando "el resto" era un único motivo genérico; con seis motivos la
// partición útil es reactivables vs decisión tomada.
function NoInteresadoGroups({
  items,
  onCardClick,
}: {
  items: Lead[];
  onCardClick: (l: Lead) => void;
}) {
  const reactivables = items.filter((l) => esReactivable(l.motivoNoInteres));
  const cerrados = items.filter((l) => !esReactivable(l.motivoNoInteres));
  const grupo = (titulo: string, clase: string, lista: Lead[]) =>
    lista.length > 0 && (
      <>
        <p className={`text-[10px] font-semibold uppercase tracking-wide px-1 mt-1 ${clase}`}>
          {titulo} · {lista.length}
        </p>
        {lista.map((l) => (
          <SortableLeadCard key={l.id} lead={l} onClick={() => onCardClick(l)} />
        ))}
      </>
    );
  return (
    <>
      {grupo("Se puede retomar", "text-amber-700 dark:text-amber-300", reactivables)}
      {grupo("Decisión tomada", "text-[var(--color-muted)]", cerrados)}
    </>
  );
}

function SortableLeadCard({
  lead,
  onClick,
  variant = "default",
  onAsistencia,
  onNoAsistio,
}: {
  lead: Lead;
  onClick: () => void;
  variant?: "default" | "citadosHoy";
  onAsistencia?: (l: Lead) => void;
  onNoAsistio?: (l: Lead) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  return (
    <div
      ref={setNodeRef}
      className={isDragging ? "opacity-40" : ""}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Evitar abrir el drawer si se hizo drag.
        if (isDragging) return;
        e.stopPropagation();
        onClick();
      }}
    >
      {variant === "citadosHoy" ? (
        <CitadosHoyCardBody
          lead={lead}
          onAsistencia={onAsistencia!}
          onNoAsistio={onNoAsistio!}
        />
      ) : (
        <LeadCardBody lead={lead} onOpenFicha={onClick} />
      )}
    </div>
  );
}

function LeadCardBody({ lead, onOpenFicha }: { lead: Lead; onOpenFicha?: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copyPhone(e: React.MouseEvent) {
    e.stopPropagation();
    if (!lead.telefono) return;
    try {
      await navigator.clipboard.writeText(lead.telefono);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  const diasDesdeCreacion = Math.floor(
    (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <article
      style={{
        borderColor: "var(--card-border)",
        boxShadow: "var(--card-shadow-rest)",
      }}
      className="rounded-xl bg-[var(--color-surface)] border p-3 text-xs hover:[border-color:var(--card-border-hover)] hover:[box-shadow:var(--card-shadow-hover)] transition-[box-shadow,border-color] duration-150 cursor-pointer"
    >
      {/* Sprint 14a Bloque 1.5 — leads convertidos enlazan al Paciente360. */}
      {lead.convertido && lead.pacienteId ? (
        <a
          href={`/pacientes/${lead.pacienteId}`}
          onClick={(e) => e.stopPropagation()}
          className="font-display font-medium text-[var(--color-foreground)] truncate tracking-tight hover:text-[var(--color-accent)] hover:underline block"
        >
          {lead.nombre}
        </a>
      ) : (
        <p className="font-display font-medium text-[var(--color-foreground)] truncate tracking-tight">{lead.nombre}</p>
      )}

      <div className="flex flex-wrap gap-1 mt-1.5">
        {/* Descartado: el motivo se lee en la card, no hay que abrir la ficha. */}
        {lead.motivoNoInteres && (
          <span className="inline-flex rounded-md bg-[var(--color-surface-muted)] text-[var(--color-muted)] border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium">
            {labelMotivo(lead.motivoNoInteres)}
          </span>
        )}
        {lead.canal && (
          <span className="inline-flex rounded-md bg-[var(--color-surface-muted)] text-[var(--color-muted)] border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium">
            {lead.canal}
          </span>
        )}
        {lead.tratamiento && (
          <span className="inline-flex rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-transparent px-1.5 py-0.5 text-[10px] font-medium">
            {lead.tratamiento}
          </span>
        )}
      </div>

      {lead.telefono && (
        <div className="flex items-center gap-1 mt-2">
          <span className="text-[var(--color-muted)] text-[11px] font-mono truncate tabular-nums">{lead.telefono}</span>
          <button
            type="button"
            onClick={copyPhone}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
            title="Copiar"
            aria-label="Copiar teléfono"
          >
            {copied ? (
              <Check size={12} strokeWidth={ICON_STROKE} className="text-[var(--color-success)]" aria-hidden />
            ) : (
              <Copy size={12} strokeWidth={ICON_STROKE} aria-hidden />
            )}
          </button>
        </div>
      )}

      {lead.fechaCita && (
        <p className="mt-1 text-[10px] text-[var(--color-muted)] tabular-nums">Cita: {lead.fechaCita}</p>
      )}

      <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--color-muted)]">
        {lead.llamado && (
          <span className="inline-flex items-center gap-1">
            <Phone size={12} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" /> Llamado
          </span>
        )}
        {lead.whatsappEnviados > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <MessageCircle size={12} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" /> {lead.whatsappEnviados}
          </span>
        )}
        <span className="ml-auto tabular-nums">
          {Number.isFinite(diasDesdeCreacion) ? `hace ${diasDesdeCreacion}d` : "—"}
        </span>
      </div>

      <div className="flex gap-1 mt-2.5">
        {lead.telefono && (
          <>
            <a
              href={`tel:${lead.telefono}`}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 text-center rounded-md bg-[var(--color-surface-muted)] text-[var(--color-foreground)] text-[10px] font-medium py-1.5 hover:bg-[var(--color-border)] transition-colors"
            >
              Llamar
            </a>
            {/* Censo wa.me a cero (2026-07-26): el botón abre la FICHA (hilo
                visible + mensaje precargado + registro por el servicio
                central), nunca wa.me a pelo — aquello abría un chat vacío y
                fingía un registro sin contenido. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFicha?.();
              }}
              className="flex-1 text-center rounded-md bg-[var(--fyllio-wa-green)] text-white text-[10px] font-medium py-1.5 hover:bg-[var(--fyllio-wa-green-hover)] transition-colors"
            >
              WhatsApp
            </button>
          </>
        )}
      </div>
    </article>
  );
}

// Fix 2: card específica de la columna "Citados Hoy". Muestra toda la
// info útil para que la coord no tenga que abrir el drawer + dos botones
// que disparan los flujos finales (asistencia con modal / no asistió
// directo). Fondo rosa muy tenue para distinguirla visualmente.
function CitadosHoyCardBody({
  lead,
  onAsistencia,
  onNoAsistio,
}: {
  lead: Lead;
  onAsistencia: (l: Lead) => void;
  onNoAsistio: (l: Lead) => void;
}) {
  return (
    <article
      style={{ boxShadow: "var(--card-shadow-rest)" }}
      className="rounded-xl bg-rose-50/50 dark:bg-rose-500/5 border border-rose-200 dark:border-rose-500/30 p-3 text-xs hover:[box-shadow:var(--card-shadow-hover)] transition-[box-shadow,border-color] duration-150 cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-display font-semibold text-[var(--color-foreground)] truncate flex-1">{lead.nombre}</p>
        {lead.horaCita && (
          <span className="text-[10px] font-semibold text-rose-700 dark:text-rose-300 shrink-0 tabular-nums">
            {lead.horaCita}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mt-1">
        {lead.canal && (
          <span className="inline-flex rounded-full bg-[var(--color-surface)] text-[var(--color-accent)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold">
            {lead.canal}
          </span>
        )}
        {lead.tratamiento && (
          <span className="inline-flex rounded-full bg-[var(--color-surface)] text-[var(--color-accent)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold">
            {lead.tratamiento}
          </span>
        )}
      </div>

      {lead.telefono && (
        <p className="text-[var(--color-muted)] text-[11px] font-mono mt-2 truncate tabular-nums">
          {lead.telefono}
        </p>
      )}
      {lead.fechaCita && (
        <p className="mt-0.5 text-[10px] text-[var(--color-muted)] tabular-nums">
          Cita: {lead.fechaCita}
          {lead.horaCita ? ` · ${lead.horaCita}` : ""}
        </p>
      )}

      <div className="flex gap-1.5 mt-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNoAsistio(lead);
          }}
          className="flex-1 rounded-lg bg-[var(--color-surface)] text-[var(--color-foreground)] border border-[var(--color-border)] text-[11px] font-semibold py-1.5 hover:bg-[var(--color-surface-muted)]"
        >
          No asistió
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAsistencia(lead);
          }}
          className="flex-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[11px] font-semibold py-1.5 hover:bg-[var(--color-accent-hover)]"
        >
          Marcar asistido
        </button>
      </div>
    </article>
  );
}
