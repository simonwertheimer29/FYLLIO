"use client";

// Sprint 8 D.6 — /presupuestos simplificado a un toggle de DOS VISTAS DE LO
// MISMO: "Tablero" (kanban por estado, el trabajo del día) y "Tabla" (por
// fecha, para monitorizar). Se llamaban "Panel" y "Máxima"; "Máxima" no
// significaba nada para una coordinadora y "Panel" tampoco decía que fuese un
// kanban (renombre 2026-07-29). El id interno `maxima` se conserva para no
// romper los enlaces `?vista=maxima` que ya existen.
// Red/Intervención/KPIs/Informes/Tareas/Envíos/Doctor/Automatizaciones/Config
// se migran a rutas top-level. Aquí solo queda el pipeline de presupuestos.

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Bell, Plus, Upload, ClipboardList, ICON_STROKE } from "../icons";
import { EmptyState } from "../ui/Feedback";
import type {
  Presupuesto,
  PresupuestoEstado,
  UserSession,
  MotivoPerdida,
  PresupuestoIntervencion,
} from "../../lib/presupuestos/types";
import KanbanBoard from "./KanbanBoard";
import MaximaView from "./MaximaView";
import FiltersBar, { EMPTY_FILTERS, type Filters } from "./FiltersBar";
import { useClinic } from "../../lib/context/ClinicContext";
import NewPresupuestoModal from "./NewPresupuestoModal";
import FichaPresupuesto from "./FichaPresupuesto";
import ImportarCSVModal from "./ImportarCSVModal";
import IntervencionSidePanel from "./IntervencionSidePanel";
import NotificacionesPanel from "./NotificacionesPanel";
import PagoCierreModal, { type PagoCierre } from "./PagoCierreModal";
import MotivoPerdidaModal from "./MotivoPerdidaModal";
import { RangoTemporal, RANGO_DEFAULT, NOTA_RANGO_SOLO_CERRADOS, type RangoKanban } from "../shared/RangoTemporal";
import { SegmentedToggle } from "../shared/SegmentedToggle";
import { Card } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { Cifra, Comparativa, eur } from "../shared/Cifra";
import { mesISO } from "../../lib/time";
import { cargarJSON, traeLista } from "../../lib/fetch-json";
import { AvisoFiltroClinica } from "../shared/AvisoFiltroClinica";
import {
  contarPipelinePresupuestos,
  cifrasNegocioPresupuestos,
  seVeConRango,
  textoTasa,
  notaTasa,
} from "../../lib/presupuestos/pipeline";

type Tab = "kanban" | "maxima";

// ─── Mini hook para cargar presupuestos ──────────────────────────────────────

/** URL de la cola del tablero — una sola definición para la carga y el sondeo,
 *  que antes pedían cosas distintas (el sondeo se olvidaba de la clínica). */
function urlKanban(filters: Filters, clinica: string | null): string {
  const url = new URL("/api/presupuestos/kanban", location.href);
  if (clinica) url.searchParams.set("clinica", clinica);
  if (filters.doctor) url.searchParams.set("doctor", filters.doctor);
  if (filters.q) url.searchParams.set("q", filters.q);
  return url.toString();
}

function usePresupuestos() {
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(false);
  // Un fallo de carga NO puede pintarse como "0 presupuestos abiertos · 0 €"
  // (§4). Pasaba: tanto un 500 como un error de red dejaban la lista vacía y la
  // cabecera cantaba ceros con toda tranquilidad — indistinguible de una clínica
  // que de verdad no tiene nada. Cazado el 2026-07-29 cuando Simon vio ceros con
  // 123 presupuestos en la base.
  //
  // `isDemo`/`demoReason`/`missingVars` se retiraron: la ruta devuelve
  // `isDemo: false` en sus DOS salidas desde que se eliminaron los datos demo
  // (MEJORAS 59), así que el banner ámbar "Datos de demostración" no podía
  // aparecer nunca — y uno de los `?? []` de la deuda estaba sobre un campo que
  // el servidor ya no manda.
  const [error, setError] = useState<string | null>(null);

  // Sprint 13.1 Bloque 2 — la clinica viene SIEMPRE del ClinicContext
  // (GlobalHeader). El filtro local fue eliminado de FiltersBar.
  const load = useCallback(
    async (filters: Filters, clinicaFromContext: string | null) => {
      setLoading(true);
      try {
        // cargarJSON en vez de fetch a pelo: comprueba status, cuerpo y el campo
        // `error` que varias rutas mandan con 200, y LANZA (§10).
        const d = await cargarJSON<{ presupuestos: Presupuesto[] }>(
          urlKanban(filters, clinicaFromContext),
          { validar: traeLista("presupuestos") },
        );
        setError(null);
        setPresupuestos(d.presupuestos);
      } catch (e) {
        // Se conserva lo último que sí cargó y se DICE que no se pudo
        // actualizar: mejor un dato de hace un minuto, señalado, que un cero
        // inventado.
        setError(e instanceof Error ? e.message : "error de red");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { presupuestos, setPresupuestos, loading, error, load };
}

// ─── Main Shell ──────────────────────────────────────────────────────────────

export default function PresupuestosShell({
  user,
  vistaInicial = "kanban",
}: {
  user: UserSession;
  /** ?vista=maxima resuelto en servidor (el "Ver todos →" de la columna
   *  Perdido aterriza ahí). Leerlo aquí de window rompía la hidratación. */
  vistaInicial?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(vistaInicial);
  // Rango temporal del tablero — control único compartido con Leads.
  const [rango, setRango] = useState<RangoKanban>(RANGO_DEFAULT);
  const [currentFilters, setCurrentFilters] = useState<Filters>(EMPTY_FILTERS);
  // Sprint 13.1 Bloque 2 — Clínica viene del GlobalHeader (ClinicContext).
  // El campo Filters.clinica se mantiene por backwards-compat pero no se
  // usa para filtrar (siempre vacío).
  const { selectedClinicaNombre, selectedClinicaId, setSelectedClinicaId } = useClinic();
  // Con clínica elegida la pantalla cambia de ámbito y hay que decirlo.
  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;
  const { presupuestos, setPresupuestos, loading, error, load } = usePresupuestos();

  // El conteo del tablero se calcula sobre lo que el tablero PINTA (mismo
  // rango, mismas funciones puras): un número que no cuadra con las tarjetas
  // visibles es un número que nadie se cree.
  const pipeline = useMemo(
    () =>
      contarPipelinePresupuestos(
        presupuestos.filter((p) => seVeConRango(p, rango)),
      ),
    [presupuestos, rango],
  );

  // Las cifras de negocio: "en juego" sigue al tablero; las dos del mes se
  // calculan sobre TODO lo cargado y declaran su ventana en su etiqueta. El mes
  // sale de la zona de la clínica, nunca del reloj del proceso (§fechas).
  const cifras = useMemo(
    () => cifrasNegocioPresupuestos(presupuestos, pipeline, mesISO()),
    [presupuestos, pipeline],
  );

  const clinicasDisponibles = useMemo(() => {
    const s = new Set<string>(presupuestos.map((p) => p.clinica).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [presupuestos]);

  // Modals / drawers
  const [showNew, setShowNew] = useState(false);
  const [showImportCSV, setShowImportCSV] = useState(false);
  const [editPresupuesto, setEditPresupuesto] = useState<Presupuesto | null>(null);
  const [drawerPresupuesto, setDrawerPresupuesto] = useState<Presupuesto | null>(null);
  const [intervencionItem, setIntervencionItem] = useState<PresupuestoIntervencion | null>(null);
  // Cierre «Aceptó y pagó»: el modal de pago hace de confirmación del
  // ACEPTADO (gemelo del MotivoPerdidaModal en PERDIDO). Nada se escribe ni
  // se pinta hasta confirmar; cancelar no deja ningún estado a medias.
  const [pagoCierre, setPagoCierre] = useState<{
    id: string;
    patientName?: string;
    amount?: number;
    prevEstado?: PresupuestoEstado;
  } | null>(null);
  // Cierre malo desde el panel de acción: «Rechazó» llegaba sin motivo
  // (mientras kanban y drawer SÍ preguntan). Un PERDIDO sin motivo abre
  // aquí el mismo MotivoPerdidaModal; nada se escribe hasta confirmar.
  const [motivoPerdido, setMotivoPerdido] = useState<{
    id: string;
    patientName?: string;
  } | null>(null);
  // Cada acción del panel sube esto: es cómo se enteran las dos vistas de que
  // algo cambió (el tablero recarga con `load`, la Tabla con su refreshKey).
  const [refrescoTabla, setRefrescoTabla] = useState(0);
  const [notifCount, setNotifCount] = useState(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  // Atajo "N" → Nuevo presupuesto
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "n" && e.key !== "N") return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      setShowNew(true);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Service Worker para Web Push
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }
  }, []);

  // Polling banner + notifs
  const [newPresupuestosCount, setNewPresupuestosCount] = useState(0);
  const lastCountRef = useRef<number | null>(null);
  const currentFiltersRef = useRef(currentFilters);
  currentFiltersRef.current = currentFilters;

  const handleFiltersChange = useCallback(
    (f: Filters) => {
      setCurrentFilters(f);
      load(f, selectedClinicaNombre);
    },
    [load, selectedClinicaNombre]
  );

  // Cargar al montar y cada vez que cambia la clinica del header.
  useEffect(() => {
    load(currentFiltersRef.current, selectedClinicaNombre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClinicaNombre]);

  useEffect(() => {
    async function pollNotifs() {
      try {
        const d = await cargarJSON<{ noLeidas?: number }>("/api/notificaciones");
        setNotifCount(d.noLeidas ?? 0);
      } catch (e) {
        // El contador de la campana es accesorio, pero el fallo se VE (§9): un
        // catch literalmente vacío es cómo se pierde un endpoint roto meses.
        console.error("[presupuestos] no se pudo leer el contador de avisos:", e);
      }
    }
    pollNotifs();
    const n = setInterval(pollNotifs, 60_000);
    return () => clearInterval(n);
  }, []);

  // Sondeo de "hay presupuestos nuevos". Dos bugs que tenía:
  //   · pedía la cola SIN el filtro de clínica, así que contaba la red entera
  //     mientras el tablero mostraba una clínica: el banner anunciaba nuevos que
  //     no eran de aquí (y no anunciaba los que sí).
  //   · `(d.presupuestos ?? []).length` con catch mudo: un 200 con `{error}` o un
  //     fallo dejaba el contador en 0 y en la vuelta siguiente el banner decía
  //     "123 presupuestos nuevos desde tu última carga".
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const d = await cargarJSON<{ presupuestos: Presupuesto[] }>(
          urlKanban(currentFiltersRef.current, selectedClinicaNombre),
          { validar: traeLista("presupuestos") },
        );
        const count = d.presupuestos.length;
        if (lastCountRef.current !== null && count > lastCountRef.current) {
          setNewPresupuestosCount(count - lastCountRef.current);
        }
        lastCountRef.current = count;
      } catch (e) {
        // Un fallo NO mueve el contador: dejar `lastCountRef` como estaba evita
        // el falso "123 nuevos" de la siguiente vuelta.
        console.error("[presupuestos] sondeo de nuevos falló:", e);
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [selectedClinicaNombre]);

  function handleBannerRefresh() {
    setNewPresupuestosCount(0);
    lastCountRef.current = null;
    load(currentFiltersRef.current, selectedClinicaNombre);
  }

  async function handleChangeEstado(
    id: string,
    estado: PresupuestoEstado,
    extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string; reactivar?: boolean }
  ) {
    if (estado === "ACEPTADO") {
      // Cierre bueno → modal de pago (señal, parcial, total o sin pago aún).
      // El PATCH real sale al confirmar, en handleConfirmAceptado.
      const src =
        presupuestos.find((p) => p.id === id) ??
        (intervencionItem?.id === id ? intervencionItem : undefined) ??
        (drawerPresupuesto?.id === id ? drawerPresupuesto : undefined);
      setPagoCierre({
        id,
        patientName: src?.patientName,
        amount: src?.amount,
        prevEstado: src?.estado,
      });
      return;
    }
    if (estado === "PERDIDO" && !extra?.motivoPerdida) {
      // Sin motivo = viene del panel de acción («Rechazó»); kanban y drawer
      // ya lo traen de su propio MotivoPerdidaModal.
      const src =
        presupuestos.find((p) => p.id === id) ??
        (intervencionItem?.id === id ? intervencionItem : undefined);
      setMotivoPerdido({ id, patientName: src?.patientName });
      return;
    }
    // Guardar estado previo para rollback puntual (patrón de LeadsView).
    const prevEstado = presupuestos.find((p) => p.id === id)?.estado;
    setPresupuestos((prev) => prev.map((p) => (p.id === id ? { ...p, estado } : p)));
    try {
      const { reactivar, ...patchExtra } = extra ?? {};
      const res = await fetch(`/api/presupuestos/kanban/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, ...patchExtra }),
      });
      // P0.6: el servidor ya no finge éxito en demo; un !ok es un fallo real.
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
          // caída-declarada: nota de reactivación TRAS el cierre ya guardado — se loguea; perderla no revierte el estado y se puede re-anotar.
        }).catch((e) => console.error("[presupuestos] nota de reactivación no registrada:", e));
      }
    } catch {
      // Rollback puntual del estado (antes hacía un refetch completo que
      // enmascaraba el fallo) + aviso al usuario, igual que en LeadsView.
      if (prevEstado !== undefined) {
        setPresupuestos((prev) => prev.map((p) => (p.id === id ? { ...p, estado: prevEstado } : p)));
      }
      toast.error("No se pudo mover el presupuesto. Inténtalo de nuevo.");
    }
  }

  // Confirmación del cierre ACEPTADO: optimista en tablero + panel/drawer
  // abiertos, PATCH con el pago adjunto (una sola petición: estado + cobro),
  // rollback de los tres si falla. Si el estado se guardó pero el pago no,
  // el servidor responde pagoRegistrado:false y se avisa honesto.
  async function handleConfirmAceptado(pago: PagoCierre | null) {
    if (!pagoCierre) return;
    const { id, prevEstado } = pagoCierre;
    setPagoCierre(null);
    setPresupuestos((prev) => prev.map((p) => (p.id === id ? { ...p, estado: "ACEPTADO" } : p)));
    setIntervencionItem((prev) => (prev && prev.id === id ? { ...prev, estado: "ACEPTADO" } : prev));
    setDrawerPresupuesto((prev) => (prev && prev.id === id ? { ...prev, estado: "ACEPTADO" } : prev));
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
        toast.success(`Pago de ${eur(pago.importe)} registrado`);
      }
    } catch {
      if (prevEstado !== undefined) {
        setPresupuestos((prev) => prev.map((p) => (p.id === id ? { ...p, estado: prevEstado } : p)));
        setIntervencionItem((prev) => (prev && prev.id === id ? { ...prev, estado: prevEstado } : prev));
        setDrawerPresupuesto((prev) => (prev && prev.id === id ? { ...prev, estado: prevEstado } : prev));
      }
      toast.error("No se pudo aceptar el presupuesto. Inténtalo de nuevo.");
    }
  }

  function handleEdit(p: Presupuesto) {
    setEditPresupuesto(p);
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      <main className="flex-1 min-h-0 overflow-auto flex flex-col w-full px-3 sm:px-6 py-6 gap-4">
        {/* Cabecera con la ANATOMÍA del resto del producto (Cobros, Pacientes):
            título y subtítulo dentro del cuerpo y el conmutador al extremo
            derecho, alineado con el título. Antes esto era una barra propia
            pegada al borde superior — el único módulo con una, y un tercer
            patrón de cabecera. */}
        <header className="shrink-0 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
                Presupuestos
              </h1>
              <p className="text-[13px] text-[var(--color-muted)] mt-0.5">
                Del presupuesto presentado al tratamiento aceptado.
              </p>
            </div>

            {/* El rango vive AQUÍ, en la cabecera, y no en la fila de filtros
                del Tablero: gobierna las DOS vistas, así que no puede
                desaparecer al cambiar de lente. Antes solo se renderizaba en el
                Tablero y solo lo filtraba a él — la Tabla enseñaba los 123
                mientras el Tablero enseñaba 45, sin que nada dijera por qué.
                Un filtro que aplica a una vista y no a su gemela es una trampa. */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* La ASIMETRÍA se declara (MEJORAS 75): el rango acota el archivo
                  de cerrados y no esconde nunca trabajo abierto. Sin decirlo, un
                  control que filtra la mitad de la pantalla y no la otra parece
                  un fallo. Va como título del control, donde se lee justo cuando
                  se va a usar. */}
              <div className="flex flex-col items-end">
                <RangoTemporal value={rango} onChange={setRango} />
                <p className="text-[10px] text-[var(--color-muted)] mt-1 text-right">
                  {NOTA_RANGO_SOLO_CERRADOS}
                </p>
              </div>
              <SegmentedToggle
                options={[
                  { id: "kanban", label: "Tablero" },
                  { id: "maxima", label: "Tabla" },
                ]}
                active={tab}
                onChange={(id) => setTab(id)}
              />
            </div>
          </div>

          {/* Cifras de NEGOCIO, no el recuento de lo que ya se ve. Cada una
              declara su ventana: "en juego" es lo visible en el periodo; las
              otras dos son el mes de la clínica. Un fallo de carga se dice aquí y
              se conserva lo último bueno — nunca tres ceros con cara de reales. */}
          <Card padding="none" className="px-5 py-3.5">
            {error ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--color-danger)]">
                  No se pudieron actualizar los presupuestos
                  {presupuestos.length > 0 ? " (se muestra lo último que sí cargó)" : ""}.
                </span>
                <button
                  type="button"
                  onClick={() => void load(currentFiltersRef.current, selectedClinicaNombre)}
                  className="font-semibold text-[var(--color-accent)] hover:underline"
                >
                  Reintentar
                </button>
              </div>
            ) : loading && presupuestos.length === 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton width={110} height={10} />
                    <Skeleton width={90} height={20} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Cifra
                  label="En juego ahora"
                  valor={eur(cifras.enJuego)}
                  detalle={`${cifras.abiertos} presupuesto${cifras.abiertos === 1 ? "" : "s"} abierto${
                    cifras.abiertos === 1 ? "" : "s"
                  }, todos`}
                />
                <Cifra
                  label="Firmado este mes"
                  valor={eur(cifras.firmadoMes)}
                  comparacion={
                    <Comparativa
                      valor={cifras.firmadoMes}
                      previo={cifras.firmadoMesPrevio}
                      tipo="dinero"
                    />
                  }
                />
                {/* La MISMA función de tasa que /kpis y los informes: aceptados
                    sobre decididos, abiertos declarados. Antes cada pantalla
                    calculaba la suya y se contradecían (55% allí, 72% aquí). */}
                <Cifra
                  label="Se cierran"
                  valor={textoTasa(cifras.tasa)}
                  detalle={notaTasa(cifras.tasa, "que se cerraron este mes")}
                  comparacion={
                    cifras.tasa.pct != null && cifras.tasaPrevia.pct != null ? (
                      <Comparativa
                        valor={cifras.tasa.pct}
                        previo={cifras.tasaPrevia.pct}
                        tipo="porcentaje"
                      />
                    ) : undefined
                  }
                />
              </div>
            )}
          </Card>
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

        {/* Fila de acciones: los filtros de la vista a la izquierda y las tres
            acciones a la derecha, a esta altura y no en la cabecera. */}
        <div className="shrink-0 flex flex-wrap items-center gap-2">
          {tab === "kanban" && <FiltersBar user={user} onFiltersChange={handleFiltersChange} />}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowImportCSV(true)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
              title="Importar CSV"
            >
              <Upload size={14} strokeWidth={ICON_STROKE} aria-hidden />
              <span className="hidden sm:inline">Importar CSV</span>
            </button>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold hover:bg-[var(--color-accent-hover)]"
              title="Nuevo presupuesto (N)"
            >
              <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
              <span className="hidden sm:inline">Nuevo</span>
            </button>
            <button
              onClick={() => setShowNotifPanel(true)}
              className="relative px-1.5 py-1 rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
              title="Notificaciones"
            >
              <Bell size={16} strokeWidth={ICON_STROKE} aria-hidden />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold bg-[var(--color-danger)] text-[var(--color-on-accent)] rounded-full px-1">
                  {notifCount > 9 ? "9+" : notifCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {newPresupuestosCount > 0 && (
          <div className="shrink-0 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] px-4 py-2 flex items-center justify-between gap-4">
            <span className="text-xs font-semibold">
              {newPresupuestosCount} presupuesto
              {newPresupuestosCount !== 1 ? "s" : ""} nuevo
              {newPresupuestosCount !== 1 ? "s" : ""} desde tu última carga
            </span>
            <button
              onClick={handleBannerRefresh}
              className="text-xs font-bold underline hover:no-underline"
            >
              Actualizar
            </button>
          </div>
        )}

        {tab === "kanban" && (
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            {loading ? (
              <div className="flex-1 min-h-0 grid grid-cols-3 lg:grid-cols-6 gap-3 animate-pulse content-start">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-96 rounded-2xl bg-[var(--color-surface-muted)]" />
                ))}
              </div>
            ) : presupuestos.length === 0 ? (
              <div className="flex-1 min-h-0 flex items-center justify-center">
                <EmptyState
                  className="max-w-sm"
                  icon={<ClipboardList size={24} strokeWidth={ICON_STROKE} />}
                  title="Sin presupuestos todavía"
                  hint="Crea tu primer presupuesto o importa datos desde Gesden."
                  action={
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => setShowImportCSV(true)}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] font-semibold"
                      >
                        <Upload size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        Importar CSV
                      </button>
                      <button
                        onClick={() => setShowNew(true)}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] font-semibold hover:bg-[var(--color-accent-hover)]"
                      >
                        <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        Nuevo
                      </button>
                    </div>
                  }
                />
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col">
                <KanbanBoard
                  presupuestos={presupuestos}
                  onChangeEstado={handleChangeEstado}
                  onOpenFicha={(p) => setDrawerPresupuesto(p)}
                  onEdit={handleEdit}
                  rango={rango}
                  onVerHistorico={() => setRango("todo")}
                  onVerTodosCerrados={(estado) => {
                    // Archivo real de cada columna cerrada: los aceptados
                    // viven su vida financiera en Cobros; los perdidos, en la
                    // tabla completa (vista "Tabla").
                    if (estado === "ACEPTADO") {
                      window.location.href = "/cobros?vista=registro";
                    } else {
                      setTab("maxima");
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}

        {tab === "maxima" && (
          <MaximaView
            onOpenDrawer={(p) => setIntervencionItem(p)}
            refreshKey={refrescoTabla}
            rango={rango}
          />
        )}
      </main>

      {/* Modals / drawers */}
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
            handleChangeEstado(id, "PERDIDO", {
              motivoPerdida: motivo,
              motivoPerdidaTexto: texto,
              reactivar,
            });
            // El panel de acción se cierra al CONFIRMAR (cancelar no toca nada).
            setIntervencionItem((prev) => (prev && prev.id === id ? null : prev));
          }}
          onCancel={() => setMotivoPerdido(null)}
        />
      )}
      {showNew && (
        <NewPresupuestoModal
          user={user}
          onClose={() => setShowNew(false)}
          onCreated={() => load(currentFilters, selectedClinicaNombre)}
        />
      )}
      {editPresupuesto && (
        <NewPresupuestoModal
          user={user}
          presupuesto={editPresupuesto}
          onClose={() => setEditPresupuesto(null)}
          onCreated={() => {
            load(currentFilters, selectedClinicaNombre);
            setEditPresupuesto(null);
          }}
        />
      )}
      {/* Unificación de fichas (2026-07-27): el clic en card del kanban abre
          el MISMO panel de acción que Seguimiento y la Tabla. Antes
          abría PatientDrawer, una ficha paralela sin el hilo de conversación
          en la que se registraba a mano lo que había pasado. */}
      {drawerPresupuesto && (
        <FichaPresupuesto
          presupuesto={drawerPresupuesto}
          onClose={() => setDrawerPresupuesto(null)}
          onChangeEstado={(id, estado) => {
            handleChangeEstado(id, estado);
            // ACEPTADO y PERDIDO se resuelven en su modal (pago / motivo) y
            // cierran al confirmar; el resto refleja al momento.
            if (estado !== "ACEPTADO" && estado !== "PERDIDO") {
              setDrawerPresupuesto(null);
            }
          }}
          onRefresh={() => load(currentFiltersRef.current, selectedClinicaNombre)}
        />
      )}
      {intervencionItem && (
        <IntervencionSidePanel
          item={intervencionItem}
          onClose={() => setIntervencionItem(null)}
          onChangeEstado={(id, estado) => {
            handleChangeEstado(id, estado);
            // Bloque 2 — cierre→aviso: ACEPTADO y PERDIDO se resuelven en su
            // modal (pago / motivo de pérdida) y el cierre del panel ocurre
            // al confirmar; cualquier otro estado cierra como antes.
            if (estado !== "ACEPTADO" && estado !== "PERDIDO") {
              setIntervencionItem(null);
            }
          }}
          // Enviar/llamar no cierran el panel, pero la Tabla que está detrás sí
          // tiene que enterarse: es la que enseña "Última acción".
          onRefresh={() => setRefrescoTabla((n) => n + 1)}
        />
      )}
      {showImportCSV && (
        <ImportarCSVModal
          user={user}
          existingPresupuestos={presupuestos}
          clinicas={clinicasDisponibles}
          onClose={() => setShowImportCSV(false)}
          onImported={() => load(currentFiltersRef.current, selectedClinicaNombre)}
        />
      )}
      {showNotifPanel && (
        <NotificacionesPanel
          onClose={() => setShowNotifPanel(false)}
          onNotifCountChange={setNotifCount}
        />
      )}
    </div>
  );
}
