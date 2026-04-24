"use client";

// Sprint 8 D.6 — /presupuestos simplificado a toggle Panel / Máxima.
// Red/Intervención/KPIs/Informes/Tareas/Envíos/Doctor/Automatizaciones/Config
// se migran a rutas top-level. Aquí solo queda el pipeline de presupuestos.

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
import ContactHistoryModal from "./ContactHistoryModal";
import NewPresupuestoModal from "./NewPresupuestoModal";
import PatientDrawer from "./PatientDrawer";
import ImportarCSVModal from "./ImportarCSVModal";
import IntervencionSidePanel from "./IntervencionSidePanel";
import NotificacionesPanel from "./NotificacionesPanel";

type Tab = "kanban" | "maxima";

// ─── Mini hook para cargar presupuestos ──────────────────────────────────────

function usePresupuestos() {
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [demoReason, setDemoReason] = useState<string | undefined>();
  const [missingVars, setMissingVars] = useState<string[]>([]);

  const load = useCallback(async (filters: Filters) => {
    setLoading(true);
    try {
      const url = new URL("/api/presupuestos/kanban", location.href);
      if (filters.clinica) url.searchParams.set("clinica", filters.clinica);
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
  }, []);

  return { presupuestos, setPresupuestos, loading, isDemo, demoReason, missingVars, load };
}

// ─── Main Shell ──────────────────────────────────────────────────────────────

export default function PresupuestosShell({ user }: { user: UserSession }) {
  const [tab, setTab] = useState<Tab>("kanban");
  const [currentFilters, setCurrentFilters] = useState<Filters>({
    clinica: "", doctor: "", tipoPaciente: "", tipoVisita: "",
    estado: "", fechaDesde: "", fechaHasta: "", q: "",
  });
  const { presupuestos, setPresupuestos, loading, isDemo, demoReason, missingVars, load } =
    usePresupuestos();

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
      load(f);
    },
    [load]
  );

  useEffect(() => {
    load(currentFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    load(currentFiltersRef.current);
  }

  async function handleChangeEstado(
    id: string,
    estado: PresupuestoEstado,
    extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string; reactivar?: boolean }
  ) {
    setPresupuestos((prev) => prev.map((p) => (p.id === id ? { ...p, estado } : p)));
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
    } catch {
      await load(currentFilters);
    }
  }

  function handleEdit(p: Presupuesto) {
    setEditPresupuesto(p);
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden">
      {/* Minibar: título + toggle + acciones + notificaciones */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3 shrink-0">
        <p className="text-xs font-bold text-slate-900">Presupuestos</p>

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
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            title="Importar CSV"
          >
            <span>↑</span>
            <span className="hidden sm:inline">Importar CSV</span>
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700"
            title="Nuevo presupuesto (N)"
          >
            <span>+</span>
            <span className="hidden sm:inline">Nuevo</span>
          </button>
          <button
            onClick={() => setShowNotifPanel(true)}
            className="relative text-lg leading-none px-1.5 py-1 rounded-lg hover:bg-slate-100 transition-colors"
            title="Notificaciones"
          >
            🔔
            {notifCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full px-1">
                {notifCount > 9 ? "9+" : notifCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {newPresupuestosCount > 0 && (
        <div className="shrink-0 bg-sky-600 text-white px-4 py-2 flex items-center justify-between gap-4">
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
              <div className="shrink-0 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <span className="font-semibold">Datos de demostración.</span>{" "}
                {demoReason === "env_missing" ? (
                  <>
                    Añade{" "}
                    <code className="font-mono bg-amber-100 px-1 rounded">
                      {missingVars.join(", ")}
                    </code>{" "}
                    en Vercel → Settings → Environment Variables y redeploya.
                  </>
                ) : (
                  <>Conecta las tablas de Airtable para datos reales.</>
                )}
              </div>
            )}

            {loading ? (
              <div className="flex-1 min-h-0 grid grid-cols-3 lg:grid-cols-6 gap-3 animate-pulse content-start">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-96 rounded-2xl bg-slate-100" />
                ))}
              </div>
            ) : presupuestos.length === 0 ? (
              <div className="flex-1 min-h-0 flex items-center justify-center">
                <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-12 text-center max-w-sm">
                  <p className="text-2xl mb-3">📋</p>
                  <p className="text-sm font-bold text-slate-700">Sin presupuestos todavía</p>
                  <p className="text-xs text-slate-400 mt-1 mb-5">
                    Crea tu primer presupuesto o importa datos desde Gesden.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => setShowImportCSV(true)}
                      className="text-xs px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                    >
                      ↑ Importar CSV
                    </button>
                    <button
                      onClick={() => setShowNew(true)}
                      className="text-xs px-3 py-2 rounded-xl bg-sky-600 text-white font-bold hover:bg-sky-700"
                    >
                      + Nuevo
                    </button>
                  </div>
                </div>
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
          onCreated={() => load(currentFilters)}
        />
      )}
      {editPresupuesto && (
        <NewPresupuestoModal
          user={user}
          presupuesto={editPresupuesto}
          onClose={() => setEditPresupuesto(null)}
          onCreated={() => {
            load(currentFilters);
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
            setDrawerPresupuesto((prev) =>
              prev && prev.id === id ? { ...prev, estado } : prev
            );
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
            setIntervencionItem(null);
          }}
          onRefresh={() => setIntervencionItem(null)}
        />
      )}
      {showImportCSV && (
        <ImportarCSVModal
          user={user}
          existingPresupuestos={presupuestos}
          clinicas={clinicasDisponibles}
          onClose={() => setShowImportCSV(false)}
          onImported={() => load(currentFiltersRef.current)}
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
          ? "bg-slate-900 text-white"
          : "bg-white text-slate-600 border border-slate-200 hover:border-slate-400"
      }`}
    >
      {children}
    </button>
  );
}
