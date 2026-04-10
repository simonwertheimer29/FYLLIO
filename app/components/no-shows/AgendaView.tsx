"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoShowsUserSession, RiskyAppt, GapSlot } from "../../lib/no-shows/types";
import type { AgendaDay } from "../../lib/no-shows/demo";

// ─── Calendar constants ───────────────────────────────────────────────────────

const PX_PER_MIN = 1.5;
const START_H = 9;
const END_H   = 19;
const START_MIN = START_H * 60;  // 540
const CAL_H   = (END_H - START_H) * 60 * PX_PER_MIN; // 900px
const MIN_BLOCK_H = 18;
const HOURS = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);

const DAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie"];
const MONTHS_ES  = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// ─── Week helpers (client-only, no Luxon needed) ─────────────────────────────

function getMondayIso(): string {
  const now = new Date();
  const dow = now.getDay() || 7;    // 1=Lun … 7=Dom
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow + 1);
  return monday.toISOString().slice(0, 10);
}

function offsetMondayIso(mondayIso: string, delta: number): string {
  const d = new Date(mondayIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

function weekLabel(mondayIso: string): string {
  const mon = new Date(mondayIso + "T12:00:00Z");
  const fri = new Date(mondayIso + "T12:00:00Z");
  fri.setUTCDate(fri.getUTCDate() + 4);
  return `${mon.getUTCDate()}–${fri.getUTCDate()} ${MONTHS_ES[mon.getUTCMonth()]} ${mon.getUTCFullYear()}`;
}

function dayLabel(mondayIso: string, offset: number): { short: string; num: number } {
  const d = new Date(mondayIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return { short: DAYS_SHORT[offset], num: d.getUTCDate() };
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

function topPx(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h * 60 + m) - START_MIN) * PX_PER_MIN;
}

function heightPx(durationMin: number): number {
  return Math.max(MIN_BLOCK_H, durationMin * PX_PER_MIN);
}

function apptDurationMin(appt: RiskyAppt): number {
  if (!appt.end) return 30;
  const [eh, em] = appt.end.slice(11, 16).split(":").map(Number);
  const [sh, sm] = appt.start.slice(11, 16).split(":").map(Number);
  return Math.max(15, (eh * 60 + em) - (sh * 60 + sm));
}

function apptColor(appt: RiskyAppt): string {
  // Azul = confirmada (override)
  if (appt.confirmed) return "#2563EB";
  // Color por score de riesgo
  if (appt.riskScore >= 61) return "#DC2626"; // Rojo HIGH
  if (appt.riskScore >= 31) return "#D97706"; // Naranja MED
  return "#16A34A";                            // Verde LOW
}

// ─── Appointment block ────────────────────────────────────────────────────────

function ApptBlock({ appt }: { appt: RiskyAppt }) {
  const top    = topPx(appt.startDisplay);
  const height = heightPx(apptDurationMin(appt));
  const color  = apptColor(appt);
  const nombre = appt.patientName.split(" ")[0];

  // Only show inside working hours
  if (top < 0 || top > CAL_H) return null;

  return (
    <div
      style={{ top, height, left: 2, right: 2, backgroundColor: color }}
      className="absolute rounded text-white overflow-hidden leading-none z-10 cursor-default"
      title={`${appt.startDisplay} ${appt.patientName} · ${appt.treatmentName} · Score ${appt.riskScore}`}
    >
      <div className="px-1 pt-0.5">
        <p className="text-[9px] font-bold">{appt.startDisplay}</p>
        <p className="text-[10px] font-semibold truncate">{nombre}</p>
        {height > 36 && (
          <p className="text-[9px] opacity-80 truncate">
            {appt.treatmentName.length > 14 ? appt.treatmentName.slice(0, 13) + "…" : appt.treatmentName}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Gap block ────────────────────────────────────────────────────────────────

function GapBlock({ gap }: { gap: GapSlot }) {
  const top    = topPx(gap.startDisplay);
  const height = heightPx(gap.durationMin);

  if (top < 0 || top > CAL_H) return null;

  return (
    <div
      style={{ top, height, left: 2, right: 2 }}
      className="absolute rounded border border-dashed border-slate-300 bg-slate-100 flex items-center justify-center overflow-hidden z-0"
      title={`Hueco ${gap.startDisplay}–${gap.endDisplay} (${gap.durationMin} min)`}
    >
      {height > 28 && (
        <span className="text-[9px] text-slate-400 text-center px-0.5 leading-tight">
          Hueco<br />{gap.durationMin}m
        </span>
      )}
    </div>
  );
}

// ─── Day column ───────────────────────────────────────────────────────────────

function DayColumn({
  dayLabel: dl,
  dayNum,
  dayData,
  isToday,
}: {
  dayLabel: string;
  dayNum: number;
  dayData: AgendaDay;
  isToday: boolean;
}) {
  return (
    <div className="flex-1 min-w-0" style={{ minWidth: 80 }}>
      {/* Day header */}
      <div
        className={`text-center pb-1.5 border-b ${
          isToday ? "border-cyan-400" : "border-slate-200"
        }`}
      >
        <p
          className={`text-[10px] font-bold uppercase tracking-wide ${
            isToday ? "text-cyan-700" : "text-slate-500"
          }`}
        >
          {dl}
        </p>
        <p
          className={`text-sm font-extrabold leading-none mt-0.5 ${
            isToday ? "text-cyan-700" : "text-slate-800"
          }`}
        >
          {dayNum}
        </p>
      </div>

      {/* Calendar body */}
      <div
        className="relative border-l border-slate-100"
        style={{ height: CAL_H }}
      >
        {/* Hour grid lines */}
        {HOURS.map((h) => (
          <div
            key={h}
            className="absolute inset-x-0 border-t border-slate-100"
            style={{ top: (h - START_H) * 60 * PX_PER_MIN }}
          />
        ))}

        {/* Gap blocks (behind appointments) */}
        {dayData.gaps.map((g) => (
          <GapBlock key={g.startIso} gap={g} />
        ))}

        {/* Appointment blocks */}
        {dayData.appointments.map((a) => (
          <ApptBlock key={a.id} appt={a} />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type AgendaData = { week: string; days: AgendaDay[]; isDemo?: boolean };

export default function AgendaView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const [mondayIso, setMondayIso] = useState<string>(getMondayIso);
  const [data, setData]           = useState<AgendaData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [clinicaFilter, setClinicaFilter] = useState("");

  const load = useCallback(async (monday: string, clinica?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/agenda", location.href);
      url.searchParams.set("week", monday);
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(mondayIso, clinicaFilter || undefined);
  }, [load, mondayIso, clinicaFilter]);

  function goWeek(delta: number) {
    setMondayIso((w) => offsetMondayIso(w, delta));
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full max-w-2xl">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-slate-100 rounded-xl" />)}
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

  const todayIso = new Date().toISOString().slice(0, 10);

  // Build 5 day slots (Mon–Fri), even if some are empty
  const daySlots = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mondayIso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const found = data.days.find((day) => day.dayIso === iso);
    return found ?? { dayIso: iso, appointments: [], gaps: [] };
  });

  const clinicas = isManager
    ? [...new Set(data.days.flatMap((d) => d.appointments.map((a) => a.clinica)).filter(Boolean) as string[])].sort()
    : [];

  const totalAppts = data.days.reduce((s, d) => s + d.appointments.length, 0);
  const highCount  = data.days.reduce((s, d) => s + d.appointments.filter((a) => a.riskScore >= 61).length, 0);

  const isCurrentWeek = mondayIso === getMondayIso();

  // Legend items
  const LEGEND = [
    { color: "#DC2626", label: "Alto (≥61)" },
    { color: "#D97706", label: "Medio (31–60)" },
    { color: "#16A34A", label: "Bajo (≤30)" },
    { color: "#2563EB", label: "Confirmada" },
    { color: "#E2E8F0", label: "Hueco", border: true },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 w-full max-w-4xl mx-auto">
      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* Header */}
      <div className="rounded-2xl bg-white border border-slate-200 p-3 space-y-2.5">
        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => goWeek(-1)}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
          >
            ←
          </button>
          <div className="flex-1 text-center">
            <p className="text-sm font-bold text-slate-900">{weekLabel(mondayIso)}</p>
            {isCurrentWeek && (
              <p className="text-[10px] text-cyan-600 font-semibold">Semana actual</p>
            )}
          </div>
          <button
            onClick={() => goWeek(1)}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
          >
            →
          </button>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span><span className="font-bold text-slate-800">{totalAppts}</span> citas</span>
          {highCount > 0 && (
            <span className="text-red-700 font-semibold">⚠️ {highCount} riesgo alto</span>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {LEGEND.map(({ color, label, border }) => (
            <div key={label} className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded-sm shrink-0"
                style={{
                  backgroundColor: color,
                  border: border ? "1px dashed #94a3b8" : "none",
                }}
              />
              <span className="text-[10px] text-slate-500">{label}</span>
            </div>
          ))}
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

      {/* Calendar */}
      <div className="rounded-2xl bg-white border border-slate-200 p-3 overflow-x-auto">
        <div style={{ minWidth: 440 }} className="flex">
          {/* Time gutter */}
          <div className="shrink-0 relative" style={{ width: 36 }}>
            {/* Spacer for day headers */}
            <div style={{ height: 48 }} />
            {/* Hour labels */}
            <div className="relative" style={{ height: CAL_H }}>
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-1 text-[9px] text-slate-400 font-mono leading-none"
                  style={{ top: (h - START_H) * 60 * PX_PER_MIN - 5 }}
                >
                  {h}:00
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          <div className="flex flex-1 gap-0">
            {daySlots.map((dayData, i) => {
              const { short, num } = dayLabel(mondayIso, i);
              return (
                <DayColumn
                  key={dayData.dayIso}
                  dayLabel={short}
                  dayNum={num}
                  dayData={dayData}
                  isToday={dayData.dayIso === todayIso}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
