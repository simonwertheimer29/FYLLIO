"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoShowsUserSession, RiskyAppt, RecallAlert, RiskData } from "../../lib/no-shows/types";
import { ErrorState } from "../ui/Feedback";
import { Bell, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, ICON_STROKE } from "../icons";


// ─── Tipo extendido (API v2) ──────────────────────────────────────────────────

type ExtRiskData = Omit<RiskData, "summary"> & {
  summary: {
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    totalAppointments: number;
    recallCount: number;
    eurosEnRiesgo?: number;
  };
};

// ─── Helpers de semana ────────────────────────────────────────────────────────

function weekToMonday(weekStr: string): Date {
  const [yearStr, wStr] = weekStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

function dateToWeekStr(d: Date): string {
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const mondayJan4 = new Date(jan4);
  mondayJan4.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const diff = d.getTime() - mondayJan4.getTime();
  const week = Math.floor(diff / (7 * 24 * 3600 * 1000)) + 1;
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getCurrentWeekStr(): string {
  const now = new Date();
  const dow = now.getUTCDay(); // 0=Dom, 6=Sáb
  if (dow === 6) {
    // Sábado → avanzar 2 días al lunes siguiente
    const next = new Date(now);
    next.setUTCDate(now.getUTCDate() + 2);
    return dateToWeekStr(next);
  }
  if (dow === 0) {
    // Domingo → avanzar 1 día al lunes siguiente
    const next = new Date(now);
    next.setUTCDate(now.getUTCDate() + 1);
    return dateToWeekStr(next);
  }
  return dateToWeekStr(now);
}

function offsetWeek(weekStr: string, delta: number): string {
  const monday = weekToMonday(weekStr);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return dateToWeekStr(monday);
}

/** Devuelve los ISOs de lun–vie de la semana */
function weekDayIsos(weekStr: string): string[] {
  const monday = weekToMonday(weekStr);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  });
}

const DIAS_CORTOS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DIAS_ES_FULL = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

function formatShortDay(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return DIAS_CORTOS[d.getUTCDay() || 7];
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const dow = d.getUTCDay() || 7;
  return `${DIAS_ES_FULL[dow]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

function weekRangeLabel(weekStr: string): string {
  const monday = weekToMonday(weekStr);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  const sameMonth = monday.getUTCMonth() === friday.getUTCMonth();
  if (sameMonth) {
    return `${monday.getUTCDate()}–${friday.getUTCDate()} ${MESES[monday.getUTCMonth()]} ${monday.getUTCFullYear()}`;
  }
  return `${monday.getUTCDate()} ${MESES[monday.getUTCMonth()]} – ${friday.getUTCDate()} ${MESES[friday.getUTCMonth()]} ${friday.getUTCFullYear()}`;
}

const AVG_TICKET_CLIENT = 85;

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

function buildWhatsApp(appt: RiskyAppt): string {
  const nombre = appt.patientName.split(" ")[0];
  const hora = appt.startDisplay;
  const tratamiento = appt.treatmentName;
  if (appt.riskLevel === "HIGH") {
    return `Hola ${nombre}, queremos confirmar tu cita de ${tratamiento} el ${formatDayLabel(appt.dayIso)} a las ${hora}. Por favor responde este mensaje para confirmar. ¡Te esperamos!`;
  }
  if (appt.riskLevel === "MEDIUM") {
    return `Hola ${nombre}, te recordamos tu cita de ${tratamiento} el ${DIAS_CORTOS[new Date(appt.dayIso + "T12:00:00Z").getUTCDay() || 7]} a las ${hora}. Responde "OK" para confirmar.`;
  }
  return `Hola ${nombre}, recordatorio de tu cita el ${DIAS_CORTOS[new Date(appt.dayIso + "T12:00:00Z").getUTCDay() || 7]} a las ${hora} para ${tratamiento}.`;
}

function buildRecallWhatsApp(recall: RecallAlert): string {
  const nombre = recall.patientName.split(" ")[0];
  return `Hola ${nombre}, llevamos ${recall.weeksSinceLast} semanas desde tu última cita de ${recall.treatmentName}. ¿Te gustaría agendar tu próxima sesión?`;
}

// ─── RecallCard ───────────────────────────────────────────────────────────────

function RecallCard({ recall }: { recall: RecallAlert }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25 rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--color-foreground)] truncate">{recall.patientName}</p>
        <p className="text-xs text-[var(--color-muted)] truncate">{recall.treatmentName}</p>
        <p className="text-xs text-amber-700 dark:text-amber-300 font-medium mt-0.5">
          {recall.weeksSinceLast} sem. sin próxima cita
          {recall.clinica ? ` · ${recall.clinica}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {recall.patientPhone && (
          <a
            href={`https://wa.me/${recall.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildRecallWhatsApp(recall))}`}
            target="_blank" rel="noopener noreferrer"
            className="p-1.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white text-xs hover:bg-[var(--fyllio-wa-green-hover)] transition-colors"
          >WA</a>
        )}
        {recall.patientPhone && (
          <a
            href={`tel:${recall.patientPhone}`}
            className="p-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] text-xs hover:bg-[var(--color-surface-muted)] transition-colors"
          >Tel</a>
        )}
      </div>
    </div>
  );
}

// ─── KanbanRiskCard ───────────────────────────────────────────────────────────

function KanbanRiskCard({
  appt,
  done,
  onDone,
}: {
  appt: RiskyAppt;
  done: boolean;
  onDone: (id: string) => void;
}) {
  const isLow = appt.riskLevel === "LOW";
  const bgBorder =
    appt.riskLevel === "HIGH"   ? "border-rose-200 bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/10" :
    appt.riskLevel === "MEDIUM" ? "border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10" :
    "border-[var(--color-border)] bg-[var(--color-surface)]";
  const scoreBadge =
    appt.riskLevel === "HIGH"   ? "bg-[var(--color-danger)] text-[var(--color-on-accent)]" :
    appt.riskLevel === "MEDIUM" ? "bg-[var(--color-warning)] text-[var(--color-on-accent)]" :
    "bg-[var(--color-surface-muted)] text-[var(--color-muted)]";

  return (
    <div className={`rounded-xl border p-2.5 transition-opacity ${bgBorder} ${isLow ? "opacity-60" : ""} ${done ? "opacity-30" : ""}`}>
      <div className="flex items-start justify-between gap-1 mb-0.5">
        <p className="text-xs font-bold text-[var(--color-foreground)] leading-snug break-words min-w-0">
          {appt.patientName}
        </p>
        <span className={`shrink-0 text-[10px] font-bold rounded-full px-1.5 py-0.5 ml-1 ${scoreBadge}`}>
          {appt.riskScore}
        </span>
      </div>
      <p className="text-[10px] text-[var(--color-muted)] truncate">{appt.treatmentName}</p>
      <p className="text-[10px] text-[var(--color-muted)] inline-flex items-center gap-1">
        {appt.startDisplay}
        {appt.actionUrgent && <Clock size={10} strokeWidth={ICON_STROKE} className="text-[var(--color-danger)]" aria-hidden />}
        {!appt.confirmed ? " · sin conf." : ""}
      </p>
      {(appt.riskFactors.dayTimeLabel || appt.riskFactors.historicalNoShowCount > 0) && (
        <p className="text-[10px] text-[var(--color-muted)] mt-0.5 leading-tight">
          {[
            appt.riskFactors.dayTimeLabel,
            appt.riskFactors.historicalNoShowCount > 0
              ? `${appt.riskFactors.historicalNoShowCount}× ns prev.`
              : "",
          ].filter(Boolean).join(" · ")}
        </p>
      )}
      {!done && !isLow && (
        <div className="flex gap-1 mt-2">
          {appt.patientPhone && (
            <a
              href={`https://wa.me/${appt.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsApp(appt))}`}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 text-center text-[10px] font-bold py-1 rounded-lg bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)] transition-colors"
            >WA</a>
          )}
          {appt.patientPhone && (
            <a
              href={`tel:${appt.patientPhone}`}
              className="flex-1 text-center text-[10px] font-bold py-1 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
            >Tel</a>
          )}
          <button
            onClick={() => onDone(appt.id)}
            title="Marcar hecho"
            className="flex-1 flex items-center justify-center py-1 rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-on-accent)] transition-colors"
          ><Check size={12} strokeWidth={ICON_STROKE} aria-hidden /></button>
        </div>
      )}
    </div>
  );
}

// ─── DayColumn ────────────────────────────────────────────────────────────────

function DayColumn({
  dayIso,
  appts,
  done,
  onDone,
}: {
  dayIso: string;
  appts: RiskyAppt[];
  done: Set<string>;
  onDone: (id: string) => void;
}) {
  const highCount = appts.filter((a) => a.riskLevel === "HIGH").length;
  const medCount  = appts.filter((a) => a.riskLevel === "MEDIUM").length;
  const euros = appts
    .filter((a) => a.riskLevel === "HIGH" || a.riskLevel === "MEDIUM")
    .length * AVG_TICKET_CLIENT;

  // Ordenar: HIGH → MEDIUM → LOW, dentro de cada nivel por score desc
  const sorted = [...appts].sort((a, b) => {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    if (order[a.riskLevel] !== order[b.riskLevel]) return order[a.riskLevel] - order[b.riskLevel];
    return b.riskScore - a.riskScore;
  });

  const hasRisk = highCount > 0 || medCount > 0;

  return (
    <div className="flex-1 min-w-[148px] max-w-[220px]">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden h-full flex flex-col">
        {/* Column header */}
        <div className={`px-3 py-2.5 border-b ${hasRisk ? "border-rose-200 bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/10" : "border-[var(--color-border)] bg-[var(--color-surface-muted)]"}`}>
          <p className="text-xs font-bold text-[var(--color-foreground)]">{formatShortDay(dayIso)}</p>
          <p className="text-[10px] text-[var(--color-muted)]">{formatShortDate(dayIso)}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] text-[var(--color-muted)]">{appts.length} cita{appts.length !== 1 ? "s" : ""}</span>
            {euros > 0 && (
              <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">€{euros}</span>
            )}
          </div>
          {hasRisk && (
            <div className="flex gap-1.5 mt-1">
              {highCount > 0 && (
                <span className="text-[10px] font-bold text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-500/15 rounded-full px-1.5 py-0.5">
                  {highCount}A
                </span>
              )}
              {medCount > 0 && (
                <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-500/15 rounded-full px-1.5 py-0.5">
                  {medCount}M
                </span>
              )}
            </div>
          )}
        </div>

        {/* Cards */}
        <div className="p-2 space-y-2 flex-1">
          {sorted.length === 0 ? (
            <p className="text-[10px] text-[var(--color-muted)] text-center py-4">Sin citas</p>
          ) : (
            sorted.map((a) => (
              <KanbanRiskCard
                key={a.id}
                appt={a}
                done={done.has(a.id)}
                onDone={onDone}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RiesgoView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const [week, setWeek] = useState<string>(getCurrentWeekStr);
  const [data, setData] = useState<ExtRiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicaFilter, setClinicaFilter]             = useState<string>("");
  const [profesionalFilter, setProfesionalFilter]     = useState<string>("");
  const [clinicasDisponibles, setClinicasDisponibles] = useState<{ id: string; nombre: string; recordId: string }[]>([]);
  const [staffPorClinica, setStaffPorClinica]         = useState<Record<string, { id: string; nombre: string }[]>>({});
  const [done, setDone] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("fyllio_noshows_done") ?? "[]"));
    } catch { return new Set(); }
  });

  const load = useCallback(async (w: string, clinica?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/riesgo", location.href);
      url.searchParams.set("week", w);
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(week, clinicaFilter || undefined);
  }, [load, week, clinicaFilter]);

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
        const byClinica: Record<string, { id: string; nombre: string }[]> = {};
        for (const s of (d.staff ?? [])) {
          if (!s.clinicaRecordId) continue;
          if (!byClinica[s.clinicaRecordId]) byClinica[s.clinicaRecordId] = [];
          byClinica[s.clinicaRecordId].push({ id: s.id, nombre: s.nombre });
        }
        setStaffPorClinica(byClinica);
      }
    }
    loadMeta();
  }, []);

  function markDone(id: string) {
    const next = new Set(done);
    next.add(id);
    setDone(next);
    try { localStorage.setItem("fyllio_noshows_done", JSON.stringify([...next])); } catch { /* */ }
  }

  function handleClinicaChange(clinica: string) {
    setClinicaFilter(clinica);
    setProfesionalFilter("");
  }

  function goWeek(delta: number) {
    setWeek((w) => offsetWeek(w, delta));
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full">
          <div className="h-20 bg-[var(--color-surface-muted)] rounded-2xl" />
          <div className="flex gap-3">
            {[1,2,3,4,5].map((i) => <div key={i} className="flex-1 h-48 bg-[var(--color-surface-muted)] rounded-2xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 min-h-0 flex flex-col justify-center">
        <ErrorState
          detail="Las citas en riesgo de esta semana no están disponibles en este momento."
          onRetry={() => load(week, clinicaFilter || undefined)}
        />
      </div>
    );
  }

  const days = weekDayIsos(week);

  // Filtro cliente por profesional (clinica ya se filtra en API)
  const apptsFiltradas = profesionalFilter
    ? data.appointments.filter((a) => a.profesionalId === profesionalFilter)
    : data.appointments;

  // Agrupar citas por dayIso
  const byDay = new Map<string, RiskyAppt[]>();
  for (const dayIso of days) byDay.set(dayIso, []);
  for (const appt of apptsFiltradas) {
    const arr = byDay.get(appt.dayIso);
    if (arr) arr.push(appt);
  }

  const isCurrentWeek = week === getCurrentWeekStr();

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">

      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="font-semibold">Esta clínica aún no tiene datos conectados.</span>{" "}
          Contacta con Fyllio para activarlos.
        </div>
      )}

      {/* ── Header ── */}
      <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 space-y-3">
        {/* Navegación de semana */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => goWeek(-1)}
            aria-label="Semana anterior"
            className="p-2 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
          ><ChevronLeft size={16} strokeWidth={ICON_STROKE} aria-hidden /></button>
          <div className="text-center flex-1">
            <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wider">
              Semana {data.week?.replace(/.*-W/, "")}
            </p>
            <p className="text-sm font-bold text-[var(--color-foreground)]">{weekRangeLabel(week)}</p>
            {isCurrentWeek && (
              <p className="text-[10px] text-[var(--color-accent)] font-semibold">Semana actual</p>
            )}
          </div>
          <button
            onClick={() => goWeek(1)}
            aria-label="Semana siguiente"
            className="p-2 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
          ><ChevronRight size={16} strokeWidth={ICON_STROKE} aria-hidden /></button>
        </div>

        {/* 5 Summary cards */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: "Total",    value: data.summary.totalAppointments,        bg: "bg-[var(--color-surface-muted)] border-[var(--color-border)]", text: "text-[var(--color-foreground)]" },
            { label: "Alto",     value: data.summary.highRisk,                 bg: "bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/25",     text: "text-rose-700 dark:text-rose-300"   },
            { label: "Medio",    value: data.summary.mediumRisk,               bg: "bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25", text: "text-amber-700 dark:text-amber-300" },
            { label: "€ riesgo", value: `€${data.summary.eurosEnRiesgo ?? 0}`, bg: "bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25", text: "text-amber-700 dark:text-amber-300" },
            { label: "Recall",   value: data.summary.recallCount,              bg: "bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25", text: "text-amber-700 dark:text-amber-300" },
          ].map(({ label, value, bg, text }) => (
            <div key={label} className={`text-center py-2.5 rounded-xl border ${bg}`}>
              <p className={`font-display text-2xl font-bold tabular-nums leading-none ${text}`}>{value}</p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mt-1 leading-none">{label}</p>
            </div>
          ))}
        </div>

        {/* Navbar clínicas — pills (solo manager) */}
        {isManager && clinicasDisponibles.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {([{ id: "", nombre: "Todas" }, ...clinicasDisponibles]).map((c) => (
              <button key={c.id}
                onClick={() => handleClinicaChange(c.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap
                  ${clinicaFilter === c.id
                    ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                    : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-accent)]"}`}>
                {c.nombre}
              </button>
            ))}
          </div>
        )}

        {/* Navbar doctores — pills (visible cuando hay clínica seleccionada) */}
        {(() => {
          const recId = clinicaFilter
            ? (clinicasDisponibles.find((c) => c.id === clinicaFilter)?.recordId ?? "")
            : "";
          const profesionales = recId ? (staffPorClinica[recId] ?? []) : [];
          if (!isManager || !clinicaFilter || profesionales.length === 0) return null;
          return (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {([{ id: "", nombre: "Todos" }, ...profesionales]).map((p) => (
                <button key={p.id}
                  onClick={() => setProfesionalFilter(p.id)}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all whitespace-nowrap
                    ${profesionalFilter === p.id
                      ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                      : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-accent)]"}`}>
                  {p.nombre}
                </button>
              ))}
            </div>
          );
        })()}
      </div>

      {/* ── Kanban Lun–Vie ── */}
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-3 min-w-[760px]">
          {days.map((dayIso) => (
            <DayColumn
              key={dayIso}
              dayIso={dayIso}
              appts={byDay.get(dayIso) ?? []}
              done={done}
              onDone={markDone}
            />
          ))}
        </div>
      </div>

      {/* ── RECALL (colapsable al fondo) ── */}
      {data.recalls.length > 0 && (
        <details className="rounded-2xl bg-[var(--color-surface)] border border-amber-200 dark:border-amber-500/25 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 flex items-center justify-between select-none list-none">
            <div className="flex items-center gap-2">
              <Bell size={16} strokeWidth={ICON_STROKE} className="text-amber-700 dark:text-amber-300 shrink-0" aria-hidden />
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Pacientes en tratamiento activo sin próxima cita
              </p>
              <span className="text-xs text-amber-700 dark:text-amber-300 font-bold bg-amber-100 dark:bg-amber-500/15 rounded-full px-1.5 py-0.5">
                {data.recalls.length}
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
              Ver
              <ChevronDown size={12} strokeWidth={ICON_STROKE} aria-hidden />
            </span>
          </summary>
          <div className="border-t border-amber-200 dark:border-amber-500/25 p-4 space-y-2">
            {data.recalls.map((recall) => (
              <RecallCard key={recall.patientPhone + recall.treatmentName} recall={recall} />
            ))}
          </div>
        </details>
      )}

    </div>
  );
}
