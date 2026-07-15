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
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/Feedback";
import { AlertTriangle, Inbox, ICON_STROKE } from "../../components/icons";
import { toast } from "sonner";

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
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col overflow-auto p-4 lg:p-6 gap-4">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">Actuar hoy</h1>
            <p className="text-xs text-[var(--color-muted)]">
              Cola priorizada para que cierres todo desde aquí, sin saltar al kanban.
            </p>
          </div>
          <div className="flex gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
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
                className={`text-xs font-semibold px-4 py-1.5 rounded-full transition-colors ${
                  tab === id
                    ? "bg-[var(--color-foreground)] text-[var(--color-background)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
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
  // Indicador sutil cuando el refresh falla: mantenemos la lista anterior
  // (deliberado) pero avisamos de que puede estar desactualizada.
  const [sinConexion, setSinConexion] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [filter, setFilter] = useState<LeadSubFilter>("citados");
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [asistenciaLead, setAsistenciaLead] = useState<Lead | null>(null);
  const [tiempoMedioMin, setTiempoMedioMin] = useState<number | null>(null);
  // Sprint 15 Bloque 7 — map leadId → ISO de la última acción saliente
  // (Llamada o WhatsApp_Saliente). Lo consume priorityForLead para el
  // trigger 'caliente sin acción >12h' con timestamp real.
  const [ultimaSalientePorLead, setUltimaSalientePorLead] = useState<
    Record<string, string>
  >({});
  // Última respuesta entrante del paciente por lead — con la saliente permite
  // derivar el estado "esperando respuesta" (§ esperaLead).
  const [ultimaEntrantePorLead, setUltimaEntrantePorLead] = useState<
    Record<string, string>
  >({});

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsRes, kpiRes, salRes] = await Promise.all([
        fetch("/api/leads" + (selectedClinicaId ? `?clinica=${selectedClinicaId}` : "")),
        fetch("/api/leads/kpi-hoy"),
        fetch("/api/leads/ultima-saliente"),
      ]);
      const d = await leadsRes.json();
      if (Array.isArray(d?.leads)) setLeads(d.leads);
      const kpi = await kpiRes.json().catch(() => ({}));
      setTiempoMedioMin(typeof kpi?.tiempoMedioMin === "number" ? kpi.tiempoMedioMin : null);
      const sal = await salRes.json().catch(() => ({}));
      setUltimaSalientePorLead(
        sal?.ultimaSalientePorLead && typeof sal.ultimaSalientePorLead === "object"
          ? sal.ultimaSalientePorLead
          : {},
      );
      setUltimaEntrantePorLead(
        sal?.ultimaEntrantePorLead && typeof sal.ultimaEntrantePorLead === "object"
          ? sal.ultimaEntrantePorLead
          : {},
      );
      setLastUpdate(new Date());
      setSinConexion(false);
    } catch {
      /* swallow — mantener lista anterior */
      setSinConexion(true);
    } finally {
      setLoading(false);
    }
  }, [selectedClinicaId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const today = new Date().toISOString().slice(0, 10);
  const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Buckets accionables del día. Pendientes = leads accionables del día.
  const { citados, sinContactar, seguimiento } = useMemo(() => {
    const citados: Lead[] = [];
    const sinContactar: Lead[] = [];
    const seguimiento: Lead[] = [];
    for (const l of leads) {
      if (l.convertido) continue;
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
    return { citados, sinContactar, seguimiento };
  }, [leads, today, hace48h]);

  // KPI "atendidos hoy" = leads que pasaron a esperando respuesta hoy (con una
  // acción saliente registrada hoy). NO son "completados" ni "cerrados": la
  // pelota está en el paciente.
  const atendidosHoy = useMemo(() => {
    let n = 0;
    for (const l of leads) {
      if (l.convertido) continue;
      const sal = ultimaSalientePorLead[l.id];
      if (sal && sal.slice(0, 10) === today) n++;
    }
    return n;
  }, [leads, today, ultimaSalientePorLead]);

  const allAccionables = [...citados, ...sinContactar, ...seguimiento];
  const filteredLeads =
    filter === "todos"
      ? allAccionables
      : filter === "citados"
        ? citados
        : filter === "sin-contactar"
          ? sinContactar
          : seguimiento;

  // Orden de la cola: primero los PENDIENTES, luego los que están ESPERANDO
  // respuesta (abajo). Dentro de cada bloque, la prioridad se conserva
  // (ALTO→MEDIO→BAJO); desempate por hora de cita / antigüedad. Así un ALTO
  // esperando queda por encima de un MEDIO esperando, pero por debajo de
  // cualquier pendiente.
  const orderedLeads = useMemo(() => {
    const decorated = filteredLeads.map((l) => ({
      l,
      esperando: esperaLead(l, ultimaSalientePorLead, ultimaEntrantePorLead).esperando ? 1 : 0,
      rank: PRIORITY_RANK[priorityForLead(l, ultimaSalientePorLead).label],
      hora: l.horaCita ?? "",
      created: new Date(l.createdAt).getTime() || 0,
    }));
    decorated.sort(
      (a, b) =>
        a.esperando - b.esperando ||
        a.rank - b.rank ||
        (a.hora && b.hora ? a.hora.localeCompare(b.hora) : 0) ||
        a.created - b.created,
    );
    return decorated.map((d) => d.l);
  }, [filteredLeads, ultimaSalientePorLead, ultimaEntrantePorLead]);

  // Marca optimista al actuar: fija la última saliente = ahora para que la card
  // pase a "esperando respuesta" al instante; fetchLeads reconcilia con datos.
  const marcarActuado = useCallback((leadId: string) => {
    setUltimaSalientePorLead((prev) => ({ ...prev, [leadId]: new Date().toISOString() }));
  }, []);

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
          // Pendientes de acción = accionables que NO están esperando respuesta
          // (esos cuentan como "atendidos", no se doblan en pendientes).
          pendientes: allAccionables.filter(
            (l) => !esperaLead(l, ultimaSalientePorLead, ultimaEntrantePorLead).esperando,
          ).length,
          atendidosHoy,
          tiempoMedioMin,
        }}
        lastUpdate={lastUpdate}
        onRefresh={fetchLeads}
        loading={loading}
      />

      {sinConexion && (
        <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden />
          Sin conexión · mostrando los últimos datos, se reintentará al actualizar
        </span>
      )}

      {/* Pills de sub-filtro (mismo lenguaje que el secondary navbar de Presupuestos). */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
              filter === id
                ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                : "bg-[var(--color-surface-muted)] text-[var(--color-muted)] hover:bg-[var(--color-border)]"
            }`}
          >
            {label} · {count}
          </button>
        ))}
      </div>

      {loading && filteredLeads.length === 0 ? (
        <CardListSkeleton rows={4} />
      ) : filteredLeads.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} strokeWidth={ICON_STROKE} />}
          title="Sin casos en esta vista"
          hint={
            filter === "citados"
              ? "No hay leads citados hoy en este filtro."
              : "No hay leads accionables en este filtro."
          }
        />
      ) : (
        <div className="space-y-2">
          {orderedLeads.map((l) => (
            <LeadAccionRow
              key={l.id}
              lead={l}
              onOpen={() => setDrawerLead(l)}
              onAsistencia={() => setAsistenciaLead(l)}
              onChanged={onLeadChanged}
              onActed={marcarActuado}
              ultimaSalientePorLead={ultimaSalientePorLead}
              ultimaEntrantePorLead={ultimaEntrantePorLead}
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
//     Pregunta precio) y sin actividad saliente posterior >12h.
//
// Sprint 15 Bloque 7 — el trigger 3 ahora usa timestamp real de
// Acciones_Lead (Llamada o WhatsApp_Saliente). Antes era una
// aproximación binaria (whatsappEnviados==0 && !llamado) que perdía
// el caso "envié hace 5 días sin respuesta → sigue caliente". Si el
// map no está cargado todavía, fallback al heurístico legacy.
const INTENCION_CALIENTE = new Set(["Interesado", "Pide cita", "Pregunta precio"]);
const HORAS_12_MS = 12 * 60 * 60 * 1000;

// Orden de la cola: ALTO primero. Lo consume orderedLeads en LeadsTab.
const PRIORITY_RANK: Record<"ALTO" | "MEDIO" | "BAJO", number> = {
  ALTO: 0,
  MEDIO: 1,
  BAJO: 2,
};

// "Esperando respuesta" (estado derivado, no guardado): actué (última saliente:
// WhatsApp/llamada) y la pelota está en el paciente. Vuelve a "pendiente" cuando
// el paciente responde (entrante posterior) o cuando pasan 48h sin respuesta
// (reactivación por tiempo). Se recalcula en cada carga desde Acciones_Lead, así
// que persiste al recargar y no puede quedar colgado en el navegador.
const N_ESPERA_LEADS_MS = 48 * 60 * 60 * 1000;

function esperaLead(
  lead: Lead,
  saliente: Record<string, string>,
  entrante: Record<string, string>,
): { esperando: boolean; desdeISO: string | null } {
  const sal = saliente[lead.id];
  if (!sal) return { esperando: false, desdeISO: null };
  const salMs = new Date(sal).getTime();
  const ent = entrante[lead.id];
  const entMs = ent ? new Date(ent).getTime() : 0;
  const esperando = salMs > entMs && Date.now() - salMs < N_ESPERA_LEADS_MS;
  return { esperando, desdeISO: esperando ? sal : null };
}

function relTimeShort(iso: string): string {
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

function priorityForLead(
  lead: Lead,
  ultimaSalienteISOPorLead: Record<string, string> = {},
): {
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

  const ultimaSalienteISO = ultimaSalienteISOPorLead[lead.id];
  const ultimaSalienteMs = ultimaSalienteISO
    ? new Date(ultimaSalienteISO).getTime()
    : null;
  const sinSalienteUltimas12h =
    ultimaSalienteMs == null
      ? lead.whatsappEnviados === 0 && !lead.llamado // fallback legacy
      : Date.now() - ultimaSalienteMs > HORAS_12_MS;

  const calienteSinAccion =
    lead.estado === "Contactado" &&
    lead.intencionDetectada != null &&
    INTENCION_CALIENTE.has(lead.intencionDetectada) &&
    sinSalienteUltimas12h;

  if (isCitadoHoy || (lead.estado === "Nuevo" && diasDesde >= 1) || calienteSinAccion) {
    return { variant: "danger", label: "ALTO", borderColor: "var(--color-danger)" };
  }

  const seguimientoMedio =
    (lead.estado === "Contactado" && diasDesde >= 2) ||
    (lead.estado === "Nuevo" && diasDesde < 1);

  if (seguimientoMedio) {
    return { variant: "warning", label: "MEDIO", borderColor: "var(--color-warning)" };
  }

  return { variant: "neutral", label: "BAJO", borderColor: "var(--color-muted)" };
}

function LeadAccionRow({
  lead,
  onOpen,
  onAsistencia,
  onChanged,
  onActed,
  ultimaSalientePorLead,
  ultimaEntrantePorLead,
}: {
  lead: Lead;
  onOpen: () => void;
  onAsistencia: () => void;
  onChanged: (l: Lead) => void;
  // Marca optimista al actuar → la card pasa a "esperando respuesta" al instante.
  onActed: (leadId: string) => void;
  // Maps para priorityForLead y para derivar "esperando respuesta".
  ultimaSalientePorLead?: Record<string, string>;
  ultimaEntrantePorLead?: Record<string, string>;
}) {
  // "Esperando respuesta" es un estado DERIVADO de los datos (última saliente vs
  // entrante en Acciones_Lead), no del navegador: al recargar sigue igual.
  const espera = esperaLead(
    lead,
    ultimaSalientePorLead ?? {},
    ultimaEntrantePorLead ?? {},
  );

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

  const priority = priorityForLead(lead, ultimaSalientePorLead);

  function llamar(e: React.MouseEvent) {
    e.stopPropagation();
    if (!cleanPhone) return;
    window.open(`tel:${lead.telefono}`, "_self");
    onActed(lead.id); // → esperando respuesta al instante
    toast.success("Llamada registrada · esperando respuesta");
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
    onActed(lead.id); // → esperando respuesta al instante
    toast.success("Enviado · esperando respuesta");
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
  if (espera.esperando) {
    // Ya actué; la pelota está en el paciente. No re-ofrecemos "enviar/llamar"
    // (evita doble envío); si quiere insistir, entra a la ficha.
    actions.push({
      label: espera.desdeISO
        ? `Esperando respuesta · ${relTimeShort(espera.desdeISO)}`
        : "Esperando respuesta",
      onClick: (e) => e.stopPropagation(),
      variant: "ghost",
      disabled: true,
    });
  } else if (cleanPhone) {
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
      faded={espera.esperando}
      title={
        lead.convertido && lead.pacienteId ? (
          <a
            href={`/pacientes/${lead.pacienteId}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-[var(--color-accent)] hover:underline"
          >
            {lead.nombre}
          </a>
        ) : (
          lead.nombre
        )
      }
      titleRight={
        <div className="flex items-center gap-2">
          {isCitadoHoy && lead.horaCita && (
            <span className="text-[10px] font-semibold text-rose-700 dark:text-rose-300 tabular-nums">
              {lead.horaCita}
            </span>
          )}
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border ${
              priority.variant === "danger"
                ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30"
                : priority.variant === "warning"
                  ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30"
                  : "bg-[var(--color-surface-muted)] text-[var(--color-muted)] border-[var(--color-border)]"
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
