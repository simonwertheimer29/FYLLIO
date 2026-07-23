"use client";

// Sprint 8 Bloque B — Kanban de leads con drag & drop.
// Consume ClinicContext para filtrar por clínica global + filtros locales
// de fecha y búsqueda.

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, MessageCircle, Check, Copy, Plus, ICON_STROKE } from "../../components/icons";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useClinic } from "../../lib/context/ClinicContext";
import { NewLeadModal } from "./NewLeadModal";
import { AccionPanel } from "../../components/shared/AccionPanel";
import { AgendarModal } from "./AgendarModal";
import { AsistenciaModal } from "./AsistenciaModal";
import type { Lead, LeadEstado } from "./types";

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

function columnOf(lead: Lead, today: string): LeadEstado {
  // Citados Hoy = Estado legacy "Citados Hoy" OR Estado="Citado" con Fecha_Cita=hoy.
  if (lead.estado === "Citados Hoy") return "Citados Hoy";
  if (lead.estado === "Citado" && lead.fechaCita === today) return "Citados Hoy";
  return lead.estado;
}

type DateFilter = "semana" | "mes" | "personalizado" | "todo";

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
  const [dateFilter, setDateFilter] = useState<DateFilter>("todo");
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [agendarLead, setAgendarLead] = useState<Lead | null>(null);
  const [asistenciaLead, setAsistenciaLead] = useState<Lead | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Filtrado por clínica global + fecha + búsqueda.
  const filteredLeads = useMemo(() => {
    let out = leads;
    if (selectedClinicaId) {
      out = out.filter((l) => l.clinicaId === selectedClinicaId);
    }
    if (dateFilter !== "todo") {
      const now = new Date();
      let from = new Date(0);
      if (dateFilter === "semana") {
        from = new Date(now);
        from.setDate(from.getDate() - 7);
      } else if (dateFilter === "mes") {
        from = new Date(now);
        from.setDate(from.getDate() - 30);
      }
      out = out.filter((l) => new Date(l.createdAt) >= from);
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
  }, [leads, selectedClinicaId, dateFilter, search]);

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

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setDraggingId(String(e.active.id));
  }, []);

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

      // Citados Hoy es columna derivada: el Estado canónico que escribimos
      // en Airtable es "Citado" + Fecha_Cita=hoy.
      const destEstado: LeadEstado =
        destColumn === "Citados Hoy" ? "Citado" : destColumn;

      // Sprint 9 G.2: Contactado → Citado/Citados Hoy requiere modal
      // obligatorio (fecha/hora/doctor/tratamiento/tipo_visita). Si la
      // columna destino es Citados Hoy, AgendarModal ya defaultea a hoy.
      if (lead.estado === "Contactado" && destEstado === "Citado") {
        setAgendarLead(lead);
        return;
      }

      // Sprint 9 G.4: arrastrar a "No Interesado" marca motivo=Rechazo por
      // defecto. El flujo "No asistió" pasa por el botón dedicado del drawer.
      // Otras transiciones limpian el motivo.
      const patchBody: Record<string, any> = { estado: destEstado };
      if (destEstado === "No Interesado" && !lead.motivoNoInteres) {
        patchBody.motivoNoInteres = "Rechazo_Producto";
      } else if (destEstado !== "No Interesado" && lead.motivoNoInteres) {
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
    [leads]
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
          <p className="text-xs text-[var(--color-muted)] mt-0.5 tabular-nums">
            {filteredLeads.length} lead{filteredLeads.length === 1 ? "" : "s"} en el pipeline
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
        <div className="flex gap-1">
          {([
            ["todo", "Todo"],
            ["semana", "Esta semana"],
            ["mes", "Este mes"],
            ["personalizado", "Personalizado"],
          ] as Array<[DateFilter, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setDateFilter(key)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                dateFilter === key
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
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
  onCardClick,
  onAsistencia,
  onNoAsistio,
}: {
  estado: LeadEstado;
  label: string;
  accent: string;
  ringClass?: string;
  items: Lead[];
  onCardClick: (l: Lead) => void;
  onAsistencia: (l: Lead) => void;
  onNoAsistio: (l: Lead) => void;
}) {
  return (
    <div
      id={estado}
      className={`flex flex-col min-h-0 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] ${ringClass ?? ""}`}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
        <span className="font-display text-[13px] font-medium text-[var(--color-foreground)] tracking-tight">{label}</span>
        <span className={`text-[10px] font-semibold tabular-nums px-2 py-0.5 rounded-full ${accent}`}>
          {items.length}
        </span>
      </div>
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
        id={estado}
      >
        <div
          className="flex-1 min-h-[120px] p-2 space-y-2 overflow-y-auto"
          data-estado={estado}
        >
          {estado === "No Interesado" ? (
            <NoInteresadoGroups items={items} onCardClick={onCardClick} />
          ) : estado === "Citados Hoy" ? (
            items.map((l) => (
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
            items.map((l) => (
              <SortableLeadCard key={l.id} lead={l} onClick={() => onCardClick(l)} />
            ))
          )}
          {items.length === 0 && (
            <div
              id={estado}
              className="h-full min-h-[80px] flex items-center justify-center text-[11px] text-[var(--color-muted)] italic"
            >
              Sin leads
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// Sprint 9 G.4: en la columna "No Interesado" separamos visualmente los
// leads por motivo (No asistió vs Rechazo producto) para distinguir los
// reactivables (No asistió) del rechazo definitivo.
function NoInteresadoGroups({
  items,
  onCardClick,
}: {
  items: Lead[];
  onCardClick: (l: Lead) => void;
}) {
  const noAsistio = items.filter((l) => l.motivoNoInteres === "No_Asistio");
  const rechazo = items.filter((l) => l.motivoNoInteres !== "No_Asistio");
  return (
    <>
      {noAsistio.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 px-1 mt-1">
            No asistió · {noAsistio.length}
          </p>
          {noAsistio.map((l) => (
            <SortableLeadCard key={l.id} lead={l} onClick={() => onCardClick(l)} />
          ))}
        </>
      )}
      {rechazo.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] px-1 mt-2">
            Rechazo · {rechazo.length}
          </p>
          {rechazo.map((l) => (
            <SortableLeadCard key={l.id} lead={l} onClick={() => onCardClick(l)} />
          ))}
        </>
      )}
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
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
        <LeadCardBody lead={lead} />
      )}
    </div>
  );
}

function LeadCardBody({ lead }: { lead: Lead }) {
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
            <a
              href={`https://wa.me/${lead.telefono.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-1 text-center rounded-md bg-[var(--fyllio-wa-green)] text-white text-[10px] font-medium py-1.5 hover:bg-[var(--fyllio-wa-green-hover)] transition-colors"
            >
              WhatsApp
            </a>
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
