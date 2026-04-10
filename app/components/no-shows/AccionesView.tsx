"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoShowsUserSession, AccionTask } from "../../lib/no-shows/types";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type AccionesData = {
  tasks: AccionTask[];
  summary: { total: number; urgent: number; pending: number };
  isDemo?: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff < 0) return "Vencido";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h === 0 && m < 60) return `${m} min`;
  if (h < 24) return `${h}h ${m}m`;
  return `${Math.floor(h / 24)}d`;
}

function buildWALink(phone: string, msg: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  idx,
  done,
  onDone,
}: {
  task: AccionTask;
  idx: number;
  done: boolean;
  onDone: (id: string) => void;
}) {
  const isGap = task.category === "GAP";

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-xl bg-white border border-slate-100 transition-opacity ${
        done ? "opacity-40" : ""
      }`}
    >
      {/* Number + icon */}
      <div className="shrink-0 flex flex-col items-center gap-0.5">
        <span className="text-[10px] text-slate-400 font-mono leading-none">{idx}</span>
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-sm ${
            task.urgent ? "bg-red-50" : "bg-slate-50"
          }`}
        >
          {isGap ? "📅" : "🦷"}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {task.patientName && (
          <p className="text-sm font-semibold text-slate-800 truncate">{task.patientName}</p>
        )}
        <p className="text-xs text-slate-500 leading-snug mt-0.5 line-clamp-2">{task.description}</p>
        {task.deadlineIso && !done && (
          <p className="text-[10px] text-amber-700 font-semibold mt-1">
            ⏰ {formatDeadline(task.deadlineIso)}
          </p>
        )}
      </div>

      {/* Actions */}
      {!done && (
        <div className="flex items-center gap-1 shrink-0">
          {task.phone && task.whatsappMsg && (
            <a
              href={buildWALink(task.phone, task.whatsappMsg)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-xl bg-green-600 text-white text-[10px] font-bold hover:bg-green-700 transition-colors"
              title="WhatsApp"
            >
              WA
            </a>
          )}
          {task.phone && (
            <a
              href={`tel:${task.phone}`}
              className="p-1.5 rounded-xl border border-slate-200 text-slate-600 text-[10px] hover:bg-slate-50 transition-colors"
              title="Llamar"
            >
              Tel
            </a>
          )}
          <button
            onClick={() => onDone(task.id)}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-400 text-[10px] hover:bg-slate-50 transition-colors"
            title="Marcar hecho"
          >
            ✓
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  tasks,
  done,
  onDone,
  startIdx,
  urgent,
}: {
  title: string;
  subtitle: string;
  tasks: AccionTask[];
  done: Set<string>;
  onDone: (id: string) => void;
  startIdx: number;
  urgent: boolean;
}) {
  if (tasks.length === 0) return null;

  const pendingCount = tasks.filter((t) => !done.has(t.id)).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className={`text-sm font-bold ${urgent ? "text-red-700" : "text-slate-700"}`}>
          {title}
        </p>
        {pendingCount > 0 && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              urgent ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {pendingCount}
          </span>
        )}
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>
      <div className="space-y-1.5">
        {tasks.map((task, i) => (
          <TaskCard
            key={task.id}
            task={task}
            idx={startIdx + i}
            done={done.has(task.id)}
            onDone={onDone}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccionesView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const [data, setData]         = useState<AccionesData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [clinicaFilter, setClinicaFilter] = useState("");
  const [done, setDone] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("fyllio_noshows_done") ?? "[]"));
    } catch { return new Set(); }
  });

  const load = useCallback(async (clinica?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/acciones", location.href);
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(clinicaFilter || undefined);
  }, [load, clinicaFilter]);

  function markDone(id: string) {
    const next = new Set(done);
    next.add(id);
    setDone(next);
    try { localStorage.setItem("fyllio_noshows_done", JSON.stringify([...next])); } catch { /* */ }
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full max-w-2xl">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-slate-100 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <p className="text-sm text-slate-500">Error cargando datos. Intenta refrescar.</p>
      </div>
    );
  }

  const tasks = data.tasks;
  const total = tasks.length;
  const doneCnt = tasks.filter((t) => done.has(t.id)).length;
  const pct = total > 0 ? Math.round((doneCnt / total) * 100) : 0;

  const urgentTasks  = tasks.filter((t) => t.urgent);
  const pendingTasks = tasks.filter((t) => !t.urgent);

  const clinicas = isManager
    ? [...new Set(tasks.flatMap((t) => t.appt?.clinica ? [t.appt.clinica] : t.gap?.clinica ? [t.gap.clinica] : []).filter(Boolean) as string[])].sort()
    : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 max-w-2xl w-full mx-auto">
      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* Progress + filter */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-800">
              {doneCnt}/{total} completadas
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {data.summary.urgent} urgentes · {data.summary.pending} pendientes
            </p>
          </div>
          <span className="text-lg font-extrabold text-slate-400">{pct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-cyan-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Clinic filter */}
        {isManager && clinicas.length > 0 && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinicaFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <option value="">Todas las clínicas</option>
            {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Empty state */}
      {total === 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
          <p className="text-2xl mb-2">✓</p>
          <p className="text-sm font-bold text-slate-700">Todo en orden</p>
          <p className="text-xs text-slate-400 mt-1">No hay acciones pendientes para hoy</p>
        </div>
      )}

      {/* 🔥 URGENTE */}
      {urgentTasks.length > 0 && (
        <div className="rounded-2xl bg-red-50 border border-red-200 p-4 space-y-2">
          <Section
            title="🔥 URGENTE HOY"
            subtitle="— requiere acción inmediata"
            tasks={urgentTasks}
            done={done}
            onDone={markDone}
            startIdx={1}
            urgent
          />
        </div>
      )}

      {/* 📋 PENDIENTE */}
      {pendingTasks.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
          <Section
            title="📋 PENDIENTE"
            subtitle="— para antes del final del día"
            tasks={pendingTasks}
            done={done}
            onDone={markDone}
            startIdx={urgentTasks.length + 1}
            urgent={false}
          />
        </div>
      )}
    </div>
  );
}
