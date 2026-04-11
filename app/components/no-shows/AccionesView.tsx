"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  NoShowsUserSession,
  RiskyAppt,
  GapSlot,
  RecallAlert,
} from "../../lib/no-shows/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type AccionTask = {
  id: string;
  category: "NO_SHOW" | "GAP";
  patientName?: string;
  phone?: string;
  description: string;
  whatsappMsg?: string;
  deadlineIso?: string;
  urgent: boolean;
  escalado?: boolean;
  appt?: RiskyAppt;
  gap?: GapSlot;
};

type AccionesData = {
  tasks: AccionTask[];
  canceladosHoy: RiskyAppt[];
  proximosDias: RiskyAppt[];
  recalls: RecallAlert[];
  summary: { total: number; urgent: number; pending: number };
};

type StaffEntry   = { id: string; nombre: string };
type ClinicaEntry = { id: string; nombre: string; recordId: string };
type TabId        = "urgente" | "noshows" | "huecos" | "pendiente";

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getTomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWA(phone: string, msg: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "bg-red-50 text-red-700 border-red-200";
  if (score >= 60) return "bg-orange-50 text-orange-700 border-orange-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}

function scoreBorderColor(score: number): string {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f97316";
  return "#3b82f6";
}

function dayLabel(dayIso: string, todayIso: string, tomorrowIso: string): string {
  if (dayIso === todayIso) return "HOY";
  if (dayIso === tomorrowIso) return "MAÑANA";
  const d = new Date(dayIso + "T12:00:00Z");
  const days   = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function dayBadgeClass(label: string): string {
  if (label === "HOY")    return "bg-red-100 text-red-700";
  if (label === "MAÑANA") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function defaultWAMsg(appt: RiskyAppt): string {
  const nombre = appt.patientName.split(" ")[0];
  if (appt.riskLevel === "HIGH")
    return `Hola ${nombre}, queremos confirmar tu cita de ${appt.treatmentName} a las ${appt.startDisplay}. ¿Confirmas asistencia?`;
  return `Hola ${nombre}, te recordamos tu cita de ${appt.treatmentName} a las ${appt.startDisplay}. Responde OK para confirmar.`;
}

// ─── IaPanel ──────────────────────────────────────────────────────────────────

function IaPanel({
  appt,
  isNoShow,
  onClose,
}: {
  appt: RiskyAppt;
  isNoShow: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState("");
  const [error,   setError]   = useState("");

  useEffect(() => { generate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/no-shows/acciones/generar-mensaje", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientName:   appt.patientName,
          treatmentName: appt.treatmentName,
          riskScore:     appt.riskScore,
          riskLevel:     isNoShow ? "HIGH" : appt.riskLevel,
          category:      "NO_SHOW",
          hora:          appt.startDisplay,
        }),
      });
      const data = await res.json();
      if (data.mensaje) setMsg(data.mensaje);
      else setError(data.error ?? "Error al generar");
    } catch { setError("Error de red"); }
    finally  { setLoading(false); }
  }

  const waLink = msg && appt.patientPhone ? buildWA(appt.patientPhone, msg) : null;

  return (
    <div className="border-t border-violet-100 px-3 pb-3 pt-2 space-y-2 bg-violet-50">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wider">✦ Mensaje IA</p>
        <button onClick={onClose} className="text-slate-400 text-xs hover:text-slate-600">✕</button>
      </div>
      {loading && <p className="text-xs text-violet-400 animate-pulse">Generando mensaje personalizado…</p>}
      {error && !loading && <p className="text-xs text-red-500">{error}</p>}
      {!loading && msg && (
        <>
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={3}
            className="w-full text-xs rounded-lg border border-violet-200 px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-300 resize-none bg-white"
          />
          <div className="flex items-center gap-2">
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                Enviar WA
              </a>
            )}
            <button
              onClick={() => { setMsg(""); generate(); }}
              className="text-[10px] text-violet-500 hover:text-violet-700 transition-colors"
            >
              Regenerar
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(msg).catch(() => {})}
              className="text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
            >
              Copiar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ApptCard ─────────────────────────────────────────────────────────────────

function ApptCard({
  appt,
  staffById,
  done,
  onDone,
  todayIso,
  tomorrowIso,
  showIa = true,
  noShowBadge = false,
}: {
  appt: RiskyAppt;
  staffById: Record<string, string>;
  done: boolean;
  onDone: (id: string) => void;
  todayIso: string;
  tomorrowIso: string;
  showIa?: boolean;
  noShowBadge?: boolean;
}) {
  const [iaOpen, setIaOpen] = useState(false);

  const dLabel      = dayLabel(appt.dayIso, todayIso, tomorrowIso);
  const badgeClass  = scoreBadgeClass(appt.riskScore);
  const borderColor = scoreBorderColor(appt.riskScore);
  const waMsg       = defaultWAMsg(appt);
  const doctorNombre =
    appt.profesionalId ? (staffById[appt.profesionalId] ?? appt.doctorNombre ?? appt.doctor)
    : (appt.doctorNombre ?? appt.doctor);

  return (
    <div className={`rounded-xl bg-white border border-slate-100 overflow-hidden transition-opacity ${done ? "opacity-40" : ""}`}>
      <div
        className="flex items-start gap-3 p-3"
        style={{ borderLeft: `3px solid ${borderColor}` }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            {noShowBadge && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-600 text-white">
                NO-SHOW
              </span>
            )}
            <span className="text-sm font-semibold text-slate-800 truncate">{appt.patientName}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${badgeClass}`}>
              {appt.riskScore}
            </span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${dayBadgeClass(dLabel)}`}>
              {dLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500 truncate">{appt.treatmentName}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {appt.startDisplay}
            {doctorNombre ? ` · ${doctorNombre}` : ""}
          </p>
        </div>

        {!done && (
          <div className="flex items-center gap-1 shrink-0">
            {showIa && (
              <button
                onClick={() => setIaOpen((o) => !o)}
                className={`p-1.5 rounded-xl text-[10px] font-bold transition-colors ${
                  iaOpen
                    ? "bg-violet-100 text-violet-700"
                    : "bg-violet-50 text-violet-600 hover:bg-violet-100"
                }`}
                title="Generar mensaje IA"
              >
                ✦
              </button>
            )}
            {appt.patientPhone && !iaOpen && (
              <a
                href={buildWA(appt.patientPhone, waMsg)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-xl bg-green-600 text-white text-[10px] font-bold hover:bg-green-700 transition-colors"
                title="WhatsApp"
              >
                WA
              </a>
            )}
            {appt.patientPhone && (
              <a
                href={`tel:${appt.patientPhone}`}
                className="p-1.5 rounded-xl border border-slate-200 text-slate-600 text-[10px] hover:bg-slate-50 transition-colors"
                title="Llamar"
              >
                Tel
              </a>
            )}
            <button
              onClick={() => onDone(appt.id)}
              className="p-1.5 rounded-xl border border-slate-200 text-slate-400 text-[10px] hover:bg-slate-50 transition-colors"
              title="Marcar contactado"
            >
              ✓
            </button>
          </div>
        )}
      </div>

      {iaOpen && !done && (
        <IaPanel appt={appt} isNoShow={noShowBadge} onClose={() => setIaOpen(false)} />
      )}
    </div>
  );
}

// ─── GapCard ──────────────────────────────────────────────────────────────────

function GapCard({
  task,
  recalls,
  clinicaFilter,
  done,
  onDone,
  todayIso,
  tomorrowIso,
}: {
  task: AccionTask;
  recalls: RecallAlert[];
  clinicaFilter: string;
  done: boolean;
  onDone: (id: string) => void;
  todayIso: string;
  tomorrowIso: string;
}) {
  const gap    = task.gap!;
  const dLabel = dayLabel(gap.dayIso, todayIso, tomorrowIso);

  const candidates = recalls
    .filter((r) => !clinicaFilter || r.clinica === clinicaFilter)
    .slice(0, 3);

  return (
    <div className={`rounded-xl bg-white border border-slate-200 overflow-hidden transition-opacity ${done ? "opacity-40" : ""}`}>
      {/* Header */}
      <div className="p-3 flex items-center justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-700">
              {gap.startDisplay} – {gap.endDisplay}
            </span>
            <span className="text-xs text-slate-400">{gap.durationMin} min</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${dayBadgeClass(dLabel)}`}>
              {dLabel}
            </span>
          </div>
        </div>
        {!done && (
          <button
            onClick={() => onDone(task.id)}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-400 text-[10px] hover:bg-slate-50 transition-colors shrink-0"
            title="Marcar cubierto"
          >
            ✓
          </button>
        )}
      </div>

      {/* Candidatos */}
      <div className="border-t border-slate-100 px-3 pb-3">
        {candidates.length > 0 ? (
          <>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-2 mb-1.5">
              Candidatos sugeridos
            </p>
            <div className="space-y-1.5">
              {candidates.map((r) => (
                <div
                  key={r.patientPhone}
                  className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{r.patientName}</p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {r.treatmentName} · {r.weeksSinceLast} sem sin cita
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {r.patientPhone && (
                      <a
                        href={buildWA(
                          r.patientPhone,
                          `Hola ${r.patientName.split(" ")[0]}, tenemos un hueco disponible hoy a las ${gap.startDisplay}. ¿Te interesa agendar tu próxima sesión de ${r.treatmentName}?`,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded-lg bg-green-600 text-white text-[10px] font-bold hover:bg-green-700 transition-colors"
                      >
                        WA
                      </a>
                    )}
                    {r.patientPhone && (
                      <a
                        href={`tel:${r.patientPhone}`}
                        className="p-1 rounded-lg border border-slate-200 text-slate-600 text-[10px] hover:bg-slate-50 transition-colors"
                      >
                        Tel
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[10px] text-slate-400 mt-2">Sin candidatos disponibles</p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccionesView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";

  const [data,                setData]                = useState<AccionesData | null>(null);
  const [loading,             setLoading]             = useState(true);
  const [tab,                 setTab]                 = useState<TabId>("urgente");
  const [clinicaFilter,       setClinicaFilter]       = useState("");
  const [profesionalFilter,   setProfesionalFilter]   = useState("");
  const [clinicasDisponibles, setClinicasDisponibles] = useState<ClinicaEntry[]>([]);
  const [staffPorClinica,     setStaffPorClinica]     = useState<Record<string, StaffEntry[]>>({});
  const [staffById,           setStaffById]           = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem("fyllio_acciones_done") ?? "[]")); }
    catch { return new Set(); }
  });

  const todayIso    = getTodayIso();
  const tomorrowIso = getTomorrowIso();

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

  useEffect(() => { load(clinicaFilter || undefined); }, [load, clinicaFilter]);

  useEffect(() => {
    async function loadMeta() {
      const [clinRes, staffRes] = await Promise.all([
        fetch("/api/no-shows/clinicas"),
        fetch("/api/no-shows/staff"),
      ]);
      if (clinRes.ok) {
        const d = await clinRes.json();
        setClinicasDisponibles(d.clinicas ?? []);
      }
      if (staffRes.ok) {
        const d = await staffRes.json();
        const byClinica: Record<string, StaffEntry[]> = {};
        const byId: Record<string, string> = {};
        for (const s of (d.staff ?? [])) {
          byId[s.id] = s.nombre;
          if (!s.clinicaRecordId) continue;
          if (s.rol && String(s.rol).toLowerCase().includes("recep")) continue;
          if (!byClinica[s.clinicaRecordId]) byClinica[s.clinicaRecordId] = [];
          byClinica[s.clinicaRecordId].push({ id: s.id, nombre: s.nombre });
        }
        setStaffPorClinica(byClinica);
        setStaffById(byId);
      }
    }
    loadMeta();
  }, []);

  function markDone(id: string) {
    const next = new Set(done);
    next.add(id);
    setDone(next);
    try { localStorage.setItem("fyllio_acciones_done", JSON.stringify([...next])); } catch { /* */ }
  }

  function handleClinicaChange(c: string) {
    setClinicaFilter(c);
    setProfesionalFilter("");
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const gapTasks: AccionTask[] = (data?.tasks ?? []).filter((t) => t.category === "GAP");

  function filterByProf<T extends { profesionalId?: string; doctor?: string }>(items: T[]): T[] {
    if (!profesionalFilter) return items;
    return items.filter(
      (a) => a.profesionalId === profesionalFilter || a.doctor === profesionalFilter,
    );
  }

  const urgentAppts: RiskyAppt[] = filterByProf(
    (data?.tasks ?? [])
      .filter((t) => t.category === "NO_SHOW" && t.appt && t.appt.riskScore >= 80)
      .map((t) => t.appt!)
      .sort((a, b) => b.riskScore - a.riskScore),
  );

  const cancelados: RiskyAppt[] = filterByProf(
    (data?.canceladosHoy ?? []).sort((a, b) => a.startDisplay.localeCompare(b.startDisplay)),
  );

  const proximos: RiskyAppt[] = filterByProf(data?.proximosDias ?? []);

  // ── Metrics ──────────────────────────────────────────────────────────────────

  const urgentesHoy  = urgentAppts.filter((a) => a.dayIso === todayIso).length;
  const contactados  = urgentAppts.filter((a) => done.has(a.id)).length;
  const huecosHoy    = gapTasks.filter((t) => t.gap?.dayIso === todayIso).length;
  const huecosCubiertos = gapTasks.filter((t) => done.has(t.id)).length;
  const progreso     = urgentesHoy > 0 ? Math.round((contactados / urgentesHoy) * 100) : 0;

  // ── Tab counts ───────────────────────────────────────────────────────────────

  const tabCounts: Record<TabId, number> = {
    urgente:   urgentAppts.filter((a) => !done.has(a.id)).length,
    noshows:   cancelados.length,
    huecos:    gapTasks.length,
    pendiente: proximos.filter((a) => !done.has(a.id)).length,
  };

  // ── Profesionales ────────────────────────────────────────────────────────────

  const selectedRecordId = clinicaFilter
    ? (clinicasDisponibles.find((c) => c.id === clinicaFilter)?.recordId ?? "")
    : "";
  const allProfesionales = Object.values(staffPorClinica).flat();
  const profesionalesDisponibles = clinicaFilter && selectedRecordId
    ? (staffPorClinica[selectedRecordId] ?? [])
    : allProfesionales;

  // ── Group proximos by day ─────────────────────────────────────────────────────

  const proximosByDay: Record<string, RiskyAppt[]> = {};
  for (const a of proximos) {
    if (!proximosByDay[a.dayIso]) proximosByDay[a.dayIso] = [];
    proximosByDay[a.dayIso].push(a);
  }
  const proximosDays = Object.keys(proximosByDay).sort();

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full">
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

  // ── Render ────────────────────────────────────────────────────────────────────

  const TABS: { id: TabId; icon: string; label: string }[] = [
    { id: "urgente",   icon: "🔥", label: "Urgente"   },
    { id: "noshows",   icon: "👻", label: "No-shows"  },
    { id: "huecos",    icon: "🕳️", label: "Huecos"    },
    { id: "pendiente", icon: "📋", label: "Pendiente" },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 w-full">

      {/* ── Header ── */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">ACCIONES</p>
            <p className="text-base font-extrabold text-slate-900">Plan de acción del día</p>
          </div>
          <button
            onClick={() => load(clinicaFilter || undefined)}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          >
            ↻ Actualizar
          </button>
        </div>

        {/* 4 Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-red-100 bg-red-50 p-3">
            <p className="text-2xl font-black text-red-700 leading-none">{urgentesHoy}</p>
            <p className="text-xs text-red-600 mt-1">🔥 Urgentes hoy</p>
          </div>
          <div className="rounded-xl border border-green-100 bg-green-50 p-3">
            <p className="text-2xl font-black text-green-700 leading-none">{contactados}</p>
            <p className="text-xs text-green-600 mt-1">✅ Contactados</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-2xl font-black text-slate-700 leading-none">
              {huecosCubiertos}
              <span className="text-base text-slate-400 font-semibold">/{huecosHoy}</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">🕳️ Huecos cubiertos</p>
          </div>
          <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3">
            <p className="text-2xl font-black text-cyan-700 leading-none">{progreso}%</p>
            <p className="text-xs text-cyan-600 mt-1">% Progreso hoy</p>
          </div>
        </div>

        {/* Filtros */}
        {isManager && clinicasDisponibles.length > 0 && (
          <div className="flex gap-2">
            <select
              value={clinicaFilter}
              onChange={(e) => handleClinicaChange(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
            >
              <option value="">Todas las clínicas</option>
              {clinicasDisponibles.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            {profesionalesDisponibles.length > 0 && (
              <select
                value={profesionalFilter}
                onChange={(e) => setProfesionalFilter(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
              >
                <option value="">Todos</option>
                {profesionalesDisponibles.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* ── Tab Bar + Content ── */}
      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {TABS.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex flex-col items-center py-2.5 px-1 text-[10px] font-semibold transition-colors border-b-2 ${
                tab === id
                  ? "border-cyan-500 text-cyan-700 bg-cyan-50"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              <span className="mt-0.5">{label}</span>
              {tabCounts[id] > 0 && (
                <span className={`mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                  tab === id ? "bg-cyan-200 text-cyan-800" : "bg-slate-100 text-slate-600"
                }`}>
                  {tabCounts[id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-4 space-y-2.5">

          {/* ── URGENTE ── */}
          {tab === "urgente" && (
            <>
              {urgentAppts.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-2xl mb-2">✓</p>
                  <p className="text-sm text-slate-400">Sin pacientes urgentes</p>
                </div>
              ) : (
                [...urgentAppts.filter((a) => !done.has(a.id)), ...urgentAppts.filter((a) => done.has(a.id))].map((appt) => (
                  <ApptCard
                    key={appt.id}
                    appt={appt}
                    staffById={staffById}
                    done={done.has(appt.id)}
                    onDone={markDone}
                    todayIso={todayIso}
                    tomorrowIso={tomorrowIso}
                    showIa
                  />
                ))
              )}
            </>
          )}

          {/* ── NO-SHOWS ── */}
          {tab === "noshows" && (
            <>
              {cancelados.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-2xl mb-2">👌</p>
                  <p className="text-sm text-slate-400">Sin no-shows registrados hoy</p>
                </div>
              ) : (
                cancelados.map((appt) => (
                  <ApptCard
                    key={appt.id}
                    appt={appt}
                    staffById={staffById}
                    done={done.has(appt.id)}
                    onDone={markDone}
                    todayIso={todayIso}
                    tomorrowIso={tomorrowIso}
                    showIa
                    noShowBadge
                  />
                ))
              )}
            </>
          )}

          {/* ── HUECOS ── */}
          {tab === "huecos" && (
            <>
              {gapTasks.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-2xl mb-2">📅</p>
                  <p className="text-sm text-slate-400">No hay huecos en la agenda</p>
                </div>
              ) : (
                gapTasks.map((task) => (
                  <GapCard
                    key={task.id}
                    task={task}
                    recalls={data.recalls}
                    clinicaFilter={clinicaFilter}
                    done={done.has(task.id)}
                    onDone={markDone}
                    todayIso={todayIso}
                    tomorrowIso={tomorrowIso}
                  />
                ))
              )}
            </>
          )}

          {/* ── PENDIENTE ── */}
          {tab === "pendiente" && (
            <>
              {proximosDays.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-2xl mb-2">✓</p>
                  <p className="text-sm text-slate-400">Sin citas de riesgo en los próximos días</p>
                </div>
              ) : (
                proximosDays.map((day) => (
                  <div key={day} className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-1">
                      {dayLabel(day, todayIso, tomorrowIso)}
                    </p>
                    {proximosByDay[day].map((appt) => (
                      <ApptCard
                        key={appt.id}
                        appt={appt}
                        staffById={staffById}
                        done={done.has(appt.id)}
                        onDone={markDone}
                        todayIso={todayIso}
                        tomorrowIso={tomorrowIso}
                        showIa={false}
                      />
                    ))}
                  </div>
                ))
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
