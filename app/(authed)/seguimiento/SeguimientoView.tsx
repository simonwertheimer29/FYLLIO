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
import { useVistosHoy } from "../../lib/seguimiento/useVistosHoy";
import { CabeceraCola } from "../../components/shared/CabeceraCola";
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
  UMBRAL_REACTIVACION_DIAS,
  haceTexto,
  type ConversacionClasificada,
} from "../../lib/presupuestos/estado-conversacion";
import { esLeadActivo } from "../../lib/leads/pipeline";
import { esLeadCaliente } from "../../lib/leads/intenciones";
import { hoyISO, fechaClinica } from "../../lib/time";
import {
  cohorteLead,
  esNuevoUrgente,
  type CohorteLead,
} from "../../lib/seguimiento/cohortes";
import {
  estadoAutomatizacion,
  type EventoAutomatizacion,
  type EstadoAutomatizacion,
  type Disparador,
} from "../../lib/automatizacion/estado";
import { QueSeDetecta } from "../../components/automatizacion/QueSeDetecta";
import { EstadoAutomatizacionPill } from "../../components/automatizacion/EstadoAutomatizacionPill";
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { CasosDelAgente } from "./CasosDelAgente";
import { EmptyState } from "../../components/ui/Feedback";
import Link from "next/link";
import { AlertTriangle, Inbox, Send, ICON_STROKE } from "../../components/icons";
import { toast } from "sonner";
import { AvisoFiltroClinica } from "../../components/shared/AvisoFiltroClinica";

type Tab = "leads" | "presupuestos";

// Bloque 2 P1 — doctores para el AgendarModal in situ del panel de lead.
type Doctor = { id: string; nombre: string; clinicaId: string | null };

export function SeguimientoView({
  user,
  initialLeads,
  doctores,
  vistaInicial,
  cohorteInicial,
}: {
  user: UserSession;
  initialLeads: Lead[];
  doctores: Doctor[];
  /** Resueltos en servidor desde la query — leerlos de window en el estado
   *  inicial rompía la hidratación (React #418). */
  vistaInicial: Tab;
  cohorteInicial: string | null;
}) {
  // El filtro de clínica gobierna las dos pestañas (LeadsTab lo pasa a
  // /api/leads, PresupuestosTab a su cola), así que el aviso vive aquí arriba,
  // junto a la cabecera que comparten.
  const { selectedClinicaId, selectedClinicaNombre, setSelectedClinicaId } = useClinic();
  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;
  // "Visto hoy" es de la COLA, no de una pestaña: una sola carga y un solo
  // `marcar` para leads y presupuestos (ver lib/seguimiento/useVistosHoy).
  const vistos = useVistosHoy();
  // Enlaces del dashboard de Red: ?vista=leads|presupuestos abre la cola
  // pedida (lectura en el init para no exigir Suspense de useSearchParams).
  const [tab, setTab] = useState<Tab>(vistaInicial);
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
          <div className="flex items-center gap-2">
            {/* B6.4 — la otra mitad de la cola de trabajo: lo que va a SALIR
                hoy (la cola de envíos) frente a lo que toca hacer aquí. */}
            <Link
              href="/envios"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
            >
              <Send size={14} strokeWidth={ICON_STROKE} />
              Envíos
            </Link>
            <SegmentedToggle
              options={[
                { id: "leads" as Tab, label: "Leads" },
                { id: "presupuestos" as Tab, label: "Presupuestos" },
              ]}
              active={tab}
              onChange={setTab}
            />
          </div>
        </header>
        {/* El filtro de clínica PERSISTE en localStorage: se puede llegar
            aquí con él puesto sin haberlo tocado en esta sesión, y las cifras
            son otras. Se declara en la página, no solo en el selector. */}
        {clinicaFiltrada && (
          <AvisoFiltroClinica
            nombre={selectedClinicaNombre!}
            onVerTodas={() => setSelectedClinicaId(null)}
          />
        )}

        {/* Fase B (B2): lo que el agente ENTREGÓ y nadie resolvió — una línea
            por caso; al abrirla, LA ficha (el mismo componente que Mensajería).
            El aislamiento lo resuelve /api/agente/casos con la sesión. */}
        <CasosDelAgente />

        {tab === "leads" ? (
          <LeadsTab
            initialLeads={initialLeads}
            doctores={doctores}
            cohorteInicial={cohorteInicial}
            vistos={vistos}
          />
        ) : (
          <PresupuestosTab
            user={user}
            onOpenDrawer={setPresupuestoDrawer}
            reloadKey={presupuestoReloadKey}
            vistos={vistos}
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
// "Sin respuesta" es el nombre visible de la cohorte rezagados (renombre
// 2026-07-26); "rezagados" se acepta como valor viejo en enlaces guardados.
const URL_A_COHORTE: Record<string, CohorteLead> = {
  citados: "citados",
  nuevos: "nuevos",
  conversacion: "en_conversacion",
  "sin-respuesta": "rezagados",
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

function LeadsTab({
  initialLeads,
  doctores,
  cohorteInicial,
  vistos,
}: {
  initialLeads: Lead[];
  doctores: Doctor[];
  cohorteInicial: string | null;
  vistos: ReturnType<typeof useVistosHoy>;
}) {
  const { selectedClinicaId, selectedClinicaNombre, setSelectedClinicaId } = useClinic();
  // Con clínica elegida la pantalla cambia de ámbito y hay que decirlo.
  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  // Lo que solo puede dar el servidor de la tercera coordenada: el último evento
  // humano por caso y el umbral de la clínica. El estado se compone abajo con la
  // función pura compartida. Default 3 = el mismo de la migración: si la carga
  // falla, el estado se deriva igual y se avisa de más, no de menos.
  const [autom, setAutom] = useState<{
    eventos: Record<string, EventoAutomatizacion>;
    toquesAntesDeAgotar: number;
  }>({ eventos: {}, toquesAntesDeAgotar: 3 });
  const [filtroDoctor, setFiltroDoctor] = useState("");
  const [filtroTratamiento, setFiltroTratamiento] = useState("");
  const [loading, setLoading] = useState(false);
  // Indicador sutil cuando el refresh falla: mantenemos la lista anterior
  // (deliberado) pero avisamos de que puede estar desactualizada.
  const [sinConexion, setSinConexion] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  // ?cohorte=citados|nuevos|conversacion|rezagados (dashboard de Red y el
  // redirect de /actuar-hoy). null = apertura automática en la primera
  // cohorte con casos que exigen acción; el click del usuario la fija.
  const [cohorteManual, setCohorteManual] = useState<CohorteLead | null>(
    cohorteInicial ? (URL_A_COHORTE[cohorteInicial] ?? null) : null,
  );
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
  // derivar estadoConversacion (la cohorte).
  const [ultimaEntrantePorLead, setUltimaEntrantePorLead] = useState<
    Record<string, string>
  >({});
  // Texto del último entrante — la card de "te respondió" cita al paciente.
  const [ultimoEntranteTextoPorLead, setUltimoEntranteTextoPorLead] = useState<
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
      if (d?.automatizacion && typeof d.automatizacion === "object") {
        setAutom({
          eventos: d.automatizacion.eventos ?? {},
          toquesAntesDeAgotar:
            typeof d.automatizacion.toquesAntesDeAgotar === "number"
              ? d.automatizacion.toquesAntesDeAgotar
              : 3,
        });
      }
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
      setUltimoEntranteTextoPorLead(
        sal?.ultimoEntranteTextoPorLead && typeof sal.ultimoEntranteTextoPorLead === "object"
          ? sal.ultimoEntranteTextoPorLead
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

  const today = hoyISO();

  // Las opciones salen de los leads ACTIVOS, no del catálogo entero: un filtro
  // que ofrece valores sin resultados es ruido con aspecto de función.
  const activos = useMemo(
    () => leads.filter((l) => !l.convertido && esLeadActivo(l.estado)),
    [leads],
  );
  const doctoresConLeads = useMemo(
    () =>
      doctores.filter((d) => activos.some((l) => l.doctorAsignadoId === d.id)),
    [doctores, activos],
  );
  const tratamientosConLeads = useMemo(
    () =>
      [...new Set(activos.map((l) => l.tratamiento).filter((t): t is string => !!t))].sort(),
    [activos],
  );

  // ── Cohortes: PARTICIÓN TOTAL de los leads activos. Cero condiciones de
  // entrada — el censo del rediseño demostró que la lista de condiciones
  // vieja ("accionables") escondía 6 de 31 activos (DECISIONES 2026-07-25).
  // Clasificación única: estadoConversacion sobre los timestamps fusionados
  // del servidor + precedencia de cita — la MISMA lib que qa-cohortes.
  const clasificados = useMemo(() => {
    return leads
      .filter((l) => !l.convertido && esLeadActivo(l.estado))
      // Filtros de doctor y tratamiento, los mismos que la pestaña hermana de
      // Presupuestos ya tenía: eran la única asimetría REAL entre las dos
      // vistas (la card ya es compartida desde la unificación P3).
      .filter((l) => !filtroDoctor || l.doctorAsignadoId === filtroDoctor)
      .filter((l) => !filtroTratamiento || l.tratamiento === filtroTratamiento)
      .map((l) => {
        const conv = estadoConversacion(
          {
            ultimoEntranteAt: ultimaEntrantePorLead[l.id] ?? null,
            ultimoSalienteAt: ultimaSalientePorLead[l.id] ?? null,
          },
          UMBRAL_REACTIVACION_DIAS.lead,
        );
        // Tercera coordenada (fase 1 de PLAN-AGENTE). MISMA función pura que usa
        // la cola de presupuestos: aquí se compone en cliente porque aquí es
        // donde ya se deriva la conversación, pero el criterio es uno solo.
        //
        // `intencion` va a null a propósito y no por olvido: el webhook guarda
        // los mensajes de leads SIN clasificarlos, así que un lead no puede
        // quebrar por intención. Lo que sí funciona aquí es "agotado", que sale
        // de whatsappEnviados. Ver PLAN-AGENTE §fase 1, recorte 4.
        const auto = estadoAutomatizacion({
          cerrado: false, // ya filtrados arriba por esLeadActivo + !convertido
          conversacion: conv.estado,
          intencion: null,
          toques: l.whatsappEnviados ?? 0,
          toquesAntesDeAgotar: autom.toquesAntesDeAgotar,
          ultimoEvento: autom.eventos[l.id] ?? null,
        });
        return {
          l,
          conv,
          auto,
          cohorte: cohorteLead({
            fechaCita: l.fechaCita,
            hoy: today,
            conversacion: conv.estado,
            automatizacion: { estado: auto.estado },
          }),
        };
      });
  }, [leads, today, ultimaSalientePorLead, ultimaEntrantePorLead, filtroDoctor, filtroTratamiento, autom]);

  type Clasificado = (typeof clasificados)[number];
  const cohortes = useMemo(() => {
    const ahora = Date.now();
    const de = (c: CohorteLead) => clasificados.filter((x) => x.cohorte === c);
    const creado = (x: Clasificado) => new Date(x.l.createdAt).getTime() || 0;
    return {
      // Quiebre: la primera cohorte, y en leads SIEMPRE VACÍA hoy — el
      // clasificador no corre para leads. Se declara igualmente para que la
      // partición sea total y para que el día que la fase 2 la llene no haya
      // que tocar nada aquí.
      quiebre: de("quiebre"),
      // Agotado: el que más tiempo lleva sin respuesta primero — es al que
      // antes hay que llamar.
      agotado: de("agotado").sort((a, b) => (b.conv.haceMs ?? 0) - (a.conv.haceMs ?? 0)),
      // Cerrar y anotar: el más antiguo primero — el motivo de pérdida se olvida
      // en días y después ya no se puede reconstruir.
      cerrar: de("cerrar").sort((a, b) => creado(a) - creado(b)),
      // Citados: la cita más cercana primero.
      citados: de("citados").sort(
        (a, b) =>
          (a.l.fechaCita ?? "").localeCompare(b.l.fechaCita ?? "") ||
          (a.l.horaCita ?? "").localeCompare(b.l.horaCita ?? ""),
      ),
      // Nuevos: los FRESCOS (<48 h) primero, el más reciente arriba — un lead
      // recién llegado es la máxima probabilidad de cierre y atenderlo YA es
      // como se evita que se enfríe. Los desatendidos (≥48 h, chip ámbar)
      // quedan como grupo de rescate debajo, el más antiguo primero. El orden
      // premia el flujo correcto (contactar hoy lo de hoy), no el rescate
      // (DECISIONES 2026-07-26).
      nuevos: de("nuevos").sort((a, b) => {
        const ua = esNuevoUrgente(a.l.createdAt, new Date(ahora)) ? 1 : 0;
        const ub = esNuevoUrgente(b.l.createdAt, new Date(ahora)) ? 1 : 0;
        if (ua !== ub) return ua - ub;
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
      // Rezagados: mandan los DÍAS PARADOS (más días primero) y la intención
      // caliente solo desempata. La fórmula días×interés producía un orden
      // ilegible: el multiplicador comprimía dimensiones distintas en la
      // misma banda (6 días sin interés ≈ 2,6 días con interés ×2).
      rezagados: de("rezagados").sort((a, b) => {
        const d = (b.conv.haceMs ?? 0) - (a.conv.haceMs ?? 0);
        if (d !== 0) return d;
        const ca =
          esLeadCaliente(a.l.intencionDetectada) ? 0 : 1;
        const cb =
          esLeadCaliente(b.l.intencionDetectada) ? 0 : 1;
        return ca - cb;
      }),
    };
  }, [clasificados]);

  // Apertura automática: primera cohorte con casos que exigen acción
  // (pendientes de responder > nuevos urgentes > rezagados > citados);
  // sin nada urgente, la primera con contenido.
  const cohorteAuto = ((): CohorteLead => {
    const ahora = Date.now();
    // Quiebre y agotado ganan a todo: son las dos que exigen criterio humano.
    if (cohortes.quiebre.length > 0) return "quiebre";
    if (cohortes.agotado.length > 0) return "agotado";
    if (cohortes.cerrar.length > 0) return "cerrar";
    if (cohortes.en_conversacion.some((x) => x.conv.estado === "pendiente_responder"))
      return "en_conversacion";
    if (cohortes.nuevos.some((x) => esNuevoUrgente(x.l.createdAt, new Date(ahora)))) return "nuevos";
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
  const exigenAccion = [
    // Quiebre y agotado son, por definición, los que exigen acción. Van primero
    // y NO se solapan con las demás: la cohorte es una partición, así que un
    // caso agotado ya no está en rezagados y no se cuenta dos veces.
    ...cohortes.quiebre,
    ...cohortes.agotado,
    ...cohortes.cerrar,
    ...cohortes.en_conversacion.filter((x) => x.conv.estado === "pendiente_responder"),
    ...cohortes.nuevos,
    ...cohortes.rezagados,
    ...cohortes.citados.filter((x) => x.l.fechaCita === today && !x.l.asistido),
  ];
  // Un caso VISTO HOY deja de ser pendiente y cuenta como atendido — es lo que
  // permite que la barra del plan pueda llegar al 100 %. Sigue abierto: mañana
  // vuelve si nadie lo ha resuelto.
  const vistosEntrePendientes = exigenAccion.filter((x) => vistos.estaVisto("lead", x.l.id)).length;
  const nPendientes = exigenAccion.length - vistosEntrePendientes;

  function onLeadChanged(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setDrawerLead((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  return (
    <>
      {/* Delta P1 (18-08): la cabecera es la cola de tres cohortes — dinero
          parado, desglose y el caso más viejo. El «% del plan de hoy» murió:
          era una métrica inventada, nadie fijó un plan. */}
      <CabeceraCola />

      {sinConexion && (
        <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden />
          Sin conexión · mostrando los últimos datos, se reintentará al actualizar
        </span>
      )}

      {/* Filtros del área — mismos que la pestaña de Presupuestos. La clínica
          vive en el selector global de la cabecera. */}
      {(doctoresConLeads.length > 0 || tratamientosConLeads.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {doctoresConLeads.length > 0 && (
            <select
              value={filtroDoctor}
              onChange={(e) => setFiltroDoctor(e.target.value)}
              className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">Todos los doctores</option>
              {doctoresConLeads.map((d) => (
                <option key={d.id} value={d.id}>{d.nombre}</option>
              ))}
            </select>
          )}
          {tratamientosConLeads.length > 0 && (
            <select
              value={filtroTratamiento}
              onChange={(e) => setFiltroTratamiento(e.target.value)}
              className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">Todos los tratamientos</option>
              {tratamientosConLeads.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Cohortes — pills compartidas de las colas. Una cohorte vacía sigue
          visible con su 0: partición honesta, nada desaparece. */}
      <ColaTabs
        tabs={[
          // Quiebre primero y arriba, aunque hoy en leads sea siempre 0: la
          // partición se enseña entera. Un 0 honesto vale más que ocultar una
          // cohorte y que la coordinadora no sepa que existe.
          { id: "quiebre" as CohorteLead, label: "Necesita persona", count: cohortes.quiebre.length },
          { id: "agotado" as CohorteLead, label: "Toca llamar", count: cohortes.agotado.length },
          { id: "cerrar" as CohorteLead, label: "Cierra y anota", count: cohortes.cerrar.length },
          { id: "citados" as CohorteLead, label: "Citados", count: cohortes.citados.length },
          { id: "nuevos" as CohorteLead, label: "Nuevos", count: cohortes.nuevos.length },
          {
            id: "en_conversacion" as CohorteLead,
            label: "En conversación",
            count: cohortes.en_conversacion.length,
          },
          {
            id: "rezagados" as CohorteLead,
            label: "Sin respuesta",
            count: cohortes.rezagados.length,
          },
        ]}
        active={cohorte}
        onChange={(c) => setCohorteManual(c)}
      />

      {cohorte === "rezagados" && (
        <p className="text-xs text-[var(--color-muted)]">
          Les escribiste y no contestaron — toca insistir.
        </p>
      )}

      {/* Declaración honesta: en leads el aviso NO lee el contenido. Sin esto,
          una cohorte "Necesita persona" siempre a 0 se lee como "no hay nada
          que atender" en vez de como "esto todavía no mira". */}
      {(cohorte === "quiebre" || cohorte === "agotado") && <QueSeDetecta dominio="leads" />}

      {cohorte === "cerrar" && (
        <p className="text-xs text-[var(--color-muted)]">
          Dijeron que no y el caso sigue abierto. Ciérralo tú y **anota por qué se perdió**: ese
          motivo no se puede reconstruir después.
        </p>
      )}

      {cohorte === "agotado" && (
        <p className="text-xs text-[var(--color-muted)]">
          Se agotó el seguimiento por escrito: el siguiente paso es una llamada.
        </p>
      )}

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
                  : "Nadie pendiente de insistir"
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
                  : "Cuando a un lead se le escriba y no conteste, aparecerá aquí para insistir."
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
                auto={x.auto}
                cohorte={x.cohorte}
                onOpen={() => setDrawerLead(x.l)}
                onAsistencia={() => setAsistenciaLead(x.l)}
                ultimoEntranteTexto={ultimoEntranteTextoPorLead[x.l.id]}
                visto={vistos.estaVisto("lead", x.l.id)}
                onVisto={(deshacer) => vistos.marcar("lead", x.l.id, deshacer)}
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

// La intención "caliente" del clasificador IA solo desempata el orden de
// Sin respuesta (tanda de coherencia 2026-07-26: el badge ALTO/MEDIO/BAJO
// murió — medía la frescura del último toque NUESTRO y castigaba justo los
// casos donde el paciente espera; contradecía el orden de las cohortes).

function relTimeShort(iso: string): string {
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

// "Cita el martes 29 jul" / "Cita mañana" — para el estado de Citados.
function citaTexto(fechaCita: string, hoy: string): string {
  if (fechaCita === hoy) return "Cita hoy";
  const manana = new Date(hoy + "T00:00:00");
  manana.setDate(manana.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const mananaIso = `${manana.getFullYear()}-${pad(manana.getMonth() + 1)}-${pad(manana.getDate())}`;
  if (fechaCita === mananaIso) return "Cita mañana";
  const txt = fechaClinica(fechaCita, { diaSemana: true });
  return `Cita el ${txt}`;
}

function LeadAccionRow({
  lead,
  conv,
  auto,
  cohorte,
  onOpen,
  onAsistencia,
  ultimoEntranteTexto,
  visto,
  onVisto,
}: {
  lead: Lead;
  /** Estado de automatización — lo deriva LeadsTab con la función pura
   *  compartida, igual que la conversación. La card no recalcula nada. */
  auto?: { estado: EstadoAutomatizacion; disparador: Disparador | null };
  /** Clasificación única de la conversación — la deriva LeadsTab (la misma
   *  que decide la cohorte); la card no recalcula nada. */
  conv: ConversacionClasificada;
  cohorte: CohorteLead;
  onOpen: () => void;
  onAsistencia: () => void;
  /** Último mensaje real del paciente — la card lo cita en "te respondió". */
  ultimoEntranteTexto?: string;
  /** Ya mirado hoy: la coordinadora decidió que no toca nada. */
  visto: boolean;
  onVisto: (deshacer: boolean) => void;
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

  const today = hoyISO();
  const isCitadoHoy =
    (lead.estado === "Citado" || lead.estado === "Citados Hoy") && lead.fechaCita === today;

  const urgente = cohorte === "nuevos" && esNuevoUrgente(lead.createdAt, new Date());

  // El color del borde deriva del MISMO criterio que ordena y titula la
  // cohorte — nada de scores paralelos (el badge ALTO/MEDIO/BAJO murió por
  // contradecir el orden en pantalla).
  const borderColor =
    cohorte === "citados"
      ? isCitadoHoy
        ? "var(--color-danger)"
        : "var(--color-accent)"
      : cohorte === "nuevos"
        ? urgente
          ? "var(--color-warning)"
          : "var(--color-border)"
        : cohorte === "rezagados"
          ? "var(--color-warning)"
          : conv.estado === "pendiente_responder"
            ? "var(--color-danger)"
            : "var(--color-border)";

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
      // Patrón de la vista de Presupuestos: titular corto; el último mensaje
      // real del paciente va citado en la card (quote) y la acción sugerida
      // debajo — fuera la frase hecha.
      return {
        titular: `Te respondió ${conv.haceMs != null ? haceTexto(conv.haceMs) : ""}`.trim(),
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
    lead.fechaCita
      ? `Cita ${fechaClinica(lead.fechaCita)}${lead.horaCita ? ` · ${lead.horaCita}` : ""}`
      : null,
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
  // "Visto hoy": la coordinadora ya lo miró y hoy no toca nada. NO cierra el
  // caso ni cambia su estado — mañana vuelve si sigue abierto. Es lo que
  // permite que la barra del plan del día llegue al 100 % (decisión 2026-08-01;
  // en /alertas la respuesta es la contraria, y ahí está el porqué).
  actions.push({
    label: visto ? "Visto hoy · deshacer" : "Visto hoy",
    onClick: (e) => {
      e.stopPropagation();
      onVisto(visto);
    },
    variant: "ghost",
  });
  actions.push({
    label: "Ver ficha →",
    onClick: (e) => {
      e.stopPropagation();
      onOpen();
    },
    variant: "primary",
  });

  // Quote: en "te respondió", las palabras REALES del paciente mandan;
  // si no hay texto (p. ej. rama Airtable), caen las notas.
  const quote =
    (conv.estado === "pendiente_responder" ? ultimoEntranteTexto : undefined) ??
    lead.notas ??
    undefined;

  return (
    <AccionCard
      borderColor={borderColor}
      faded={esperando || visto}
      distintivo={
        auto ? <EstadoAutomatizacionPill estado={auto.estado} /> : undefined
      }
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
        </div>
      }
      tags={tags}
      meta={meta}
      quote={quote}
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
  vistos,
}: {
  user: UserSession;
  onOpenDrawer: (p: PresupuestoIntervencion) => void;
  reloadKey: number;
  vistos: ReturnType<typeof useVistosHoy>;
}) {
  return (
    <IntervencionView
      key={reloadKey}
      user={user}
      onOpenDrawer={onOpenDrawer}
      vistos={vistos}
    />
  );
}
