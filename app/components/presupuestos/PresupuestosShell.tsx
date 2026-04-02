"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { Presupuesto, PresupuestoEstado, UserSession, MotivoPerdida } from "../../lib/presupuestos/types";
import KanbanBoard from "./KanbanBoard";
import FiltersBar, { type Filters } from "./FiltersBar";
import ContactHistoryModal from "./ContactHistoryModal";
import NewPresupuestoModal from "./NewPresupuestoModal";
import KpiView from "./KpiView";
import DoctorView from "./DoctorView";
import TareasView from "./TareasView";
import PatientDrawer from "./PatientDrawer";
import CommandCenterView from "./CommandCenterView";
import InformesView from "./InformesView";
import ImportarCSVModal from "./ImportarCSVModal";

type Tab = "red" | "kanban" | "tareas" | "kpis" | "doctor" | "informes";

// ─── Mini hook para cargar presupuestos ──────────────────────────────────────

function usePresupuestos(user: UserSession) {
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
  const isManager = user.rol === "manager_general" || user.rol === "admin";
  const [tab, setTab] = useState<Tab>(isManager ? "red" : "tareas");
  const [currentFilters, setCurrentFilters] = useState<Filters>({
    clinica: "", doctor: "", tipoPaciente: "", tipoVisita: "",
    estado: "", fechaDesde: "", fechaHasta: "", q: "",
  });
  const { presupuestos, setPresupuestos, loading, isDemo, demoReason, missingVars, load } = usePresupuestos(user);

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

  // Keyboard shortcut N → Nuevo presupuesto
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

  // Polling banner
  const [newPresupuestosCount, setNewPresupuestosCount] = useState(0);
  const lastCountRef = useRef<number | null>(null);
  const currentFiltersRef = useRef(currentFilters);
  currentFiltersRef.current = currentFilters;

  const handleFiltersChange = useCallback((f: Filters) => {
    setCurrentFilters(f);
    load(f);
  }, [load]);

  useEffect(() => { load(currentFilters); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Silent polling every 60s — show banner when count changes
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
      } catch { /* silent */ }
    }, 60_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setPresupuestos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, estado } : p))
    );
    try {
      const { reactivar, ...patchExtra } = extra ?? {};
      await fetch(`/api/presupuestos/kanban/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, ...patchExtra }),
      });
      // Si se marcó reactivar: crear contacto futuro en 90 días
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

  async function handleLogout() {
    await fetch("/api/presupuestos/auth/logout", { method: "POST" });
    location.href = "/presupuestos/login";
  }

  const TABS: { id: Tab; label: string; icon: string }[] = isManager
    ? [
        { id: "red",      label: "Red",      icon: "🕸" },
        { id: "tareas",   label: "Tareas",   icon: "✓" },
        { id: "kanban",   label: "Panel",    icon: "☰" },
        { id: "kpis",     label: "KPIs",     icon: "📊" },
        { id: "doctor",   label: "Doctor",   icon: "🩺" },
        { id: "informes", label: "Informes", icon: "📋" },
      ]
    : [
        { id: "tareas",   label: "Tareas",   icon: "✓" },
        { id: "kanban",   label: "Panel",    icon: "☰" },
        { id: "kpis",     label: "KPIs",     icon: "📊" },
        { id: "doctor",   label: "Doctor",   icon: "🩺" },
      ];

  // Bottom nav shows up to 4 primary tabs + "+" on mobile/tablet
  const BOTTOM_TABS = isManager
    ? TABS.filter((t) => ["red", "tareas", "kanban", "kpis"].includes(t.id))
    : TABS.slice(0, 4);

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 overflow-hidden shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/fyllio-wordmark.png"
              alt="Fyllio"
              className="h-8 w-auto"
              style={{ maxWidth: "none" }}
            />
          </div>
          <div className="border-l border-slate-200 pl-3">
            <p className="text-xs font-bold text-slate-900 leading-tight">Presupuestos</p>
            <p className="text-[10px] text-slate-400">{user.clinica ?? "Todas las clínicas"}</p>
          </div>
        </div>

        {/* Action buttons + User */}
        <div className="flex items-center gap-2">
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
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700"
            title="Nuevo presupuesto (N)"
          >
            <span>+</span>
            <span className="hidden sm:inline">Nuevo</span>
          </button>
          <div className="hidden sm:block text-right ml-1">
            <p className="text-xs font-semibold text-slate-700">{user.nombre}</p>
            <p className="text-[10px] text-slate-400">
              {user.rol === "manager_general" ? "Manager" : "Encargada ventas"}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Tabs — visible only on desktop */}
      <div className="hidden lg:block bg-white border-b border-slate-200 px-4 shrink-0">
        <div className="flex gap-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === t.id
                  ? "border-violet-600 text-violet-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Polling banner */}
      {newPresupuestosCount > 0 && (
        <div className="shrink-0 bg-violet-600 text-white px-4 py-2 flex items-center justify-between gap-4">
          <span className="text-xs font-semibold">
            {newPresupuestosCount} presupuesto{newPresupuestosCount !== 1 ? "s" : ""} nuevo{newPresupuestosCount !== 1 ? "s" : ""} desde tu última carga
          </span>
          <button
            onClick={handleBannerRefresh}
            className="text-xs font-bold underline hover:no-underline"
          >
            Actualizar
          </button>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 min-h-0 overflow-auto flex flex-col p-4 gap-4 w-full pb-20 lg:pb-4">
        {tab === "kanban" && (
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            <div className="shrink-0 flex items-center justify-between gap-3">
              <div className="flex-1">
                <FiltersBar user={user} onFiltersChange={handleFiltersChange} />
              </div>
              <button
                onClick={() => setShowNew(true)}
                className="shrink-0 rounded-2xl bg-violet-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-violet-700"
              >
                + Nuevo
              </button>
            </div>

            {isDemo && (
              <div className="shrink-0 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <span className="font-semibold">Datos de demostración.</span>{" "}
                {demoReason === "env_missing" ? (
                  <>
                    Añade{" "}
                    <code className="font-mono bg-amber-100 px-1 rounded">{missingVars.join(", ")}</code>
                    {" "}en Vercel → Settings → Environment Variables y redeploya.
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
                  <p className="text-xs text-slate-400 mt-1 mb-5">Crea tu primer presupuesto o importa datos desde Gesden.</p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => setShowImportCSV(true)}
                      className="text-xs px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                    >
                      ↑ Importar CSV
                    </button>
                    <button
                      onClick={() => setShowNew(true)}
                      className="text-xs px-3 py-2 rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-700"
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

        {tab === "tareas" && (
          <TareasView
            user={user}
            presupuestos={presupuestos}
            onOpenDrawer={(p) => setDrawerPresupuesto(p)}
            onChangeEstado={handleChangeEstado}
          />
        )}

        {tab === "kpis" && <KpiView user={user} showBenchmark={isManager} />}
        {tab === "doctor" && <DoctorView user={user} />}

        {/* Manager-only tabs — stubs until Bloque 2/3 */}
        {tab === "red" && (
          <CommandCenterView
            onNavigateToTareas={(clinica) => {
              setTab("tareas");
              if (clinica) {
                const f = { ...currentFilters, clinica };
                setCurrentFilters(f);
                load(f);
              }
            }}
          />
        )}
        {tab === "informes" && <InformesView user={user} />}
      </main>

      {/* Bottom Navigation — tablet/mobile only */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 flex items-stretch h-16 safe-area-inset-bottom">
        {BOTTOM_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors min-h-[44px] ${
              tab === t.id ? "text-violet-700 bg-violet-50" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            <span className="hidden sm:block">{t.label}</span>
          </button>
        ))}
        <button
          onClick={() => setShowNew(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-violet-600 hover:bg-violet-50 transition-colors min-h-[44px]"
        >
          <span className="text-xl leading-none font-light">＋</span>
          <span className="hidden sm:block">Nuevo</span>
        </button>
      </nav>

      {/* Modals */}
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
          onCreated={() => { load(currentFilters); setEditPresupuesto(null); }}
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
          onNewForPatient={() => { setDrawerPresupuesto(null); setShowNew(true); }}
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
    </div>
  );
}
