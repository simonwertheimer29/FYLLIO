"use client";

// Sprint 9 fix unificación — Actuar Hoy con sub-tabs visualmente
// indistinguibles. Mismo header de KPIs, mismo modelo de cards, mismo
// panel lateral derecho.
//
// [Leads] (default) · [Presupuestos]

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  UserSession,
  PresupuestoIntervencion,
  PresupuestoEstado,
  IntervencionResponse,
  MotivoPerdida,
} from "../../lib/presupuestos/types";
import type { Lead } from "../leads/types";
import { useClinic } from "../../lib/context/ClinicContext";
import { ActuarHoyHeader } from "../../components/shared/ActuarHoyHeader";
import { AccionCard } from "../../components/shared/AccionCard";
import { AccionPanel } from "../../components/shared/AccionPanel";
import { AsistenciaModal } from "../leads/AsistenciaModal";

type Tab = "leads" | "presupuestos";

export function ActuarHoyView({
  user,
  initialLeads,
}: {
  user: UserSession;
  initialLeads: Lead[];
}) {
  const [tab, setTab] = useState<Tab>("leads");

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
          <PresupuestosTab user={user} />
        )}
      </div>
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

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const url = "/api/leads" + (selectedClinicaId ? `?clinica=${selectedClinicaId}` : "");
      const res = await fetch(url);
      const d = await res.json();
      if (Array.isArray(d?.leads)) setLeads(d.leads);
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
        kpis={{ pendientes: allAccionables.length, completadasHoy }}
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
  const diasDesde = Math.floor(
    (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  const tiempoMeta =
    diasDesde < 1 ? "hoy" : diasDesde === 1 ? "hace 1d" : `hace ${diasDesde}d`;

  const today = new Date().toISOString().slice(0, 10);
  const isCitadoHoy =
    (lead.estado === "Citado" || lead.estado === "Citados Hoy") && lead.fechaCita === today;

  // Color del borde-izq basado en urgencia derivada del estado.
  const borderColor = isCitadoHoy
    ? "#ef4444" // citados hoy → rojo
    : lead.estado === "Nuevo"
      ? diasDesde >= 1
        ? "#f97316"
        : "#94a3b8"
      : lead.estado === "Contactado"
        ? diasDesde >= 2
          ? "#fbbf24"
          : "#94a3b8"
        : "#94a3b8";

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
  if (lead.tratamiento) tags.push({ label: lead.tratamiento, tone: "sky" as const });
  if (lead.canal) tags.push({ label: lead.canal });
  tags.push({ label: lead.estado, tone: "neutral" as const });

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
    actions.push({ label: "💬 WhatsApp", onClick: whatsapp, variant: "emerald" });
    actions.push({ label: "📞 Llamar", onClick: llamar, variant: "ghost" });
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

  return (
    <AccionCard
      borderColor={borderColor}
      title={lead.nombre}
      titleRight={
        isCitadoHoy && lead.horaCita ? (
          <span className="text-[10px] font-extrabold text-rose-700">{lead.horaCita}</span>
        ) : null
      }
      tags={tags}
      meta={meta}
      onOpen={onOpen}
      actions={actions}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-tab Presupuestos — recrea IntervencionView con los componentes
// shared (mismo header de KPIs, AccionCard, AccionPanel) sobre el
// dataset de presupuestos. NO toca el IntervencionView original (queda
// huérfano para limpiar en Sprint 10 si el QA confirma paridad).
// ──────────────────────────────────────────────────────────────────────

function PresupuestosTab({ user }: { user: UserSession }) {
  const { selectedClinicaNombre } = useClinic();
  const [data, setData] = useState<IntervencionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [drawerItem, setDrawerItem] = useState<PresupuestoIntervencion | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const url = new URL("/api/presupuestos/intervencion", location.href);
      if (user.clinica) url.searchParams.set("clinica", user.clinica);
      const res = await fetch(url.toString());
      const d: IntervencionResponse = await res.json();
      setData(d);
      setLastUpdate(new Date());
    } catch {
      /* swallow */
    } finally {
      setLoading(false);
    }
  }, [user.clinica]);

  useEffect(() => {
    fetchData();
    const hour = new Date().getHours();
    const refreshMs = hour >= 9 && hour < 20 ? 15_000 : 30_000;
    intervalRef.current = setInterval(fetchData, refreshMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const items = useMemo(() => {
    let out = data?.allItems ?? [];
    if (selectedClinicaNombre) out = out.filter((p) => p.clinica === selectedClinicaNombre);
    return [...out].sort(
      (a, b) =>
        (b.urgenciaBidireccional?.scoreFinal ?? 0) -
        (a.urgenciaBidireccional?.scoreFinal ?? 0)
    );
  }, [data, selectedClinicaNombre]);

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
      fetchData();
    } catch {
      /* swallow */
    }
  }

  return (
    <>
      <ActuarHoyHeader
        subtitle="Cola de intervención · Hoy"
        kpis={{
          pendientes: data?.totalPendientes ?? 0,
          completadasHoy: data?.completadasHoy ?? 0,
        }}
        lastUpdate={lastUpdate}
        onRefresh={() => {
          setLoading(true);
          fetchData();
        }}
        loading={loading}
      />

      {loading && !data ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-32 rounded-2xl bg-slate-100" />
          <div className="h-32 rounded-2xl bg-slate-100" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center">
          <p className="text-sm font-bold text-slate-700">Sin casos en esta vista</p>
          <p className="text-xs text-slate-400 mt-1">
            No hay presupuestos pendientes en este filtro.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <PresupuestoAccionRow
              key={p.id}
              item={p}
              onOpen={() => setDrawerItem(p)}
              onRefresh={fetchData}
            />
          ))}
        </div>
      )}

      {drawerItem && (
        <AccionPanel
          kind="presupuesto"
          item={drawerItem}
          onClose={() => setDrawerItem(null)}
          onChangeEstado={(id, estado) => {
            handleChangeEstado(id, estado);
            setDrawerItem(null);
          }}
          onRefresh={() => setDrawerItem(null)}
        />
      )}
    </>
  );
}

function PresupuestoAccionRow({
  item,
  onOpen,
  onRefresh,
}: {
  item: PresupuestoIntervencion;
  onOpen: () => void;
  onRefresh: () => void;
}) {
  const cleanPhone = (item.patientPhone ?? "").replace(/\D/g, "");
  const score = item.urgenciaBidireccional?.scoreFinal ?? 0;
  const borderColor =
    score >= 70 ? "#ef4444" : score >= 50 ? "#f97316" : score >= 30 ? "#fbbf24" : "#94a3b8";

  function enviarWA(e: React.MouseEvent) {
    e.stopPropagation();
    if (!cleanPhone || !item.mensajeSugerido) return;
    navigator.clipboard.writeText(item.mensajeSugerido).catch(() => {});
    window.open(
      `https://wa.me/${cleanPhone}?text=${encodeURIComponent(item.mensajeSugerido)}`,
      "_blank"
    );
    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presupuestoId: item.id, tipo: "WhatsApp enviado" }),
    })
      .then(() => onRefresh())
      .catch(() => {});
  }

  function llamar(e: React.MouseEvent) {
    e.stopPropagation();
    if (!cleanPhone) return;
    window.open(`tel:${item.patientPhone}`, "_self");
    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presupuestoId: item.id, tipo: "Llamada realizada" }),
    })
      .then(() => onRefresh())
      .catch(() => {});
  }

  const tiempoResp = item.fechaUltimaRespuesta
    ? formatTimeAgo(item.fechaUltimaRespuesta)
    : item.diasDesdeUltimoContacto != null
      ? `Hace ${item.diasDesdeUltimoContacto}d`
      : "";

  const tags = item.treatments.map((t) => ({ label: t }));
  const meta = [item.doctor, item.clinica, tiempoResp].filter(Boolean).join(" · ");

  const actions: React.ComponentProps<typeof AccionCard>["actions"] = [];
  if (cleanPhone && item.mensajeSugerido) {
    actions.push({ label: "Enviar WA", onClick: enviarWA, variant: "emerald" });
  }
  if (cleanPhone) {
    actions.push({ label: "Llamar", onClick: llamar, variant: "ghost" });
  }
  actions.push({
    label: "Ver ficha",
    onClick: (e) => {
      e.stopPropagation();
      onOpen();
    },
    variant: "primary",
  });

  return (
    <AccionCard
      borderColor={borderColor}
      title={item.patientName}
      titleRight={
        item.amount != null ? (
          <span className="text-sm font-extrabold text-slate-700">
            €{item.amount.toLocaleString("es-ES")}
          </span>
        ) : null
      }
      score={score || undefined}
      tags={tags}
      meta={meta}
      quote={item.ultimaRespuestaPaciente ?? undefined}
      accionSugerida={item.accionSugerida ?? undefined}
      actions={actions}
      onOpen={onOpen}
    />
  );
}

function formatTimeAgo(isoDate: string): string {
  const diffMin = Math.round((Date.now() - new Date(isoDate).getTime()) / 60000);
  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin}min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Hace ${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  return `Hace ${diffDay}d`;
}
