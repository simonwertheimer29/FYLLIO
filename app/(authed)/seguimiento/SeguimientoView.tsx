"use client";

// Seguimiento (rediseño 2026-07-25, antes "Actuar hoy") — todos los
// pacientes activos, ordenados por lo que toca hacer. Dos vistas (Leads ·
// Presupuestos) y dentro de Leads cuatro COHORTES derivadas del motor
// intacto (lib/seguimiento/cohortes sobre estadoConversacion + precedencia
// de cita): Citados · Nuevos · En conversación · Rezagados. Partición
// total: ningún activo invisible (invariante vigilada por qa-cohortes).

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  UserSession,
  PresupuestoIntervencion,
  PresupuestoEstado,
  MotivoPerdida,
} from "../../lib/presupuestos/types";
import type { Lead } from "../leads/types";
import { useClinic } from "../../lib/context/ClinicContext";
import { SeguimientoHeader } from "../../components/shared/SeguimientoHeader";
import { AccionCard } from "../../components/shared/AccionCard";
import { AccionPanel } from "../../components/shared/AccionPanel";
import { ColaTabs } from "../../components/shared/ColaTabs";
import { SegmentedToggle } from "../../components/shared/SegmentedToggle";
import { AsistenciaModal } from "../leads/AsistenciaModal";
import { AgendarModal } from "../leads/AgendarModal";
import IntervencionView from "../../components/presupuestos/IntervencionView";
import PagoCierreModal from "../../components/presupuestos/PagoCierreModal";
import MotivoPerdidaModal from "../../components/presupuestos/MotivoPerdidaModal";
import {
  estadoConversacion,
  UMBRAL_REACTIVACION_MS,
  haceTexto,
  type ConversacionClasificada,
} from "../../lib/presupuestos/estado-conversacion";
import { esLeadActivo } from "../../lib/leads/pipeline";
import {
  cohorteLead,
  NUEVO_URGENTE_MS,
  type CohorteLead,
} from "../../lib/seguimiento/cohortes";
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/Feedback";
import { AlertTriangle, Inbox, ICON_STROKE } from "../../components/icons";
import { toast } from "sonner";

type Tab = "leads" | "presupuestos";

// Bloque 2 P1 — doctores para el AgendarModal in situ del panel de lead.
type Doctor = { id: string; nombre: string; clinicaId: string | null };

export function SeguimientoView({
  user,
  initialLeads,
  doctores,
}: {
  user: UserSession;
  initialLeads: Lead[];
  doctores: Doctor[];
}) {
  // Enlaces del dashboard de Red: ?vista=leads|presupuestos abre la cola
  // pedida (lectura en el init para no exigir Suspense de useSearchParams).
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "leads";
    const v = new URLSearchParams(window.location.search).get("vista");
    return v === "presupuestos" ? "presupuestos" : "leads";
  });
  // Sprint 9 fix unificación cierre — el SidePanel de Presupuestos se monta
  // al nivel de SeguimientoView (igual que el patrón pre-fix). Lo abrimos vía
  // AccionPanel kind="presupuesto" para conservar el wrapper unificado.
  const [presupuestoDrawer, setPresupuestoDrawer] = useState<PresupuestoIntervencion | null>(null);
  const [presupuestoReloadKey, setPresupuestoReloadKey] = useState(0);
  // Cierre «Aceptó y pagó»: mismo modal de pago que en /presupuestos (el
  // cierre bueno pregunta el cobro de hoy; nada se escribe hasta confirmar).
  const [pagoCierre, setPagoCierre] = useState<{
    id: string;
    patientName?: string;
    amount?: number;
  } | null>(null);
  // «Rechazó» desde el panel: PERDIDO sin motivo abre el MotivoPerdidaModal
  // (mismo criterio que el shell de /presupuestos); nada se escribe hasta
  // confirmar.
  const [motivoPerdido, setMotivoPerdido] = useState<{
    id: string;
    patientName?: string;
  } | null>(null);

  async function handleChangePresupuestoEstado(
    id: string,
    estado: PresupuestoEstado,
    extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string; reactivar?: boolean }
  ) {
    if (estado === "ACEPTADO") {
      const src = presupuestoDrawer?.id === id ? presupuestoDrawer : undefined;
      setPagoCierre({ id, patientName: src?.patientName, amount: src?.amount });
      return;
    }
    if (estado === "PERDIDO" && !extra?.motivoPerdida) {
      const src = presupuestoDrawer?.id === id ? presupuestoDrawer : undefined;
      setMotivoPerdido({ id, patientName: src?.patientName });
      return;
    }
    try {
      const { reactivar, ...patchExtra } = extra ?? {};
      const res = await fetch(`/api/presupuestos/kanban/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, ...patchExtra }),
      });
      if (!res.ok) throw new Error("update failed");
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
      // Antes: catch silencioso ("el polling lo recupera") — un fallo se veía
      // como éxito. Ahora el error es visible; el polling sigue reconciliando.
      toast.error("No se pudo actualizar el presupuesto. Inténtalo de nuevo.");
    }
  }

  // Confirmación del cierre ACEPTADO: PATCH con el pago adjunto (una sola
  // petición), panel abierto con el item actualizado para el encadenado
  // cierre→aviso, y aviso honesto si el pago no llegó a registrarse.
  async function handleConfirmAceptado(pago: { importe: number; metodo?: string } | null) {
    if (!pagoCierre) return;
    const { id } = pagoCierre;
    setPagoCierre(null);
    try {
      const res = await fetch(`/api/presupuestos/kanban/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "ACEPTADO", ...(pago ? { pago } : {}) }),
      });
      if (!res.ok) throw new Error("update failed");
      const data = await res.json().catch(() => ({}));
      if (pago && data.pagoRegistrado === false) {
        toast.error(
          "El presupuesto quedó aceptado, pero el pago no se pudo registrar. Regístralo desde la ficha del paciente.",
        );
      } else if (pago) {
        toast.success(`Pago de ${pago.importe.toLocaleString("es-ES")} € registrado`);
      }
      setPresupuestoDrawer((prev) =>
        prev && prev.id === id ? { ...prev, estado: "ACEPTADO" } : prev,
      );
      setPresupuestoReloadKey((k) => k + 1);
    } catch {
      toast.error("No se pudo aceptar el presupuesto. Inténtalo de nuevo.");
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col overflow-auto p-4 lg:p-6 gap-4">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">Seguimiento</h1>
            <p className="text-xs text-[var(--color-muted)]">
              Todos tus pacientes activos, ordenados por lo que toca hacer.
            </p>
          </div>
          <SegmentedToggle
            options={[
              { id: "leads" as Tab, label: "Leads" },
              { id: "presupuestos" as Tab, label: "Presupuestos" },
            ]}
            active={tab}
            onChange={setTab}
          />
        </header>

        {tab === "leads" ? (
          <LeadsTab initialLeads={initialLeads} doctores={doctores} />
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
            // Bloque 2 — cierre→aviso: ACEPTADO y PERDIDO se resuelven en su
            // modal (pago / motivo) y el panel se cierra al confirmar; el
            // resto cierra como antes.
            if (estado !== "ACEPTADO" && estado !== "PERDIDO") {
              setPresupuestoDrawer(null);
            }
          }}
          onRefresh={() => setPresupuestoReloadKey((k) => k + 1)}
        />
      )}
      {pagoCierre && (
        <PagoCierreModal
          patientName={pagoCierre.patientName}
          amount={pagoCierre.amount}
          onConfirm={handleConfirmAceptado}
          onCancel={() => setPagoCierre(null)}
        />
      )}
      {motivoPerdido && (
        <MotivoPerdidaModal
          patientName={motivoPerdido.patientName ?? ""}
          onConfirm={(motivo, texto, reactivar) => {
            const { id } = motivoPerdido;
            setMotivoPerdido(null);
            handleChangePresupuestoEstado(id, "PERDIDO", {
              motivoPerdida: motivo,
              motivoPerdidaTexto: texto,
              reactivar,
            });
            setPresupuestoDrawer((prev) => (prev && prev.id === id ? null : prev));
          }}
          onCancel={() => setMotivoPerdido(null)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-tab Leads
// ──────────────────────────────────────────────────────────────────────

// Id de URL → cohorte de la lib ("conversacion" abrevia "en_conversacion").
const URL_A_COHORTE: Record<string, CohorteLead> = {
  citados: "citados",
  nuevos: "nuevos",
  conversacion: "en_conversacion",
  rezagados: "rezagados",
};

// Tramos temporales DENTRO de la cohorte Citados.
type TramoCita = "hoy" | "semana" | "proxima" | "despues";

// Aritmética de fechas en LOCAL (sin toISOString: con huso +2 movería el
// día). Devuelve el domingo de la semana de `hoy` + n semanas.
function finDeSemana(hoy: string, semanas = 0): string {
  const d = new Date(hoy + "T00:00:00");
  const lunes0 = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() + (6 - lunes0) + semanas * 7);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function tramoDeCita(fechaCita: string, hoy: string): TramoCita {
  if (fechaCita <= hoy) return "hoy";
  if (fechaCita <= finDeSemana(hoy)) return "semana";
  if (fechaCita <= finDeSemana(hoy, 1)) return "proxima";
  return "despues";
}

const esNuevoUrgente = (createdAt: string, ahoraMs: number) =>
  ahoraMs - (new Date(createdAt).getTime() || 0) >= NUEVO_URGENTE_MS;

function LeadsTab({ initialLeads, doctores }: { initialLeads: Lead[]; doctores: Doctor[] }) {
  const { selectedClinicaId } = useClinic();
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [loading, setLoading] = useState(false);
  // Indicador sutil cuando el refresh falla: mantenemos la lista anterior
  // (deliberado) pero avisamos de que puede estar desactualizada.
  const [sinConexion, setSinConexion] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  // ?cohorte=citados|nuevos|conversacion|rezagados (dashboard de Red y el
  // redirect de /actuar-hoy). null = apertura automática en la primera
  // cohorte con casos que exigen acción; el click del usuario la fija.
  const [cohorteManual, setCohorteManual] = useState<CohorteLead | null>(() => {
    if (typeof window === "undefined") return null;
    const c = new URLSearchParams(window.location.search).get("cohorte");
    return c ? (URL_A_COHORTE[c] ?? null) : null;
  });
  // Sub-filtro temporal de Citados: null = primer tramo con citas.
  const [tramoManual, setTramoManual] = useState<TramoCita | null>(null);
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [asistenciaLead, setAsistenciaLead] = useState<Lead | null>(null);
  // Bloque 2 P1 — "Agendar" del panel abre AgendarModal in situ (sin saltar de módulo).
  const [agendarLead, setAgendarLead] = useState<Lead | null>(null);
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

  // ── Cohortes: PARTICIÓN TOTAL de los leads activos. Cero condiciones de
  // entrada — el censo del rediseño demostró que la lista de condiciones
  // vieja ("accionables") escondía 6 de 31 activos (DECISIONES 2026-07-25).
  // Clasificación única: estadoConversacion sobre los timestamps fusionados
  // del servidor + precedencia de cita — la MISMA lib que qa-cohortes.
  const clasificados = useMemo(() => {
    return leads
      .filter((l) => !l.convertido && esLeadActivo(l.estado))
      .map((l) => {
        const conv = estadoConversacion(
          {
            ultimoEntranteAt: ultimaEntrantePorLead[l.id] ?? null,
            ultimoSalienteAt: ultimaSalientePorLead[l.id] ?? null,
          },
          UMBRAL_REACTIVACION_MS.lead,
        );
        return {
          l,
          conv,
          cohorte: cohorteLead({ fechaCita: l.fechaCita, hoy: today, conversacion: conv.estado }),
        };
      });
  }, [leads, today, ultimaSalientePorLead, ultimaEntrantePorLead]);

  type Clasificado = (typeof clasificados)[number];
  const cohortes = useMemo(() => {
    const ahora = Date.now();
    const de = (c: CohorteLead) => clasificados.filter((x) => x.cohorte === c);
    const creado = (x: Clasificado) => new Date(x.l.createdAt).getTime() || 0;
    return {
      // Citados: la cita más cercana primero.
      citados: de("citados").sort(
        (a, b) =>
          (a.l.fechaCita ?? "").localeCompare(b.l.fechaCita ?? "") ||
          (a.l.horaCita ?? "").localeCompare(b.l.horaCita ?? ""),
      ),
      // Nuevos: los urgentes (≥48 h sin contactar) suben, el que más lleva
      // esperando primero; el resto, más recientes primero.
      nuevos: de("nuevos").sort((a, b) => {
        const ua = esNuevoUrgente(a.l.createdAt, ahora) ? 1 : 0;
        const ub = esNuevoUrgente(b.l.createdAt, ahora) ? 1 : 0;
        if (ua !== ub) return ub - ua;
        return ua ? creado(a) - creado(b) : creado(b) - creado(a);
      }),
      // En conversación: pendientes de responder SIEMPRE arriba; dentro de
      // cada bloque, el que más tiempo lleva así primero.
      en_conversacion: de("en_conversacion").sort((a, b) => {
        const pa = a.conv.estado === "pendiente_responder" ? 0 : 1;
        const pb = b.conv.estado === "pendiente_responder" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (b.conv.haceMs ?? 0) - (a.conv.haceMs ?? 0);
      }),
      // Rezagados: fuerza = días parados × interés (intención caliente ×2).
      rezagados: de("rezagados")
        .map((x) => ({
          ...x,
          fuerza:
            ((x.conv.haceMs ?? 0) / 86_400_000) *
            (x.l.intencionDetectada && INTENCION_CALIENTE.has(x.l.intencionDetectada) ? 2 : 1),
        }))
        .sort((a, b) => b.fuerza - a.fuerza),
    };
  }, [clasificados]);

  // Apertura automática: primera cohorte con casos que exigen acción
  // (pendientes de responder > nuevos urgentes > rezagados > citados);
  // sin nada urgente, la primera con contenido.
  const cohorteAuto = ((): CohorteLead => {
    const ahora = Date.now();
    if (cohortes.en_conversacion.some((x) => x.conv.estado === "pendiente_responder"))
      return "en_conversacion";
    if (cohortes.nuevos.some((x) => esNuevoUrgente(x.l.createdAt, ahora))) return "nuevos";
    if (cohortes.rezagados.length > 0) return "rezagados";
    if (cohortes.citados.length > 0) return "citados";
    const orden: CohorteLead[] = ["nuevos", "en_conversacion", "citados"];
    return orden.find((c) => cohortes[c].length > 0) ?? "nuevos";
  })();
  const cohorte = cohorteManual ?? cohorteAuto;

  // Tramos de Citados (sub-filtro temporal dentro de la cohorte).
  const tramos = useMemo(() => {
    const t: Record<TramoCita, Clasificado[]> = { hoy: [], semana: [], proxima: [], despues: [] };
    for (const x of cohortes.citados) t[tramoDeCita(x.l.fechaCita!, today)].push(x);
    return t;
  }, [cohortes.citados, today]);
  const tramoAuto = (["hoy", "semana", "proxima", "despues"] as TramoCita[]).find(
    (t) => tramos[t].length > 0,
  ) ?? "hoy";
  const tramo = tramoManual ?? tramoAuto;

  const visibles = cohorte === "citados" ? tramos[tramo] : cohortes[cohorte];

  // KPIs del banner — cada lead cuenta UNA vez: pendientes = exigen acción
  // tuya (responder, primer contacto, reactivar, confirmar la cita de hoy);
  // atendidos = la pelota está en el paciente o la cita es futura.
  const nPendientes =
    cohortes.en_conversacion.filter((x) => x.conv.estado === "pendiente_responder").length +
    cohortes.nuevos.length +
    cohortes.rezagados.length +
    cohortes.citados.filter((x) => x.l.fechaCita === today && !x.l.asistido).length;

  function onLeadChanged(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setDrawerLead((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  return (
    <>
      <SeguimientoHeader
        subtitle="Leads activos"
        kpis={{
          pendientes: nPendientes,
          atendidosHoy: clasificados.length - nPendientes,
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

      {/* Cohortes — pills compartidas de las colas. Una cohorte vacía sigue
          visible con su 0: partición honesta, nada desaparece. */}
      <ColaTabs
        tabs={[
          { id: "citados" as CohorteLead, label: "Citados", count: cohortes.citados.length },
          { id: "nuevos" as CohorteLead, label: "Nuevos", count: cohortes.nuevos.length },
          {
            id: "en_conversacion" as CohorteLead,
            label: "En conversación",
            count: cohortes.en_conversacion.length,
          },
          { id: "rezagados" as CohorteLead, label: "Rezagados", count: cohortes.rezagados.length },
        ]}
        active={cohorte}
        onChange={(c) => setCohorteManual(c)}
      />

      {/* Sub-filtro temporal de Citados. "Más adelante" solo aparece con
          contenido: los tres tramos fijos cubren el trabajo normal, pero una
          cita a 3 semanas no puede quedar invisible. */}
      {cohorte === "citados" && cohortes.citados.length > 0 && (
        <ColaTabs
          tabs={[
            { id: "hoy" as TramoCita, label: "Hoy", count: tramos.hoy.length },
            { id: "semana" as TramoCita, label: "Esta semana", count: tramos.semana.length },
            { id: "proxima" as TramoCita, label: "Próxima semana", count: tramos.proxima.length },
            ...(tramos.despues.length > 0
              ? [{ id: "despues" as TramoCita, label: "Más adelante", count: tramos.despues.length }]
              : []),
          ]}
          active={tramo}
          onChange={(t) => setTramoManual(t)}
        />
      )}

      {loading && visibles.length === 0 ? (
        <CardListSkeleton rows={4} />
      ) : visibles.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} strokeWidth={ICON_STROKE} />}
          title={
            cohorte === "citados"
              ? cohortes.citados.length > 0
                ? "Sin citas en este tramo"
                : "Sin leads citados"
              : cohorte === "nuevos"
                ? "Sin leads nuevos por contactar"
                : cohorte === "en_conversacion"
                  ? "Ninguna conversación abierta"
                  : "Sin leads rezagados"
          }
          hint={
            cohorte === "citados"
              ? cohortes.citados.length > 0
                ? "Elige otro tramo para ver el resto de citas."
                : "Cuando un lead tenga cita hoy o en el futuro, aparecerá aquí para confirmarla."
              : cohorte === "nuevos"
                ? "Los leads que entren sin primer contacto aparecerán aquí."
                : cohorte === "en_conversacion"
                  ? "Cuando un lead te escriba o esté esperando tu respuesta, lo verás aquí."
                  : "Los leads contactados que se enfríen sin respuesta aparecerán aquí para reactivarlos."
          }
        />
      ) : (
        <div className="space-y-2">
          {visibles.map((x, i) => (
            // Cascada solo al montar o cambiar de cohorte (keys estables: un
            // refresh de datos no re-anima).
            <div
              key={x.l.id}
              className="fyllio-fade-in"
              style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
            >
              <LeadAccionRow
                lead={x.l}
                conv={x.conv}
                cohorte={x.cohorte}
                onOpen={() => setDrawerLead(x.l)}
                onAsistencia={() => setAsistenciaLead(x.l)}
                ultimaSalientePorLead={ultimaSalientePorLead}
              />
            </div>
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
          onAgendar={(l) => setAgendarLead(l)}
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

      {agendarLead && (
        <AgendarModal
          lead={agendarLead}
          doctores={doctores}
          onClose={() => setAgendarLead(null)}
          onSaved={(updated) => {
            onLeadChanged(updated);
            setAgendarLead(null);
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

// "Cita el martes 29 jul" / "Cita mañana" — para el estado de Citados.
function citaTexto(fechaCita: string, hoy: string): string {
  if (fechaCita === hoy) return "Cita hoy";
  const manana = new Date(hoy + "T00:00:00");
  manana.setDate(manana.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const mananaIso = `${manana.getFullYear()}-${pad(manana.getMonth() + 1)}-${pad(manana.getDate())}`;
  if (fechaCita === mananaIso) return "Cita mañana";
  const txt = new Date(fechaCita + "T12:00:00").toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  return `Cita el ${txt}`;
}

function LeadAccionRow({
  lead,
  conv,
  cohorte,
  onOpen,
  onAsistencia,
  ultimaSalientePorLead,
}: {
  lead: Lead;
  /** Clasificación única de la conversación — la deriva LeadsTab (la misma
   *  que decide la cohorte); la card no recalcula nada. */
  conv: ConversacionClasificada;
  cohorte: CohorteLead;
  onOpen: () => void;
  onAsistencia: () => void;
  // Map para priorityForLead (trigger 'caliente sin acción >12h').
  ultimaSalientePorLead?: Record<string, string>;
}) {
  // "Esperando respuesta" solo aplica dentro de En conversación: en Citados
  // la precedencia de cita manda (el trabajo es confirmar, no esperar).
  const esperando = cohorte === "en_conversacion" && conv.estado === "en_espera_paciente";

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
  const urgente = cohorte === "nuevos" && esNuevoUrgente(lead.createdAt, Date.now());

  // Estado en dos niveles (patrón del dashboard de Red): qué pasa + qué toca
  // hacer, según la cohorte. El caso "en espera" mantiene su botón fantasma.
  const estado = (() => {
    if (cohorte === "citados" && lead.fechaCita) {
      const esHoy = lead.fechaCita === today;
      return {
        titular: `${citaTexto(lead.fechaCita, today)}${lead.horaCita ? ` a las ${lead.horaCita}` : ""}`,
        detalle: esHoy
          ? "Confirma su asistencia cuando llegue — o marca que no vino."
          : "Recuérdale la cita desde su ficha: el mensaje va precargado.",
      };
    }
    if (cohorte === "nuevos") {
      return {
        titular: "Primer contacto pendiente",
        detalle: urgente
          ? "Cada día sin respuesta enfría el lead — llámale o escríbele hoy."
          : "Dale el primer toque desde su ficha.",
      };
    }
    if (cohorte === "en_conversacion" && conv.estado === "pendiente_responder") {
      return {
        titular: `Te respondió ${conv.haceMs != null ? haceTexto(conv.haceMs) : ""}`.trim(),
        detalle: "La pelota está en tu tejado — contéstale desde su ficha.",
      };
    }
    if (cohorte === "rezagados") {
      return {
        titular:
          conv.haceMs != null
            ? `Le escribiste ${haceTexto(conv.haceMs)} y no ha respondido`
            : "Sin respuesta desde el último contacto",
        detalle: "Reactívalo desde su ficha con un mensaje nuevo.",
      };
    }
    return undefined;
  })();

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

  // Decisión de producto (2026-07-23): la card INFORMA, no ejecuta. Llamar y
  // WhatsApp viven solo en el panel, donde la acción pasa por leer el hilo
  // (mensaje precargado, registro, feedback). Un botón en la card invitaba a
  // ejecutar sin criterio — el de leads además abría wa.me SIN texto y decía
  // "Enviado" sin dejar nada en el hilo.
  const actions: React.ComponentProps<typeof AccionCard>["actions"] = [];
  if (esperando) {
    actions.push({
      label: conv.ultimoToqueClinicaAt
        ? `Esperando respuesta · ${relTimeShort(conv.ultimoToqueClinicaAt)}`
        : "Esperando respuesta",
      onClick: (e) => e.stopPropagation(),
      variant: "ghost",
      disabled: true,
    });
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
      faded={esperando}
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
          {urgente && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 tabular-nums">
              Sin contactar hace {diasDesde ?? 0}d
            </span>
          )}
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
      estado={estado}
      accionSugerida={lead.accionSugerida ?? undefined}
      onOpen={onOpen}
      actions={actions}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-tab Presupuestos — P3 unificación (2026-07-23): IntervencionView usa
// el MISMO modelo que Leads: SeguimientoHeader compartido, AccionCard
// compartida y dos pestañas derivadas de estadoConversacion ("Actuar ahora"
// = pendiente_responder + reactivable · "Esperando respuesta" = en_espera).
// El SidePanel se monta al nivel de SeguimientoView vía AccionPanel
// kind="presupuesto" (wrapper a IntervencionSidePanel), igual que leads.
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
