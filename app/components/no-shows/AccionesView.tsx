"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  NoShowsUserSession,
  RiskyAppt,
  GapSlot,
  RecallAlert,
  AccionTask,
} from "../../lib/no-shows/types";
import AccionSidePanel, { type HistorialItem } from "./AccionSidePanel";

// ── Types ─────────────────────────────────────────────────────────────────────

type AccionesData = {
  tasks: AccionTask[];
  canceladosHoy: RiskyAppt[];
  proximosDias: RiskyAppt[];
  recalls: RecallAlert[];
  summary: { total: number; urgent: number; pending: number };
};

type SecTab   = "hoy" | "semana" | "historial";
type HistTab  = "pacientes" | "huecos";
type StaffEntry   = { id: string; nombre: string };
type ClinicaEntry = { id: string; nombre: string; recordId: string };

type UnifiedItem =
  | { type: "appt"; id: string; scoreAccion: number; hoursUntil: number; data: RiskyAppt; task: AccionTask }
  | { type: "gap"; id: string; scoreAccion: number; hoursUntil: number; data: GapSlot; task: AccionTask; overbooking: boolean; recalls: RecallAlert[] };

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_DONE    = "fyllio_acciones_done_v4";
const LS_HIST    = "fyllio_acciones_hist_v4";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWA(phone: string, msg: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 40) return "#3b82f6";
  return "#94a3b8";
}

function scoreBgClass(score: number): string {
  if (score >= 80) return "bg-red-50 text-red-700 border-red-200";
  if (score >= 60) return "bg-orange-50 text-orange-700 border-orange-200";
  if (score >= 40) return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

function calcFaseLabel(hoursUntil: number): string {
  if (hoursUntil <= 0) return "CRÍTICO";
  if (hoursUntil < 24) return "24h";
  if (hoursUntil < 48) return "48h";
  return "72h";
}

function faseStyle(fase: string): string {
  if (fase === "CRÍTICO") return "bg-red-100 text-red-700";
  if (fase === "24h")    return "bg-red-50 text-red-600";
  if (fase === "48h")    return "bg-amber-50 text-amber-700";
  return "bg-yellow-50 text-yellow-700";
}

function confianzaShort(c: number | undefined): { text: string; color: string } {
  if (c === undefined) return { text: "", color: "" };
  if (c > 0.8)  return { text: "✓ Fiable",    color: "text-green-600"  };
  if (c >= 0.5) return { text: "⚠ Mixto",     color: "text-orange-500" };
  return              { text: "✗ Alto riesgo", color: "text-red-600"    };
}

function dayLabel(dayIso: string): string {
  const d = new Date(dayIso + "T12:00:00Z");
  const days   = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function getCurrentWeekDays(): string[] {
  const today = new Date();
  const dow = today.getDay(); // 0=Dom, 6=Sáb
  const mon = new Date(today);
  if (dow === 6)      mon.setDate(today.getDate() + 2); // Sáb → lunes siguiente
  else if (dow === 0) mon.setDate(today.getDate() + 1); // Dom → lunes siguiente
  else                mon.setDate(today.getDate() - dow + 1); // Lun-Vie → este lunes
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function getTodayIso(): string { return new Date().toISOString().slice(0, 10); }
function getTomorrowIso(): string {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatFechaEs(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const days   = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function toUnifiedAppt(task: AccionTask, recalls: RecallAlert[]): UnifiedItem | null {
  if (task.category === "NO_SHOW" && task.appt) {
    return { type: "appt", id: task.id, scoreAccion: task.scoreAccion ?? 0, hoursUntil: task.hoursUntil ?? 999, data: task.appt, task };
  }
  if (task.category === "GAP" && task.gap) {
    return {
      type: "gap", id: task.id, scoreAccion: task.scoreAccion ?? 0, hoursUntil: task.hoursUntil ?? 999,
      data: task.gap, task, overbooking: task.overbooking ?? false, recalls,
    };
  }
  return null;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AccionesView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";

  // Data
  const [data, setData] = useState<AccionesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Navigation
  const [activeTab, setActiveTab] = useState<SecTab>("hoy");
  const [histTab, setHistTab] = useState<HistTab>("pacientes");

  // Panel
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);

  // Filters
  const [clinicaFilter, setCF] = useState(user.clinica ?? "");
  const [profesionalFilter, setPF] = useState("");
  const [clinicasDisponibles, setClinics] = useState<ClinicaEntry[]>([]);
  const [staffPorClinica, setStaff] = useState<Record<string, StaffEntry[]>>({});

  // Done set (source of truth = Airtable yaGestionado + localStorage fallback)
  const [done, setDone] = useState<Set<string>>(new Set());

  // Historial local
  const [historialLocal, setHistorialLocal] = useState<HistorialItem[]>([]);

  // Compact mode
  const [compactHoy, setCompactHoy] = useState(false);

  // Expanded days (SEMANA)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Load metadata ─────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadMeta() {
      const [clinRes, staffRes] = await Promise.all([
        fetch("/api/no-shows/clinicas"),
        fetch("/api/no-shows/staff"),
      ]);
      if (clinRes.ok) {
        const d = await clinRes.json();
        setClinics(d.clinicas ?? []);
      }
      if (staffRes.ok) {
        const d = await staffRes.json();
        const byClinica: Record<string, StaffEntry[]> = {};
        for (const s of (d.staff ?? []) as any[]) {
          if (!byClinica[s.clinicaRecordId]) byClinica[s.clinicaRecordId] = [];
          byClinica[s.clinicaRecordId].push({ id: s.id, nombre: s.nombre });
        }
        setStaff(byClinica);
      }
    }
    loadMeta();

    // Load localStorage
    try {
      const localDone = JSON.parse(localStorage.getItem(LS_DONE) ?? "[]") as string[];
      if (localDone.length) setDone(new Set(localDone));
    } catch {}
    try {
      const localHist = JSON.parse(localStorage.getItem(LS_HIST) ?? "[]") as HistorialItem[];
      setHistorialLocal(localHist);
    } catch {}
  }, []);

  // Auto-select primer doctor al cargar metadata
  useEffect(() => {
    if (Object.keys(staffPorClinica).length === 0) return;
    if (profesionalFilter) return; // ya seleccionado
    const crId = clinicasDisponibles.find(c => c.id === clinicaFilter)?.recordId;
    const lista = clinicaFilter && crId
      ? (staffPorClinica[crId] ?? [])
      : Object.values(staffPorClinica).flat();
    if (lista.length > 0) setPF(lista[0].id);
  }, [staffPorClinica, clinicasDisponibles]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (clinicaFilter) params.set("clinica", clinicaFilter);
      const res = await fetch(`/api/no-shows/acciones?${params}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const d: AccionesData = await res.json();
      setData(d);

      // Inicializar done desde Airtable (yaGestionado) + localStorage
      const airtableDone = d.tasks.filter(t => t.yaGestionado).map(t => t.id);
      const localDone = (() => {
        try { return JSON.parse(localStorage.getItem(LS_DONE) ?? "[]") as string[]; }
        catch { return [] as string[]; }
      })();
      setDone(new Set([...airtableDone, ...localDone]));
    } catch (e: any) {
      setError(e?.message ?? "Error cargando acciones");
    } finally {
      setLoading(false);
    }
  }, [clinicaFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Done management ───────────────────────────────────────────────────────

  function markDone(id: string) {
    setDone(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(LS_DONE, JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  function addHistorialItem(item: HistorialItem) {
    setHistorialLocal(prev => {
      const next = [item, ...prev].slice(0, 100);
      try { localStorage.setItem(LS_HIST, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  const selectedClinicaRecordId = clinicasDisponibles.find(c => c.id === clinicaFilter)?.recordId;
  const profesionalesDisponibles: StaffEntry[] = clinicaFilter && selectedClinicaRecordId
    ? staffPorClinica[selectedClinicaRecordId] ?? []
    : Object.values(staffPorClinica).flat();

  function applyFilters(tasks: AccionTask[]): AccionTask[] {
    if (!profesionalFilter) return tasks;
    return tasks.filter(t => !t.appt || t.appt.profesionalId === profesionalFilter);
  }

  function handleClinicaChange(clinicaId: string) {
    setCF(clinicaId);
    const crId = clinicasDisponibles.find(c => c.id === clinicaId)?.recordId;
    const lista = clinicaId && crId
      ? (staffPorClinica[crId] ?? [])
      : Object.values(staffPorClinica).flat();
    setPF(lista[0]?.id ?? "");
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const allTasks = data ? applyFilters(data.tasks) : [];
  const recalls = data?.recalls ?? [];

  // HOY: URGENTE (scoreAccion >= 60 OR hoursUntil < 24)
  const urgentes: UnifiedItem[] = allTasks
    .filter(t => !done.has(t.id) && ((t.scoreAccion ?? 0) >= 60 || (t.hoursUntil ?? 99) < 24))
    .sort((a, b) => (b.scoreAccion ?? 0) - (a.scoreAccion ?? 0))
    .map(t => toUnifiedAppt(t, recalls))
    .filter((x): x is UnifiedItem => x !== null);

  // HOY: MAÑANA (hoursUntil 24-48)
  const manana: UnifiedItem[] = allTasks
    .filter(t => !done.has(t.id) && (t.hoursUntil ?? -1) >= 24 && (t.hoursUntil ?? -1) < 48)
    .sort((a, b) => (b.scoreAccion ?? 0) - (a.scoreAccion ?? 0))
    .map(t => toUnifiedAppt(t, recalls))
    .filter((x): x is UnifiedItem => x !== null);

  // Progress bar
  const totalAcciones = allTasks.length;
  const pct = totalAcciones > 0 ? Math.round(done.size / totalAcciones * 100) : 100;
  const pendientes = Math.max(0, urgentes.length + manana.length);
  const euros = urgentes.filter(i => i.type === "appt").length * 80;

  // SEMANA data
  const weekDays = getCurrentWeekDays();
  const todayIso = getTodayIso();
  const tomorrowIso = getTomorrowIso();

  type DayData = { appts: RiskyAppt[]; gaps: GapSlot[]; tasks: AccionTask[] };
  const byDay = new Map<string, DayData>();
  for (const d of weekDays) byDay.set(d, { appts: [], gaps: [], tasks: [] });

  for (const t of allTasks) {
    if (t.appt) {
      const dd = byDay.get(t.appt.dayIso);
      if (dd) { dd.appts.push(t.appt); dd.tasks.push(t); }
    }
    if (t.gap) {
      const dd = byDay.get(t.gap.dayIso);
      if (dd) { dd.gaps.push(t.gap); dd.tasks.push(t); }
    }
  }
  for (const a of (data?.proximosDias ?? [])) {
    const dd = byDay.get(a.dayIso);
    if (dd && !dd.appts.find(x => x.id === a.id)) dd.appts.push(a);
  }

  // HISTORIAL fusionado
  const airtableGestionados = data?.tasks.filter(t => t.yaGestionado) ?? [];

  type HistRow = { key: string; paciente: string; tratamiento: string; dayIso: string; hora: string; tipo: string; nota: string; fecha: string };
  const histRows: HistRow[] = [];
  const seenIds = new Set<string>();

  for (const t of airtableGestionados) {
    if (seenIds.has(t.id)) continue;
    seenIds.add(t.id);
    histRows.push({
      key: t.id,
      paciente: t.appt?.patientName ?? t.patientName ?? "—",
      tratamiento: t.appt?.treatmentName ?? "—",
      dayIso: t.appt?.dayIso ?? "—",
      hora: t.appt?.startDisplay ?? "—",
      tipo: t.appt?.tipoUltimaAccion ?? "—",
      nota: "",
      fecha: t.appt?.ultimaAccion ?? "",
    });
  }
  for (const h of historialLocal) {
    if (seenIds.has(h.id)) continue;
    seenIds.add(h.id);
    histRows.push({ key: h.id + h.registradoEn, paciente: h.paciente, tratamiento: h.tratamiento, dayIso: h.dayIso, hora: h.hora, tipo: h.tipo, nota: h.nota, fecha: h.registradoEn });
  }
  histRows.sort((a, b) => b.fecha.localeCompare(a.fecha));

  // Gaps this week for historial tab
  const allGaps: UnifiedItem[] = allTasks
    .filter(t => t.category === "GAP" && t.gap && weekDays.includes(t.gap.dayIso))
    .map(t => toUnifiedAppt(t, recalls))
    .filter((x): x is UnifiedItem => x !== null);

  // Badges por doctor (calculado desde data.tasks completo, no filtrado)
  const urgentsByDoctor: Record<string, number> = {};
  const pendingByDoctor: Record<string, number> = {};
  for (const t of (data?.tasks ?? [])) {
    const pid = t.appt?.profesionalId;
    if (!pid || done.has(t.id) || t.yaGestionado) continue;
    const score = t.scoreAccion ?? 0;
    if (score >= 60) urgentsByDoctor[pid] = (urgentsByDoctor[pid] ?? 0) + 1;
    else if (score >= 30) pendingByDoctor[pid] = (pendingByDoctor[pid] ?? 0) + 1;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 w-full pb-4">

      {/* HEADER */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-800">
              Centro de control · {formatFechaEs(todayIso)}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {pendientes} acciones pendientes · €{euros} en juego
            </p>
          </div>
          <button onClick={loadData} disabled={loading}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            {loading ? "…" : "Actualizar"}
          </button>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-400">
            <span>{done.size}/{totalAcciones} completadas</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${pct > 60 ? "bg-green-500" : pct > 30 ? "bg-orange-500" : "bg-red-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* NAVBAR CLÍNICAS — solo manager */}
        {isManager && clinicasDisponibles.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {([{ id: "", nombre: "Todas" }, ...clinicasDisponibles] as ClinicaEntry[]).map(c => (
              <button key={c.id}
                onClick={() => handleClinicaChange(c.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap
                  ${clinicaFilter === c.id
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
                {c.nombre}
              </button>
            ))}
          </div>
        )}

        {/* NAVBAR DOCTORES */}
        {profesionalesDisponibles.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {profesionalesDisponibles.map(s => {
              const urgentes = urgentsByDoctor[s.id] ?? 0;
              const pendientes = pendingByDoctor[s.id] ?? 0;
              const isActive = profesionalFilter === s.id;
              return (
                <button key={s.id}
                  onClick={() => setPF(s.id)}
                  className={`shrink-0 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap
                    ${isActive
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
                  {s.nombre}
                  {urgentes > 0 && (
                    <span className="ml-0.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                      {urgentes}
                    </span>
                  )}
                  {urgentes === 0 && pendientes > 0 && (
                    <span className="ml-0.5 bg-orange-400 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                      {pendientes}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* NAVBAR INTERNA */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 shrink-0">
        {(["hoy","semana","historial"] as SecTab[]).map(tab => (
          <button key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === tab ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
            {tab === "hoy" ? "HOY" : tab === "semana" ? "SEMANA" : "HISTORIAL"}
          </button>
        ))}
      </div>

      {/* Error/loading */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {loading && !data && (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Cargando…</div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`rounded-xl px-4 py-2 text-sm font-semibold ${toast.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
          {toast.msg}
        </div>
      )}

      {/* ── SECCIÓN HOY ──────────────────────────────────────────────────────── */}
      {activeTab === "hoy" && data && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">

          {/* Nudge HOY completo */}
          {urgentes.length === 0 && manana.length === 0 && (
            <div className="rounded-2xl bg-green-50 border border-green-200 p-5 text-center space-y-2">
              <p className="text-green-700 font-bold text-base">✓ Hoy completado</p>
              <p className="text-green-600 text-sm">¿Adelantamos el martes?</p>
              <button onClick={() => { setActiveTab("semana"); setExpandedDays(new Set([weekDays[1]])); }}
                className="mt-1 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700">
                Ver semana →
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* COLUMNA URGENTE HOY */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-red-600">URGENTE HOY · {urgentes.length}</h2>
                <button onClick={() => setCompactHoy(v => !v)}
                  className="text-xs text-slate-400 hover:text-slate-600">
                  {compactHoy ? "▤ Detallada" : "≡ Compacta"}
                </button>
              </div>
              <div className="space-y-2">
                {urgentes.length === 0 && (
                  <p className="text-xs text-slate-400 py-4 text-center">Sin urgencias para hoy</p>
                )}
                {urgentes.map(item => (
                  <ItemCard key={item.id} item={item} compact={compactHoy}
                    onClick={() => setSelectedItem(item)} />
                ))}
              </div>
            </div>

            {/* COLUMNA MAÑANA */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-amber-600">MAÑANA · {manana.length}</h2>
                <button onClick={() => setCompactHoy(v => !v)}
                  className="text-xs text-slate-400 hover:text-slate-600">
                  {compactHoy ? "▤ Detallada" : "≡ Compacta"}
                </button>
              </div>
              <div className="space-y-2">
                {manana.length === 0 && (
                  <p className="text-xs text-slate-400 py-4 text-center">Sin citas para mañana</p>
                )}
                {manana.map(item => (
                  <ItemCard key={item.id} item={item} compact={compactHoy}
                    onClick={() => setSelectedItem(item)} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SECCIÓN SEMANA ────────────────────────────────────────────────────── */}
      {activeTab === "semana" && data && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {weekDays.map(dayIso => {
            const dd = byDay.get(dayIso) ?? { appts: [], gaps: [], tasks: [] };
            const numRiesgo = dd.appts.filter(a => a.riskScore >= 40).length;
            const numHuecos = dd.gaps.length;
            const dayEuros  = numRiesgo * 80;
            const badge: "CRÍTICO" | "ATENCIÓN" | "OK" =
              numRiesgo > 4 || dd.gaps.some(g => g.durationMin > 120) ? "CRÍTICO" :
              numRiesgo >= 2 || dd.gaps.some(g => g.durationMin > 60)  ? "ATENCIÓN" : "OK";
            const badgeClass =
              badge === "CRÍTICO" ? "bg-red-100 text-red-700" :
              badge === "ATENCIÓN" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700";
            const isToday    = dayIso === todayIso;
            const isTomorrow = dayIso === tomorrowIso;
            const expanded = expandedDays.has(dayIso);

            const dayItems: UnifiedItem[] = dd.tasks
              .filter(t => !done.has(t.id))
              .map(t => toUnifiedAppt(t, recalls))
              .filter((x): x is UnifiedItem => x !== null);

            return (
              <div key={dayIso} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() => setExpandedDays(prev => {
                    const next = new Set(prev);
                    expanded ? next.delete(dayIso) : next.add(dayIso);
                    return next;
                  })}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`text-xs font-bold w-2 h-2 rounded-full ${numRiesgo > 0 ? "bg-red-400" : "bg-green-400"} shrink-0`} />
                    <span className={`text-sm font-semibold ${isToday ? "text-red-600" : isTomorrow ? "text-amber-600" : "text-slate-700"}`}>
                      {isToday ? "HOY" : isTomorrow ? "MAÑANA" : dayLabel(dayIso)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {numRiesgo} en riesgo · {numHuecos} huecos · €{dayEuros}
                    </span>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>{badge}</span>
                  <span className="text-slate-300 text-xs">{expanded ? "▲" : "▼"}</span>
                </button>
                {expanded && (
                  <div className="border-t border-slate-100 p-3 space-y-2">
                    {dayItems.length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-2">Sin acciones pendientes</p>
                    )}
                    {dayItems.map(item => (
                      <ItemCard key={item.id} item={item} compact={false}
                        onClick={() => setSelectedItem(item)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── SECCIÓN HISTORIAL ─────────────────────────────────────────────────── */}
      {activeTab === "historial" && (
        <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* Sub-tabs */}
          <div className="flex border-b border-slate-100 shrink-0">
            {(["pacientes","huecos"] as HistTab[]).map(tab => (
              <button key={tab}
                onClick={() => setHistTab(tab)}
                className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all ${histTab === tab ? "border-cyan-600 text-cyan-700" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                {tab === "pacientes" ? "Pacientes" : "Huecos"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto">
            {/* Tab Pacientes */}
            {histTab === "pacientes" && (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="border-b border-slate-100 text-slate-400 text-left">
                    <th className="px-4 py-2 font-semibold">Paciente</th>
                    <th className="px-4 py-2 font-semibold">Tratamiento</th>
                    <th className="px-4 py-2 font-semibold">Día</th>
                    <th className="px-4 py-2 font-semibold">Hora</th>
                    <th className="px-4 py-2 font-semibold">Tipo acción</th>
                    <th className="px-4 py-2 font-semibold">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {histRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                        Sin acciones registradas esta semana
                      </td>
                    </tr>
                  )}
                  {histRows.map(h => (
                    <tr key={h.key} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-800">{h.paciente}</td>
                      <td className="px-4 py-2 text-slate-600">{h.tratamiento}</td>
                      <td className="px-4 py-2 text-slate-500">{h.dayIso}</td>
                      <td className="px-4 py-2 text-slate-500">{h.hora}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${h.tipo === "Confirmado" ? "bg-green-100 text-green-700" : h.tipo === "Cancelado" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                          {h.tipo}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-400 max-w-[120px] truncate">{h.nota}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Tab Huecos */}
            {histTab === "huecos" && (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="border-b border-slate-100 text-slate-400 text-left">
                    <th className="px-4 py-2 font-semibold">Día</th>
                    <th className="px-4 py-2 font-semibold">Franja</th>
                    <th className="px-4 py-2 font-semibold">Doctor</th>
                    <th className="px-4 py-2 font-semibold">Duración</th>
                    <th className="px-4 py-2 font-semibold">Candidatos</th>
                    <th className="px-4 py-2 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {allGaps.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">Sin huecos esta semana</td>
                    </tr>
                  )}
                  {allGaps.map(item => {
                    if (item.type !== "gap") return null;
                    const g = item.data;
                    const candidatos = recalls.filter(r => !g.clinica || r.clinica === g.clinica).length;
                    const estado = done.has(item.id) ? "Cubierto" : "Libre";
                    return (
                      <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-600">{formatFechaEs(g.dayIso)}</td>
                        <td className="px-4 py-2 text-slate-700 font-medium">{g.startDisplay}–{g.endDisplay}</td>
                        <td className="px-4 py-2 text-slate-500">{g.staffId ?? "—"}</td>
                        <td className="px-4 py-2 text-slate-500">{g.durationMin} min</td>
                        <td className="px-4 py-2 text-slate-500">{candidatos}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${estado === "Cubierto" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                            {estado}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* PANEL LATERAL */}
      {selectedItem && (
        <AccionSidePanel
          item={selectedItem}
          recalls={recalls}
          user={user}
          onClose={() => setSelectedItem(null)}
          onMarkDone={id => { markDone(id); setSelectedItem(null); showToast("Acción completada"); }}
          onRefresh={() => { loadData(); }}
          onHistorialAction={addHistorialItem}
        />
      )}
    </div>
  );
}

// ── ItemCard ──────────────────────────────────────────────────────────────────

function ItemCard({ item, compact, onClick }: {
  item: UnifiedItem;
  compact: boolean;
  onClick: () => void;
}) {
  if (compact) {
    return (
      <button onClick={onClick}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:border-slate-300 text-left">
        <span className="text-xs font-bold shrink-0"
          style={{ color: scoreColor(item.scoreAccion) }}>
          {item.scoreAccion}
        </span>
        {item.type === "appt" ? (
          <>
            <span className="text-xs font-semibold text-slate-700 truncate">{item.data.patientName}</span>
            <span className="text-xs text-slate-400 truncate">· {item.data.treatmentName} · {item.data.startDisplay}</span>
          </>
        ) : (
          <span className="text-xs text-slate-600 truncate">Hueco {item.data.startDisplay}–{item.data.endDisplay}</span>
        )}
        <div className="flex gap-1.5 ml-auto shrink-0">
          {item.type === "appt" && (
            <>
              <a href={buildWA(item.data.patientPhone, "")} onClick={e => e.stopPropagation()}
                className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">WA</a>
              <a href={`tel:${item.data.patientPhone}`} onClick={e => e.stopPropagation()}
                className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200">Tel</a>
            </>
          )}
        </div>
      </button>
    );
  }

  // Detailed card
  if (item.type === "gap") {
    const g = item.data;
    return (
      <button onClick={onClick}
        className="w-full text-left rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2 hover:border-blue-300">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-blue-800">Hueco disponible</p>
            <p className="text-xs text-blue-600">{g.startDisplay}–{g.endDisplay} · {g.durationMin} min</p>
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${scoreBgClass(item.scoreAccion)}`}>
            {item.scoreAccion}
          </span>
        </div>
        {item.overbooking && (
          <p className="text-xs font-bold text-amber-700">⚡ Overbooking posible</p>
        )}
        <p className="text-xs text-blue-500">
          {item.recalls.length > 0 ? `${item.recalls.length} candidato${item.recalls.length !== 1 ? "s" : ""}` : "Sin candidatos"}
          {" · "}Ver candidatos →
        </p>
      </button>
    );
  }

  // Appt card
  const a = item.data;
  const fase = calcFaseLabel(item.hoursUntil);
  const sc = scoreColor(item.scoreAccion);
  const ci = confianzaShort(a.confianza);

  return (
    <button onClick={onClick}
      className="w-full text-left rounded-xl border border-slate-200 bg-white p-3 space-y-2 hover:border-slate-300"
      style={{ borderLeft: `4px solid ${sc}` }}>
      <div className="flex items-start gap-2.5">
        {/* Score circle */}
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0"
          style={{ borderColor: sc, color: sc }}>
          {item.scoreAccion}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{a.patientName}</p>
          <p className="text-xs text-slate-500 truncate">{a.treatmentName} · {a.startDisplay}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${faseStyle(fase)} ${fase === "CRÍTICO" ? "animate-pulse" : ""}`}>
            {fase}
          </span>
          {ci.text && <span className={`text-[10px] font-semibold ${ci.color}`}>{ci.text}</span>}
        </div>
      </div>
      {(a.doctorNombre ?? a.clinicaNombre) && (
        <p className="text-xs text-slate-400">{a.doctorNombre ?? a.doctor ?? ""}{a.clinicaNombre ? ` · ${a.clinicaNombre}` : ""}</p>
      )}
      <div className="flex gap-2">
        <a href={buildWA(a.patientPhone, "")} onClick={e => e.stopPropagation()}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-green-50 border border-green-200 text-green-700 hover:bg-green-100">
          WA
        </a>
        <a href={`tel:${a.patientPhone}`} onClick={e => e.stopPropagation()}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-700 hover:bg-cyan-100">
          Llamar
        </a>
        <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-50 border border-slate-200 text-slate-500 ml-auto">
          Ver detalle →
        </span>
      </div>
    </button>
  );
}
