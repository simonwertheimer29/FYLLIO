"use client";

// Sprint 9 fix unificación — Actuar Hoy con sub-tabs visualmente
// indistinguibles. Mismo header de KPIs, mismo modelo de cards, mismo
// panel lateral derecho.
//
// [Leads] (default) · [Presupuestos]

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  UserSession,
  PresupuestoIntervencion,
  PresupuestoEstado,
  MotivoPerdida,
} from "../../lib/presupuestos/types";
import type { Lead } from "../leads/types";
import { useClinic } from "../../lib/context/ClinicContext";
import { ActuarHoyHeader } from "../../components/shared/ActuarHoyHeader";
import { AccionCard } from "../../components/shared/AccionCard";
import { AccionPanel } from "../../components/shared/AccionPanel";
import { AsistenciaModal } from "../leads/AsistenciaModal";
import IntervencionView from "../../components/presupuestos/IntervencionView";

type Tab = "leads" | "presupuestos";

export function ActuarHoyView({
  user,
  initialLeads,
}: {
  user: UserSession;
  initialLeads: Lead[];
}) {
  const [tab, setTab] = useState<Tab>("leads");
  // Sprint 9 fix unificación cierre — el SidePanel de Presupuestos se monta
  // al nivel de ActuarHoyView (igual que el patrón pre-fix). Lo abrimos vía
  // AccionPanel kind="presupuesto" para conservar el wrapper unificado.
  const [presupuestoDrawer, setPresupuestoDrawer] = useState<PresupuestoIntervencion | null>(null);
  const [presupuestoReloadKey, setPresupuestoReloadKey] = useState(0);

  async function handleChangePresupuestoEstado(
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
      setPresupuestoReloadKey((k) => k + 1);
    } catch {
      // El polling interno de IntervencionView lo recupera.
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col overflow-auto p-4 lg:p-6 gap-4">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Actuar hoy</h1>
            <p className="text-xs text-slate-500">
              Cola priorizada para que cierres todo desde aquí, sin saltar al kanban.
            </p>
          </div>
          <div className="flex gap-1 rounded-full border border-slate-200 bg-white p-0.5">
            {(
              [
                ["leads", "Leads"],
                ["presupuestos", "Presupuestos"],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`text-xs font-bold px-4 py-1.5 rounded-full transition-colors ${
                  tab === id
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {tab === "leads" ? (
          <LeadsTab initialLeads={initialLeads} />
        ) : (
          <PresupuestosTab
            user={user}
            onOpenDrawer={setPresupuestoDrawer}
            reloadKey={presupuestoReloadKey}
          />
        )}
      </div>

      {presupuestoDrawer && (
        <AccionPanel
          kind="presupuesto"
          item={presupuestoDrawer}
          onClose={() => setPresupuestoDrawer(null)}
          onChangeEstado={(id, estado) => {
            handleChangePresupuestoEstado(id, estado);
            setPresupuestoDrawer(null);
          }}
          onRefresh={() => setPresupuestoDrawer(null)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-tab Leads
// ──────────────────────────────────────────────────────────────────────

type LeadSubFilter = "citados" | "sin-contactar" | "seguimiento" | "todos";

function LeadsTab({ initialLeads }: { initialLeads: Lead[] }) {
  const { selectedClinicaId } = useClinic();
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [filter, setFilter] = useState<LeadSubFilter>("citados");
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [asistenciaLead, setAsistenciaLead] = useState<Lead | null>(null);
  const [tiempoMedioMin, setTiempoMedioMin] = useState<number | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsRes, kpiRes] = await Promise.all([
        fetch("/api/leads" + (selectedClinicaId ? `?clinica=${selectedClinicaId}` : "")),
        fetch("/api/leads/kpi-hoy"),
      ]);
      const d = await leadsRes.json();
      if (Array.isArray(d?.leads)) setLeads(d.leads);
      const kpi = await kpiRes.json().catch(() => ({}));
      setTiempoMedioMin(typeof kpi?.tiempoMedioMin === "number" ? kpi.tiempoMedioMin : null);
      setLastUpdate(new Date());
    } catch {
      /* swallow — mantener lista anterior */
    } finally {
      setLoading(false);
    }
  }, [selectedClinicaId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const today = new Date().toISOString().slice(0, 10);
  const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // KPI: completadas hoy = leads con Ultima_Accion que contiene un
  // timestamp de hoy. Pendientes = leads accionables del día.
  const { citados, sinContactar, seguimiento, completadasHoy } = useMemo(() => {
    const citados: Lead[] = [];
    const sinContactar: Lead[] = [];
    const seguimiento: Lead[] = [];
    let completadas = 0;
    for (const l of leads) {
      if (l.convertido) continue;
      // KPI completadas hoy: cualquier línea de Ultima_Accion con
      // timestamp ISO de hoy.
      if (l.ultimaAccion && l.ultimaAccion.includes(`[${today}`)) completadas++;

      if (
        (l.estado === "Citado" || l.estado === "Citados Hoy") &&
        l.fechaCita === today &&
        !l.asistido
      ) {
        citados.push(l);
        continue;
      }
      if (l.estado === "Nuevo" && !l.llamado) {
        sinContactar.push(l);
        continue;
      }
      if (l.estado === "Contactado" && l.createdAt <= hace48h) {
        seguimiento.push(l);
      }
    }
    return { citados, sinContactar, seguimiento, completadasHoy: completadas };
  }, [leads, today, hace48h]);

  const allAccionables = [...citados, ...sinContactar, ...seguimiento];
  const filteredLeads =
    filter === "todos"
      ? allAccionables
      : filter === "citados"
        ? citados
        : filter === "sin-contactar"
          ? sinContactar
          : seguimiento;

  const tabs: Array<[LeadSubFilter, string, number]> = [
    ["citados", "Citados Hoy", citados.length],
    ["sin-contactar", "Sin contactar", sinContactar.length],
    ["seguimiento", "Seguimiento >48h", seguimiento.length],
    ["todos", "Todos", allAccionables.length],
  ];

  function onLeadChanged(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setDrawerLead((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  return (
    <>
      <ActuarHoyHeader
        subtitle="Cola de leads · Hoy"
        kpis={{
          pendientes: allAccionables.length,
          completadasHoy,
          tiempoMedioMin,
        }}
        lastUpdate={lastUpdate}
        onRefresh={fetchLeads}
        loading={loading}
      />

      {/* Pills de sub-filtro (mismo lenguaje que el secondary navbar de Presupuestos). */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
              filter === id
                ? "bg-violet-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {label} · {count}
          </button>
        ))}
      </div>

      {filteredLeads.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center">
          <p className="text-sm font-bold text-slate-700">Sin casos en esta vista</p>
          <p className="text-xs text-slate-400 mt-1">
            {filter === "citados"
              ? "No hay leads citados hoy en este filtro."
              : "No hay leads accionables en este filtro."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredLeads.map((l) => (
            <LeadAccionRow
              key={l.id}
              lead={l}
              onOpen={() => setDrawerLead(l)}
              onAsistencia={() => setAsistenciaLead(l)}
              onChanged={onLeadChanged}
            />
          ))}
        </div>
      )}

      {drawerLead && (
        <AccionPanel
          kind="lead"
          item={drawerLead}
          onClose={() => setDrawerLead(null)}
          onChanged={onLeadChanged}
          onAsistencia={(l) => setAsistenciaLead(l)}
        />
      )}

      {asistenciaLead && (
        <AsistenciaModal
          lead={asistenciaLead}
          onClose={() => setAsistenciaLead(null)}
          onDone={(updated) => {
            onLeadChanged(updated);
            setAsistenciaLead(null);
          }}
        />
      )}
    </>
  );
}

// Sprint 13 Bloque 5 — pill prioridad heuristica para leads.
// Triggers ALTO (cerrados con Simon en pre-sprint):
//  1. Citado/Citados Hoy con fechaCita=hoy y NO asistido.
//  2. estado=Nuevo y diasDesde >= 1 (sin contactar >24h).
//  3. estado=Contactado con intencionDetectada alta (Interesado, Pide cita,
//     Pregunta precio) y sin actividad saliente posterior. Aproximamos
//     "sin actividad >12h" via whatsappEnviados==0 + llamado==false (no
//     tenemos timestamp por accion saliente accesible aqui sin fetch).
const INTENCION_CALIENTE = new Set(["Interesado", "Pide cita", "Pregunta precio"]);

function priorityForLead(lead: Lead): {
  variant: "danger" | "warning" | "neutral";
  label: "ALTO" | "MEDIO" | "BAJO";
  borderColor: string;
} {
  const today = new Date().toISOString().slice(0, 10);
  const ts = new Date(lead.createdAt).getTime();
  const diasDesde = Number.isFinite(ts)
    ? Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24))
    : 0;

  const isCitadoHoy =
    (lead.estado === "Citado" || lead.estado === "Citados Hoy") &&
    lead.fechaCita === today &&
    !lead.asistido;

  const calienteSinAccion =
    lead.estado === "Contactado" &&
    lead.intencionDetectada != null &&
    INTENCION_CALIENTE.has(lead.intencionDetectada) &&
    lead.whatsappEnviados === 0 &&
    !lead.llamado;

  if (isCitadoHoy || (lead.estado === "Nuevo" && diasDesde >= 1) || calienteSinAccion) {
    return { variant: "danger", label: "ALTO", borderColor: "#ef4444" };
  }

  const seguimientoMedio =
    (lead.estado === "Contactado" && diasDesde >= 2) ||
    (lead.estado === "Nuevo" && diasDesde < 1);

  if (seguimientoMedio) {
    return { variant: "warning", label: "MEDIO", borderColor: "#f59e0b" };
  }

  return { variant: "neutral", label: "BAJO", borderColor: "#94a3b8" };
}

function LeadAccionRow({
  lead,
  onOpen,
  onAsistencia,
  onChanged,
}: {
  lead: Lead;
  onOpen: () => void;
  onAsistencia: () => void;
  onChanged: (l: Lead) => void;
}) {
  const cleanPhone = (lead.telefono ?? "").replace(/\D/g, "");
  const ts = new Date(lead.createdAt).getTime();
  const diasDesde = Number.isFinite(ts)
    ? Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24))
    : null;
  const tiempoMeta =
    diasDesde == null
      ? "—"
      : diasDesde < 1
        ? "hoy"
        : diasDesde === 1
          ? "hace 1d"
          : `hace ${diasDesde}d`;

  const today = new Date().toISOString().slice(0, 10);
  const isCitadoHoy =
    (lead.estado === "Citado" || lead.estado === "Citados Hoy") && lead.fechaCita === today;

  const priority = priorityForLead(lead);

  function llamar(e: React.MouseEvent) {
    e.stopPropagation();
    if (!cleanPhone) return;
    window.open(`tel:${lead.telefono}`, "_self");
    fetch("/api/leads/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, tipo: "Llamada realizada" }),
    })
      .then((r) => r.json())
      .then((d) => d?.lead && onChanged({ ...d.lead, clinicaNombre: lead.clinicaNombre }))
      .catch(() => {});
  }

  function whatsapp(e: React.MouseEvent) {
    e.stopPropagation();
    if (!cleanPhone) return;
    window.open(`https://wa.me/${cleanPhone}`, "_blank");
    fetch("/api/leads/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, tipo: "WhatsApp enviado" }),
    })
      .then((r) => r.json())
      .then((d) => d?.lead && onChanged({ ...d.lead, clinicaNombre: lead.clinicaNombre }))
      .catch(() => {});
  }

  const tags = [];
  if (lead.tratamiento) tags.push({ label: lead.tratamiento, tone: "neutral" as const });
  if (lead.canal) tags.push({ label: lead.canal, tone: "neutral" as const });
  if (lead.intencionDetectada) {
    tags.push({ label: lead.intencionDetectada, tone: "violet" as const });
  }

  const meta = [
    lead.clinicaNombre,
    lead.telefono,
    tiempoMeta,
    lead.fechaCita ? `Cita ${lead.fechaCita}${lead.horaCita ? ` ${lead.horaCita}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const actions: React.ComponentProps<typeof AccionCard>["actions"] = [];
  if (cleanPhone) {
    actions.push({ label: "Enviar WA", onClick: whatsapp, variant: "emerald" });
    actions.push({ label: "Llamar", onClick: llamar, variant: "ghost" });
  }
  if (isCitadoHoy && !lead.convertido) {
    actions.push({
      label: "Marcar asistido",
      onClick: (e) => {
        e.stopPropagation();
        onAsistencia();
      },
      variant: "primary",
    });
  }
  actions.push({
    label: "Ver ficha →",
    onClick: (e) => {
      e.stopPropagation();
      onOpen();
    },
    variant: "primary",
  });

  return (
    <AccionCard
      borderColor={priority.borderColor}
      title={lead.nombre}
      titleRight={
        <div className="flex items-center gap-2">
          {isCitadoHoy && lead.horaCita && (
            <span className="text-[10px] font-semibold text-rose-700 tabular-nums">
              {lead.horaCita}
            </span>
          )}
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border ${
              priority.variant === "danger"
                ? "bg-rose-50 text-rose-700 border-rose-200"
                : priority.variant === "warning"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-slate-50 text-slate-600 border-slate-200"
            }`}
          >
            {priority.label}
          </span>
        </div>
      }
      tags={tags}
      meta={meta}
      quote={lead.notas ?? undefined}
      accionSugerida={lead.accionSugerida ?? undefined}
      onOpen={onOpen}
      actions={actions}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-tab Presupuestos — usa IntervencionView directamente para preservar
// las 8 pills de filtro por intención, el botón "Bulk send WA" y el
// auto-refresh de cola. El SidePanel se sigue montando al nivel de
// ActuarHoyView vía AccionPanel kind="presupuesto" (wrapper a
// IntervencionSidePanel) — visualmente idéntico al panel de leads.
//
// La paridad de unificación con la sub-tab Leads se mantiene por:
// - cards: IntervencionCard de Presupuestos vs AccionCard de Leads
//   tienen la misma forma (borde-izq por urgencia, action bar inline).
// - header de KPIs: IntervencionView tiene su propio header con el
//   mismo gradient/contadores que ActuarHoyHeader.
// - panel lateral: ambos abren AccionPanel.
//
// Los filtros pueden divergir: Presupuestos usa intenciones IA
// (8 tabs), Leads usa estado del pipeline (4 tabs).
// ──────────────────────────────────────────────────────────────────────

function PresupuestosTab({
  user,
  onOpenDrawer,
  reloadKey,
}: {
  user: UserSession;
  onOpenDrawer: (p: PresupuestoIntervencion) => void;
  reloadKey: number;
}) {
  return (
    <IntervencionView
      key={reloadKey}
      user={user}
      onOpenDrawer={onOpenDrawer}
    />
  );
}
