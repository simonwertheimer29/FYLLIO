"use client";

// Sprint 8 Bloque B — Kanban de leads con drag & drop.
// Consume ClinicContext para filtrar por clínica global + filtros locales
// de fecha y búsqueda.

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
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
import { LeadDrawer } from "./LeadDrawer";
import { AgendarModal } from "./AgendarModal";
import { AsistenciaModal } from "./AsistenciaModal";

type LeadEstado =
  | "Nuevo"
  | "Contactado"
  | "Citado"
  | "Citados Hoy"
  | "No Interesado"
  | "Convertido";

export type Lead = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  tratamiento: string | null;
  canal: string | null;
  estado: LeadEstado;
  clinicaId: string | null;
  clinicaNombre: string | null;
  fechaCita: string | null;
  horaCita: string | null;
  doctorAsignadoId: string | null;
  tipoVisita: "Primera visita" | "Revisión" | "Urgencia" | null;
  motivoNoInteres: "Rechazo_Producto" | "No_Asistio" | null;
  llamado: boolean;
  whatsappEnviados: number;
  ultimaAccion: string | null;
  notas: string | null;
  convertido: boolean;
  pacienteId: string | null;
  asistido: boolean;
  createdAt: string;
};

const COLUMNS: Array<{ estado: LeadEstado; label: string; accent: string }> = [
  { estado: "Nuevo", label: "Nuevo", accent: "bg-slate-100 text-slate-700" },
  { estado: "Contactado", label: "Contactado", accent: "bg-amber-100 text-amber-800" },
  { estado: "Citado", label: "Citado", accent: "bg-sky-100 text-sky-800" },
  { estado: "Citados Hoy", label: "Citados Hoy", accent: "bg-rose-100 text-rose-800" },
  { estado: "No Interesado", label: "No Interesado", accent: "bg-slate-200 text-slate-600" },
];

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

  const leadsPorEstado = useMemo(() => {
    const m = new Map<LeadEstado, Lead[]>();
    for (const col of COLUMNS) m.set(col.estado, []);
    for (const l of filteredLeads) {
      const arr = m.get(l.estado);
      if (arr) arr.push(l);
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
      // overId puede ser una columna (estado) o otra tarjeta.
      const overColumn = COLUMNS.find((c) => c.estado === overId);
      const destEstado: LeadEstado | undefined = overColumn
        ? overColumn.estado
        : leads.find((l) => l.id === overId)?.estado;
      if (!destEstado) return;

      const lead = leads.find((l) => l.id === activeId);
      if (!lead || lead.estado === destEstado) return;

      // Sprint 9 G.2: Contactado → Citado requiere modal obligatorio
      // con fecha/hora/doctor/tratamiento/tipo_visita. Interceptamos el
      // drag y abrimos el modal en vez de PATCH directo. Si se cancela,
      // el lead se queda en Contactado (no hacemos rollback porque nunca
      // aplicamos la transición optimista en este caso).
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

      // Optimistic update.
      setLeads((prev) =>
        prev.map((l) =>
          l.id === activeId
            ? {
                ...l,
                estado: destEstado,
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
              ? { ...l, estado: lead.estado, motivoNoInteres: lead.motivoNoInteres }
              : l
          )
        );
        setError("No se pudo mover el lead. Inténtalo de nuevo.");
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

  const draggingLead = draggingId ? leads.find((l) => l.id === draggingId) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 p-6 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Leads</h1>
          <p className="text-xs text-slate-500">
            {filteredLeads.length} lead{filteredLeads.length === 1 ? "" : "s"} en el pipeline
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewLeadOpen(true)}
          className="rounded-full bg-sky-600 text-white text-xs font-bold px-4 py-2 hover:bg-sky-700 transition-colors"
        >
          + Nuevo Lead
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
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
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
          className="flex-1 min-w-[180px] max-w-sm rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
      </div>

      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
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
            const items = leadsPorEstado.get(col.estado) ?? [];
            return (
              <KanbanColumn
                key={col.estado}
                estado={col.estado}
                label={col.label}
                accent={col.accent}
                items={items}
                onCardClick={(l) => setDrawerLead(l)}
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
        <LeadDrawer
          lead={drawerLead}
          clinicas={clinicasSelectables}
          onClose={() => setDrawerLead(null)}
          onUpdated={onLeadUpdated}
          onConverted={onLeadConverted}
          onAgendar={(l) => setAgendarLead(l)}
          onAsistencia={(l) => setAsistenciaLead(l)}
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
  items,
  onCardClick,
}: {
  estado: LeadEstado;
  label: string;
  accent: string;
  items: Lead[];
  onCardClick: (l: Lead) => void;
}) {
  return (
    <div
      id={estado}
      className={`flex flex-col min-h-0 rounded-2xl bg-white border border-slate-200 ${
        estado === "Citados Hoy" ? "ring-2 ring-rose-200" : ""
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
        <span className="text-xs font-bold text-slate-800">{label}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${accent}`}>
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
          ) : (
            items.map((l) => (
              <SortableLeadCard key={l.id} lead={l} onClick={() => onCardClick(l)} />
            ))
          )}
          {items.length === 0 && (
            <div
              id={estado}
              className="h-full min-h-[80px] flex items-center justify-center text-[11px] text-slate-300 italic"
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
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 px-1 mt-1">
            No asistió · {noAsistio.length}
          </p>
          {noAsistio.map((l) => (
            <SortableLeadCard key={l.id} lead={l} onClick={() => onCardClick(l)} />
          ))}
        </>
      )}
      {rechazo.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 px-1 mt-2">
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

function SortableLeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
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
      <LeadCardBody lead={lead} />
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
    <article className="rounded-xl bg-white border border-slate-200 p-3 text-xs shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer">
      <p className="font-bold text-slate-900 truncate">{lead.nombre}</p>

      <div className="flex flex-wrap gap-1 mt-1">
        {lead.canal && (
          <span className="inline-flex rounded-full bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 text-[10px] font-semibold">
            {lead.canal}
          </span>
        )}
        {lead.tratamiento && (
          <span className="inline-flex rounded-full bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 text-[10px] font-semibold">
            {lead.tratamiento}
          </span>
        )}
      </div>

      {lead.telefono && (
        <div className="flex items-center gap-1 mt-2">
          <span className="text-slate-600 text-[11px] font-mono truncate">{lead.telefono}</span>
          <button
            type="button"
            onClick={copyPhone}
            className="text-[10px] text-slate-400 hover:text-slate-700"
            title="Copiar"
          >
            {copied ? "✓" : "⎘"}
          </button>
        </div>
      )}

      {lead.fechaCita && (
        <p className="mt-1 text-[10px] text-slate-500">Cita: {lead.fechaCita}</p>
      )}

      <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500">
        {lead.llamado && <span>📞 Llamado</span>}
        {lead.whatsappEnviados > 0 && <span>💬 {lead.whatsappEnviados}</span>}
        <span className="ml-auto">hace {diasDesdeCreacion}d</span>
      </div>

      <div className="flex gap-1 mt-2">
        {lead.telefono && (
          <>
            <a
              href={`tel:${lead.telefono}`}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 text-center rounded-lg bg-slate-50 text-slate-700 text-[10px] font-semibold py-1 hover:bg-slate-100"
            >
              Llamar
            </a>
            <a
              href={`https://wa.me/${lead.telefono.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-1 text-center rounded-lg bg-emerald-50 text-emerald-700 text-[10px] font-semibold py-1 hover:bg-emerald-100"
            >
              WhatsApp
            </a>
          </>
        )}
      </div>
    </article>
  );
}
