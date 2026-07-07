"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import type {
  NoShowsUserSession,
  RiskyAppt,
  GapSlot,
  RecallAlert,
  AccionTask,
} from "../../lib/no-shows/types";
import AccionSidePanel, { type HistorialItem } from "./AccionSidePanel";
import { useClinic } from "../../lib/context/ClinicContext";
import { KpiCard } from "../ui/KpiCard";
import { EmptyState, ErrorState } from "../ui/Feedback";
import {
  Check, CheckCircle2, X, AlertTriangle, Zap, RefreshCw, ChevronDown,
  ArrowRight, ICON_STROKE,
} from "../icons";
import { ChevronUp, LayoutList, List } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type AccionesData = {
  tasks: AccionTask[];
  canceladosHoy: RiskyAppt[];
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
  if (score >= 80) return "var(--color-danger)";
  if (score >= 60) return "var(--color-warning)";
  if (score >= 40) return "var(--color-accent)";
  return "var(--color-muted)";
}

function scoreBgClass(score: number): string {
  if (score >= 80) return "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-transparent";
  if (score >= 60) return "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-transparent";
  if (score >= 40) return "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-transparent";
  return "bg-[var(--color-surface-muted)] text-[var(--color-muted)] border-[var(--color-border)]";
}

function calcFaseLabel(hoursUntil: number): string {
  if (hoursUntil <= 0) return "CRÍTICO";
  if (hoursUntil < 24) return "24h";
  if (hoursUntil < 48) return "48h";
  return "72h";
}

function faseStyle(fase: string): string {
  if (fase === "CRÍTICO") return "bg-[var(--color-danger-soft)] text-[var(--color-danger)]";
  if (fase === "24h")    return "bg-[var(--color-danger-soft)] text-[var(--color-danger)]";
  if (fase === "48h")    return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
  return "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300";
}

function confianzaShort(c: number | undefined): { text: string; color: string; Icon: LucideIcon | null } {
  if (c === undefined) return { text: "", color: "", Icon: null };
  if (c > 0.8)  return { text: "Fiable",      color: "text-[var(--color-success)]", Icon: Check };
  if (c >= 0.5) return { text: "Mixto",       color: "text-[var(--color-warning)]", Icon: AlertTriangle };
  return              { text: "Alto riesgo",  color: "text-[var(--color-danger)]",  Icon: X };
}

function dayLabel(dayIso: string): string {
  const d = new Date(dayIso + "T12:00:00Z");
  const days   = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function relativeDay(dayIso: string): string {
  if (dayIso === getTodayIso())    return "Hoy";
  if (dayIso === getTomorrowIso()) return "Mañana";
  return dayLabel(dayIso);
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

  // Sprint 7 Fase 5: filtro de clínica viene del ClinicContext global.
  const { selectedClinicaId } = useClinic();

  // Filters
  const [profesionalFilter, setPF] = useState("");
  const [clinicasDisponibles, setClinics] = useState<ClinicaEntry[]>([]);
  const [staffPorClinica, setStaff] = useState<Record<string, StaffEntry[]>>({});

  // clinicaFilter (id lógico) se deriva mapeando selectedClinicaId (recordId).
  const clinicaFilter = useMemo(() => {
    if (!selectedClinicaId) return "";
    return clinicasDisponibles.find((c) => c.recordId === selectedClinicaId)?.id ?? "";
  }, [selectedClinicaId, clinicasDisponibles]);

  // Done set (source of truth = Airtable yaGestionado + localStorage fallback)
  const [done, setDone] = useState<Set<string>>(new Set());

  // Historial local
  const [historialLocal, setHistorialLocal] = useState<HistorialItem[]>([]);

  // Compact mode
  const [compactHoy, setCompactHoy] = useState(false);

  // Expanded days (SEMANA)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // citaId URL param — auto-abrir panel
  const pendingCitaIdRef = useRef<string | null>(null);

  function showToast(msg: string, ok = true) {
    if (ok) toast.success(msg);
    else toast.error(msg);
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
          if (!s.clinicaRecordId) continue;
          if (s.nombre && String(s.nombre).toLowerCase().includes("recep")) continue;
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

  // Capturar citaId de la URL al montar
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const citaId = params.get("citaId");
    if (citaId) pendingCitaIdRef.current = citaId;
  }, []);

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

  // Auto-abrir panel cuando data carga y hay un citaId pendiente
  useEffect(() => {
    if (!data || !pendingCitaIdRef.current) return;
    const citaId = pendingCitaIdRef.current;
    pendingCitaIdRef.current = null;

    // Buscar en data.tasks (sin aplicar filtros de profesional)
    const task = data.tasks.find(t => t.appt?.id === citaId || t.id === citaId);
    if (!task) return;

    // Auto-seleccionar doctor de esa cita
    const pid = task.appt?.profesionalId;
    if (pid) setPF(pid);

    // Abrir panel
    const item = toUnifiedAppt(task, data.recalls ?? []);
    if (item) setSelectedItem(item);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // selectedClinicaId es el Airtable recordId = la clave de staffPorClinica.
  const profesionalesDisponibles: StaffEntry[] = selectedClinicaId
    ? (staffPorClinica[selectedClinicaId] ?? [])
    : Object.values(staffPorClinica).flat();

  function applyFilters(tasks: AccionTask[]): AccionTask[] {
    if (!profesionalFilter) return tasks;
    return tasks.filter(t => {
      if (t.category === "GAP") return t.gap?.staffId === profesionalFilter;
      return t.appt?.profesionalId === profesionalFilter;
    });
  }

  // handleClinicaChange eliminado — la clínica se cambia desde el GlobalHeader.
  // Reset del profesional cuando cambia la clínica global.
  useEffect(() => {
    const lista = selectedClinicaId
      ? (staffPorClinica[selectedClinicaId] ?? [])
      : Object.values(staffPorClinica).flat();
    setPF(lista[0]?.id ?? "");
  }, [selectedClinicaId, staffPorClinica]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const allTasks = data ? applyFilters(data.tasks) : [];
  const recalls = data?.recalls ?? [];

  // Fechas para labels
  const todayIso    = getTodayIso();
  const tomorrowIso = getTomorrowIso();

  // URGENTE: scoreAccion >= 70 (cualquier día del rango)
  const urgenteItems: UnifiedItem[] = allTasks
    .filter(t => !done.has(t.id) && (t.scoreAccion ?? 0) >= 70)
    .sort((a, b) => (b.scoreAccion ?? 0) - (a.scoreAccion ?? 0))
    .map(t => toUnifiedAppt(t, recalls))
    .filter((x): x is UnifiedItem => x !== null);

  // PENDIENTE: scoreAccion 30–69 (cualquier día del rango)
  const semanaItems: UnifiedItem[] = allTasks
    .filter(t => !done.has(t.id) && (t.scoreAccion ?? 0) >= 30 && (t.scoreAccion ?? 0) < 70)
    .sort((a, b) => (b.scoreAccion ?? 0) - (a.scoreAccion ?? 0))
    .map(t => toUnifiedAppt(t, recalls))
    .filter((x): x is UnifiedItem => x !== null);

  // Día más próximo con items PENDIENTE (para label columna derecha)
  const proximoDiaPendiente: string | null = semanaItems.length > 0
    ? (semanaItems
        .map(i => i.type === "appt" ? i.data.dayIso : i.type === "gap" ? i.data.dayIso : null)
        .filter((d): d is string => d !== null)
        .sort()[0] ?? null)
    : null;

  // Progress bar (sobre urgentes)
  const totalAcciones  = allTasks.length;
  const totalUrgente   = urgenteItems.length + done.size;
  const pct = totalUrgente > 0 ? Math.round(done.size / totalUrgente * 100) : 100;

  // SEMANA: agrupar todos los días con tasks
  const allDaysSet = new Set<string>();
  for (const t of allTasks) {
    if (t.appt?.dayIso) allDaysSet.add(t.appt.dayIso);
    if (t.gap?.dayIso)  allDaysSet.add(t.gap.dayIso);
  }
  const allDays = Array.from(allDaysSet).sort();

  type DayData = { tasks: AccionTask[] };
  const byDay = new Map<string, DayData>();
  for (const d of allDays) byDay.set(d, { tasks: [] });
  for (const t of allTasks) {
    const dayIso = t.appt?.dayIso ?? t.gap?.dayIso;
    if (!dayIso) continue;
    byDay.get(dayIso)?.tasks.push(t);
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

  // Gaps para historial (todos los días del rango)
  const allGaps: UnifiedItem[] = allTasks
    .filter(t => t.category === "GAP" && t.gap)
    .map(t => toUnifiedAppt(t, recalls))
    .filter((x): x is UnifiedItem => x !== null);

  // Badges por doctor (calculado desde data.tasks completo, no filtrado)
  const urgentsByDoctor: Record<string, number> = {};
  const pendingByDoctor: Record<string, number> = {};
  for (const t of (data?.tasks ?? [])) {
    const pid = t.appt?.profesionalId;
    if (!pid || done.has(t.id) || t.yaGestionado) continue;
    const score = t.scoreAccion ?? 0;
    if (score >= 70) urgentsByDoctor[pid] = (urgentsByDoctor[pid] ?? 0) + 1;
    else if (score >= 30) pendingByDoctor[pid] = (pendingByDoctor[pid] ?? 0) + 1;
  }

  // Métricas del header (sobre todo el rango 14 días)
  const confirmadasCount = allTasks.filter(
    t => t.category === "NO_SHOW" && t.appt?.confirmed
  ).length;
  const confirmadasEuros = confirmadasCount * 80;
  const enRiesgoCount = allTasks.filter(t => (t.scoreAccion ?? 0) >= 40).length;
  const enRiesgoEuros = enRiesgoCount * 80;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 w-full pb-4">

      {/* HEADER */}
      <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 space-y-3 shrink-0">
        {/* Título + Actualizar */}
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
            Centro de control · {formatFechaEs(todayIso)}
          </h1>
          <button onClick={loadData} disabled={loading} aria-label="Actualizar"
            className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-xl bg-[var(--color-surface-muted)] border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface)] disabled:opacity-50 inline-flex items-center gap-1">
            <RefreshCw size={14} strokeWidth={ICON_STROKE} className={loading ? "animate-spin" : ""} aria-hidden />
            Actualizar
          </button>
        </div>

        {/* 4 KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard
            label="Confirmados"
            value={confirmadasEuros}
            formatter={(n) => `€${n.toLocaleString("es-ES")}`}
            accent="emerald"
            subline={`${confirmadasCount} citas`}
          />
          <KpiCard
            label="En riesgo"
            value={enRiesgoEuros}
            formatter={(n) => `€${n.toLocaleString("es-ES")}`}
            accent="rose"
            subline={`${enRiesgoCount} citas`}
          />
          <KpiCard
            label="Urgente"
            value={urgenteItems.length}
            accent="amber"
            subline="acciones"
          />
          <KpiCard
            label="Completadas"
            value={done.size}
            accent="accent"
            subline={`de ${totalUrgente} · ${pct}% del plan`}
          />
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-[var(--color-muted)]">
            <span>{done.size}/{totalUrgente} urgentes completadas</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${pct > 60 ? "bg-[var(--color-success)]" : pct > 30 ? "bg-[var(--color-warning)]" : "bg-[var(--color-danger)]"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* NAVBAR CLÍNICAS eliminada — selector vive en el GlobalHeader
            (Sprint 7 Fase 5). */}

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
                      ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                      : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-accent)]"}`}>
                  {s.nombre}
                  {urgentes > 0 && (
                    <span className="ml-0.5 bg-[var(--color-danger)] text-[var(--color-on-accent)] text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                      {urgentes}
                    </span>
                  )}
                  {urgentes === 0 && pendientes > 0 && (
                    <span className="ml-0.5 bg-[var(--color-warning)] text-[var(--color-on-accent)] text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
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
      <div className="flex gap-1 bg-[var(--color-surface-muted)] rounded-xl p-1 shrink-0">
        {(["hoy","semana","historial"] as SecTab[]).map(tab => (
          <button key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === tab ? "bg-[var(--color-surface)] shadow text-[var(--color-foreground)]" : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}>
            {tab === "hoy" ? "Hoy" : tab === "semana" ? "Semana" : "Historial"}
          </button>
        ))}
      </div>

      {/* Error/loading */}
      {error && (
        <ErrorState
          detail="Las acciones de hoy no están disponibles ahora mismo."
          onRetry={loadData}
        />
      )}
      {loading && !data && (
        <div className="flex-1 flex items-center justify-center text-[var(--color-muted)] text-sm">Cargando…</div>
      )}

      {/* ── SECCIÓN HOY ──────────────────────────────────────────────────────── */}
      {activeTab === "hoy" && data && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">

          {/* Nudge sin acciones */}
          {urgenteItems.length === 0 && semanaItems.length === 0 && (
            <EmptyState
              icon={<CheckCircle2 size={20} strokeWidth={ICON_STROKE} />}
              title="Sin acciones urgentes"
              hint="No hay citas con riesgo relevante en los próximos 14 días."
              action={
                <button onClick={() => setActiveTab("semana")}
                  className="px-4 py-2 bg-[var(--color-accent)] text-[var(--color-on-accent)] rounded-xl text-sm font-semibold hover:bg-[var(--color-accent-hover)] inline-flex items-center gap-1.5 transition-colors">
                  Ver semana
                  <ArrowRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              }
            />
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* COLUMNA URGENTE (scoreAccion >= 70) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-base font-semibold text-[var(--color-danger)]">Urgente · {urgenteItems.length}</h2>
                <button onClick={() => setCompactHoy(v => !v)}
                  className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] inline-flex items-center gap-1">
                  {compactHoy
                    ? <><LayoutList size={12} strokeWidth={1.5} aria-hidden /> Detallada</>
                    : <><List size={12} strokeWidth={1.5} aria-hidden /> Compacta</>}
                </button>
              </div>
              <div className="space-y-2">
                {urgenteItems.length === 0 && (
                  <p className="text-xs text-[var(--color-muted)] py-4 text-center">Sin urgencias</p>
                )}
                {urgenteItems.map(item => (
                  <ItemCard key={item.id} item={item} compact={compactHoy}
                    onClick={() => setSelectedItem(item)} />
                ))}
              </div>
            </div>

            {/* COLUMNA PENDIENTE (scoreAccion 30–69) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-base font-semibold text-[var(--color-warning)] truncate">
                  Pendiente{proximoDiaPendiente ? ` · próximo: ${dayLabel(proximoDiaPendiente)}` : ""} · {semanaItems.length}
                </h2>
                <button onClick={() => setCompactHoy(v => !v)}
                  className="shrink-0 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] inline-flex items-center gap-1">
                  {compactHoy
                    ? <><LayoutList size={12} strokeWidth={1.5} aria-hidden /> Detallada</>
                    : <><List size={12} strokeWidth={1.5} aria-hidden /> Compacta</>}
                </button>
              </div>
              <div className="space-y-2">
                {semanaItems.length === 0 && (
                  <p className="text-xs text-[var(--color-muted)] py-4 text-center">Sin pendientes</p>
                )}
                {semanaItems.map(item => (
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
          {allDays.map(dayIso => {
            const dd = byDay.get(dayIso) ?? { tasks: [] };
            const dayItems: UnifiedItem[] = dd.tasks
              .filter(t => !done.has(t.id) && (t.scoreAccion ?? 0) >= 30)
              .sort((a, b) => (b.scoreAccion ?? 0) - (a.scoreAccion ?? 0))
              .map(t => toUnifiedAppt(t, recalls))
              .filter((x): x is UnifiedItem => x !== null);

            if (dayItems.length === 0) return null; // ocultar días sin items relevantes

            const numUrgente  = dayItems.filter(i => i.scoreAccion >= 70).length;
            const numPendiente = dayItems.length - numUrgente;
            const isToday    = dayIso === todayIso;
            const isTomorrow = dayIso === tomorrowIso;
            const expanded = expandedDays.has(dayIso);

            return (
              <div key={dayIso} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-muted)]"
                  onClick={() => setExpandedDays(prev => {
                    const next = new Set(prev);
                    expanded ? next.delete(dayIso) : next.add(dayIso);
                    return next;
                  })}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`text-xs font-bold w-2 h-2 rounded-full shrink-0 ${numUrgente > 0 ? "bg-[var(--color-danger)]" : numPendiente > 0 ? "bg-[var(--color-warning)]" : "bg-[var(--color-success)]"}`} />
                    <span className={`text-sm font-semibold ${isToday ? "text-[var(--color-danger)]" : isTomorrow ? "text-[var(--color-warning)]" : "text-[var(--color-foreground)]"}`}>
                      {isToday ? "Hoy" : isTomorrow ? "Mañana" : dayLabel(dayIso)}
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {numUrgente > 0 && `${numUrgente} urgentes`}
                      {numUrgente > 0 && numPendiente > 0 && " · "}
                      {numPendiente > 0 && `${numPendiente} pendientes`}
                    </span>
                  </div>
                  <span className="text-[var(--color-muted)]" aria-hidden>
                    {expanded
                      ? <ChevronUp size={14} strokeWidth={1.5} />
                      : <ChevronDown size={14} strokeWidth={ICON_STROKE} />}
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-[var(--color-border)] p-3 space-y-2">
                    {dayItems.map(item => (
                      <ItemCard key={item.id} item={item} compact={false}
                        onClick={() => setSelectedItem(item)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {allDays.every(d => {
            const dd = byDay.get(d);
            return !dd || dd.tasks.filter(t => !done.has(t.id) && (t.scoreAccion ?? 0) >= 30).length === 0;
          }) && (
            <p className="text-xs text-[var(--color-muted)] py-8 text-center">Sin acciones pendientes esta semana</p>
          )}
        </div>
      )}

      {/* ── SECCIÓN HISTORIAL ─────────────────────────────────────────────────── */}
      {activeTab === "historial" && (
        <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
          {/* Sub-tabs */}
          <div className="flex border-b border-[var(--color-border)] shrink-0">
            {(["pacientes","huecos"] as HistTab[]).map(tab => (
              <button key={tab}
                onClick={() => setHistTab(tab)}
                className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all ${histTab === tab ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}>
                {tab === "pacientes" ? "Pacientes" : "Huecos"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto">
            {/* Tab Pacientes */}
            {histTab === "pacientes" && (
              <table className="w-full text-xs">
                <thead className="bg-[var(--color-surface-muted)] sticky top-0">
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)] text-left">
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
                      <td colSpan={6} className="px-4 py-8 text-center text-[var(--color-muted)]">
                        Sin acciones registradas esta semana
                      </td>
                    </tr>
                  )}
                  {histRows.map(h => (
                    <tr key={h.key} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]">
                      <td className="px-4 py-2 font-medium text-[var(--color-foreground)]">{h.paciente}</td>
                      <td className="px-4 py-2 text-[var(--color-muted)]">{h.tratamiento}</td>
                      <td className="px-4 py-2 text-[var(--color-muted)]">{h.dayIso}</td>
                      <td className="px-4 py-2 text-[var(--color-muted)]">{h.hora}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${h.tipo === "Confirmado" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : h.tipo === "Cancelado" ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]"}`}>
                          {h.tipo}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[var(--color-muted)] max-w-[120px] truncate">{h.nota}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Tab Huecos */}
            {histTab === "huecos" && (
              <table className="w-full text-xs">
                <thead className="bg-[var(--color-surface-muted)] sticky top-0">
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)] text-left">
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
                      <td colSpan={6} className="px-4 py-8 text-center text-[var(--color-muted)]">Sin huecos esta semana</td>
                    </tr>
                  )}
                  {allGaps.map(item => {
                    if (item.type !== "gap") return null;
                    const g = item.data;
                    const candidatos = recalls.filter(r => !g.clinica || r.clinica === g.clinica).length;
                    const estado = done.has(item.id) ? "Cubierto" : "Libre";
                    return (
                      <tr key={item.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]">
                        <td className="px-4 py-2 text-[var(--color-muted)]">{formatFechaEs(g.dayIso)}</td>
                        <td className="px-4 py-2 text-[var(--color-foreground)] font-medium">{g.startDisplay}–{g.endDisplay}</td>
                        <td className="px-4 py-2 text-[var(--color-muted)]">{g.staffId ?? "—"}</td>
                        <td className="px-4 py-2 text-[var(--color-muted)]">{g.durationMin} min</td>
                        <td className="px-4 py-2 text-[var(--color-muted)]">{candidatos}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${estado === "Cubierto" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"}`}>
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
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] text-left">
        <span className="text-xs font-bold shrink-0"
          style={{ color: scoreColor(item.scoreAccion) }}>
          {item.scoreAccion}
        </span>
        {item.type === "appt" ? (
          <>
            <span className="text-xs font-semibold text-[var(--color-foreground)] truncate">{item.data.patientName}</span>
            <span className="text-xs text-[var(--color-muted)] truncate">· {item.data.treatmentName} · {item.data.startDisplay}</span>
          </>
        ) : (
          <span className="text-xs text-[var(--color-muted)] truncate">Hueco {item.data.startDisplay}–{item.data.endDisplay}</span>
        )}
        <div className="flex gap-1.5 ml-auto shrink-0">
          {item.type === "appt" && (
            <>
              <a href={buildWA(item.data.patientPhone, "")} onClick={e => e.stopPropagation()}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]">WA</a>
              <a href={`tel:${item.data.patientPhone}`} onClick={e => e.stopPropagation()}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)]">Tel</a>
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
        className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] p-3 space-y-2 hover:border-[var(--color-accent)]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--color-foreground)]">Hueco disponible</p>
            <p className="text-xs text-[var(--color-accent)]">{relativeDay(g.dayIso)} · {g.startDisplay}–{g.endDisplay} · {g.durationMin} min</p>
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${scoreBgClass(item.scoreAccion)}`}>
            {item.scoreAccion}
          </span>
        </div>
        {item.overbooking && (
          <p className="text-xs font-bold text-[var(--color-warning)] inline-flex items-center gap-1">
            <Zap size={12} strokeWidth={ICON_STROKE} aria-hidden />
            Overbooking posible
          </p>
        )}
        <p className="text-xs text-[var(--color-accent)]">
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
      className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2 hover:border-[var(--color-accent)]"
      style={{ borderLeft: `4px solid ${sc}` }}>
      <div className="flex items-start gap-2.5">
        {/* Score circle */}
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0"
          style={{ borderColor: sc, color: sc }}>
          {item.scoreAccion}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--color-foreground)] truncate">{a.patientName}</p>
          <p className="text-xs text-[var(--color-muted)] truncate">{a.treatmentName} · {a.startDisplay}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${faseStyle(fase)} ${fase === "CRÍTICO" ? "animate-pulse" : ""}`}>
            {fase}
          </span>
          {ci.text && (
            <span className={`text-[10px] font-semibold inline-flex items-center gap-0.5 ${ci.color}`}>
              {ci.Icon && <ci.Icon size={10} strokeWidth={ICON_STROKE} aria-hidden />}
              {ci.text}
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--color-muted)] truncate">
        {relativeDay(a.dayIso)}{a.doctorNombre ? ` · ${a.doctorNombre}` : ""}{a.clinicaNombre ? ` · ${a.clinicaNombre}` : ""}
      </p>
      <div className="flex gap-2">
        <a href={buildWA(a.patientPhone, "")} onClick={e => e.stopPropagation()}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]">
          WA
        </a>
        <a href={`tel:${a.patientPhone}`} onClick={e => e.stopPropagation()}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]">
          Llamar
        </a>
        <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[var(--color-surface-muted)] border border-[var(--color-border)] text-[var(--color-muted)] ml-auto">
          Ver detalle →
        </span>
      </div>
    </button>
  );
}
