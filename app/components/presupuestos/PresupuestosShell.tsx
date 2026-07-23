"use client";

// Sprint 8 D.6 — /presupuestos simplificado a toggle Panel / Máxima.
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
import FiltersBar, { type Filters } from "./FiltersBar";
import { useClinic } from "../../lib/context/ClinicContext";
import ContactHistoryModal from "./ContactHistoryModal";
import NewPresupuestoModal from "./NewPresupuestoModal";
import PatientDrawer from "./PatientDrawer";
import ImportarCSVModal from "./ImportarCSVModal";
import IntervencionSidePanel from "./IntervencionSidePanel";
import NotificacionesPanel from "./NotificacionesPanel";
import PagoCierreModal, { type PagoCierre } from "./PagoCierreModal";
import MotivoPerdidaModal from "./MotivoPerdidaModal";

type Tab = "kanban" | "maxima";

// ─── Mini hook para cargar presupuestos ──────────────────────────────────────

function usePresupuestos() {
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [demoReason, setDemoReason] = useState<string | undefined>();
  const [missingVars, setMissingVars] = useState<string[]>([]);

  // Sprint 13.1 Bloque 2 — la clinica viene SIEMPRE del ClinicContext
  // (GlobalHeader). El filtro local fue eliminado de FiltersBar.
  const load = useCallback(
    async (filters: Filters, clinicaFromContext: string | null) => {
      setLoading(true);
      try {
        const url = new URL("/api/presupuestos/kanban", location.href);
        if (clinicaFromContext) url.searchParams.set("clinica", clinicaFromContext);
        if (filters.doctor) url.searchParams.set("doctor", filters.doctor);
        if (filters.tipoPaciente) url.searchParams.set("tipoPaciente", filters.tipoPaciente);
        if (filters.tipoVisita) url.searchParams.set("tipoVisita", filters.tipoVisita);
        if (filters.estado) url.searchParams.set("estado", filters.estado);
        if (filters.fechaDesde) url.searchParams.set("fechaDesde", filters.fechaDesde);
        if (filters.fechaHasta) url.searchParams.set("fechaHasta", filters.fechaHasta);
        if (filters.q) url.searchParams.set("q", filters.q);

        const res = await fetch(url.toString());
        const d = await res.json();
        setPresupuestos(d.presupuestos ?? []);
        setIsDemo(d.isDemo ?? false);
        setDemoReason(d.demoReason);
        setMissingVars(d.missingVars ?? []);
      } catch {
        setPresupuestos([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { presupuestos, setPresupuestos, loading, isDemo, demoReason, missingVars, load };
}

// ─── Main Shell ──────────────────────────────────────────────────────────────

export default function PresupuestosShell({ user }: { user: UserSession }) {
  const [tab, setTab] = useState<Tab>("kanban");
  const [currentFilters, setCurrentFilters] = useState<Filters>({
    clinica: "", doctor: "", tipoPaciente: "", tipoVisita: "",
    estado: "", fechaDesde: "", fechaHasta: "", q: "",
  });
  // Sprint 13.1 Bloque 2 — Clínica viene del GlobalHeader (ClinicContext).
  // El campo Filters.clinica se mantiene por backwards-compat pero no se
  // usa para filtrar (siempre vacío).
  const { selectedClinicaNombre } = useClinic();
  const { presupuestos, setPresupuestos, loading, isDemo, load } = usePresupuestos();

  const clinicasDisponibles = useMemo(() => {
    const s = new Set<string>(presupuestos.map((p) => p.clinica).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [presupuestos]);

  // Modals / drawers
  const [historyPresupuesto, setHistoryPresupuesto] = useState<Presupuesto | null>(null);
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
        const res = await fetch("/api/notificaciones");
        const d = await res.json();
        setNotifCount(d.noLeidas ?? 0);
      } catch {
        /* silent */
      }
    }
    pollNotifs();
    const n = setInterval(pollNotifs, 60_000);
    return () => clearInterval(n);
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/presupuestos/kanban");
        const d = await res.json();
        const count: number = (d.presupuestos ?? []).length;
        if (lastCountRef.current !== null && count > lastCountRef.current) {
          setNewPresupuestosCount(count - lastCountRef.current);
        }
        lastCountRef.current = count;
      } catch {
        /* silent */
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

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
        }).catch(() => {});
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
        toast.success(`Pago de ${pago.importe.toLocaleString("es-ES")} € registrado`);
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
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      {/* Minibar: título + toggle + acciones + notificaciones */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center gap-3 shrink-0">
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Presupuestos</h1>

        <div className="flex gap-1">
          <ToggleBtn active={tab === "kanban"} onClick={() => setTab("kanban")}>
            Panel
          </ToggleBtn>
          <ToggleBtn active={tab === "maxima"} onClick={() => setTab("maxima")}>
            Máxima
          </ToggleBtn>
        </div>

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
        <div className="shrink-0 bg-[var(--color-accent)] text-[var(--color-on-accent)] px-4 py-2 flex items-center justify-between gap-4">
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

      <main className="flex-1 min-h-0 overflow-auto flex flex-col p-4 gap-4 w-full">
        {tab === "kanban" && (
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            <div className="shrink-0">
              <FiltersBar user={user} onFiltersChange={handleFiltersChange} />
            </div>

            {isDemo && (
              <div className="shrink-0 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                <span className="font-semibold">Datos de demostración.</span>{" "}
                Esta clínica aún no tiene datos conectados. Contacta con Fyllio para activarlos.
              </div>
            )}

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
              <div className="flex-1 min-h-0">
                <KanbanBoard
                  presupuestos={presupuestos}
                  onChangeEstado={handleChangeEstado}
                  onOpenHistory={(p) => setHistoryPresupuesto(p)}
                  onEdit={handleEdit}
                />
              </div>
            )}
          </div>
        )}

        {tab === "maxima" && (
          <MaximaView user={user} onOpenDrawer={(p) => setIntervencionItem(p)} />
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
      {historyPresupuesto && (
        <ContactHistoryModal
          presupuestoId={historyPresupuesto.id}
          patientName={historyPresupuesto.patientName}
          onClose={() => setHistoryPresupuesto(null)}
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
      {drawerPresupuesto && (
        <PatientDrawer
          presupuesto={drawerPresupuesto}
          onClose={() => setDrawerPresupuesto(null)}
          onChangeEstado={(id, estado, extra) => {
            handleChangeEstado(id, estado, extra);
            // ACEPTADO se resuelve en el modal de pago (handleConfirmAceptado
            // actualiza el drawer al confirmar); el resto refleja al momento.
            if (estado !== "ACEPTADO") {
              setDrawerPresupuesto((prev) =>
                prev && prev.id === id ? { ...prev, estado } : prev
              );
            }
          }}
          onNewForPatient={() => {
            setDrawerPresupuesto(null);
            setShowNew(true);
          }}
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
          // Enviar/llamar ya no cierran el panel; la cola se recupera con su
          // propio polling interno.
          onRefresh={() => {}}
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

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active
          ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
          : "bg-[var(--color-surface)] text-[var(--color-muted)] border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
      }`}
    >
      {children}
    </button>
  );
}
