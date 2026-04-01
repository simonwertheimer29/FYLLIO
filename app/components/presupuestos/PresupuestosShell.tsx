"use client";

import { useState, useCallback, useEffect } from "react";
import type { Presupuesto, PresupuestoEstado, UserSession, MotivoPerdida } from "../../lib/presupuestos/types";
import KanbanBoard from "./KanbanBoard";
import FiltersBar, { type Filters } from "./FiltersBar";
import ContactHistoryModal from "./ContactHistoryModal";
import NewPresupuestoModal from "./NewPresupuestoModal";
import KpiView from "./KpiView";
import DoctorView from "./DoctorView";
import TareasView from "./TareasView";
import PatientDrawer from "./PatientDrawer";
import FloatingNewButton from "./FloatingNewButton";
import CommandCenterView from "./CommandCenterView";

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
    fechaDesde: "", fechaHasta: "", q: "",
  });
  const { presupuestos, setPresupuestos, loading, isDemo, demoReason, missingVars, load } = usePresupuestos(user);

  // Modals / drawers
  const [historyPresupuesto, setHistoryPresupuesto] = useState<Presupuesto | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editPresupuesto, setEditPresupuesto] = useState<Presupuesto | null>(null);
  const [drawerPresupuesto, setDrawerPresupuesto] = useState<Presupuesto | null>(null);

  const handleFiltersChange = useCallback((f: Filters) => {
    setCurrentFilters(f);
    load(f);
  }, [load]);

  useEffect(() => { load(currentFilters); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleChangeEstado(
    id: string,
    estado: PresupuestoEstado,
    extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string }
  ) {
    setPresupuestos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, estado } : p))
    );
    try {
      await fetch(`/api/presupuestos/kanban/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, ...extra }),
      });
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

  const TABS: { id: Tab; label: string }[] = isManager
    ? [
        { id: "red",      label: "Red" },
        { id: "tareas",   label: "Tareas" },
        { id: "kanban",   label: "Panel" },
        { id: "kpis",     label: "KPIs" },
        { id: "doctor",   label: "Doctor" },
        { id: "informes", label: "Informes" },
      ]
    : [
        { id: "tareas",   label: "Tareas" },
        { id: "kanban",   label: "Panel" },
        { id: "kpis",     label: "KPIs" },
        { id: "doctor",   label: "Doctor" },
      ];

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

        {/* User */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:block text-right">
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

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-4 shrink-0">
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

      {/* Content */}
      <main className="flex-1 min-h-0 overflow-auto flex flex-col p-4 gap-4 w-full">
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
        {tab === "informes" && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-400">
            <p className="text-4xl">📊</p>
            <p className="font-semibold text-slate-600">Informes IA — próximamente</p>
            <p className="text-sm">Informe mensual generado por IA y forecasting de pipeline.</p>
          </div>
        )}
      </main>

      {/* Floating new presupuesto button — all tabs */}
      <FloatingNewButton onClick={() => setShowNew(true)} />

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
        />
      )}
    </div>
  );
}
