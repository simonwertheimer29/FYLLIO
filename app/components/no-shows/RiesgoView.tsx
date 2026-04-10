"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoShowsUserSession, RiskyAppt, RecallAlert, RiskData } from "../../lib/no-shows/types";
import { riskColor, riskLabel, riskBgClass } from "../../lib/no-shows/score";

// ─── Helpers de semana ────────────────────────────────────────────────────────

/** "2026-W15" → Date del lunes de esa semana (UTC) */
function weekToMonday(weekStr: string): Date {
  const [yearStr, wStr] = weekStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);
  // Jan 4th siempre está en la semana 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // lun=1…dom=7
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

/** Date → "2026-W15" */
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
  return dateToWeekStr(new Date());
}

function offsetWeek(weekStr: string, delta: number): string {
  const monday = weekToMonday(weekStr);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return dateToWeekStr(monday);
}

const DIAS_ES = ["", "lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const DIAS_ES_FULL = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** "2026-04-14" → "Lunes 14 abr" */
function formatDayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const dow = d.getUTCDay() || 7;
  const dayNum = d.getUTCDate();
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${DIAS_ES_FULL[dow]} ${dayNum} ${months[d.getUTCMonth()]}`;
}

/** Range label: "14–18 abr 2026" */
function weekRangeLabel(weekStr: string): string {
  const monday = weekToMonday(weekStr);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const sameMonth = monday.getUTCMonth() === friday.getUTCMonth();
  if (sameMonth) {
    return `${monday.getUTCDate()}–${friday.getUTCDate()} ${months[monday.getUTCMonth()]} ${monday.getUTCFullYear()}`;
  }
  return `${monday.getUTCDate()} ${months[monday.getUTCMonth()]} – ${friday.getUTCDate()} ${months[friday.getUTCMonth()]} ${friday.getUTCFullYear()}`;
}

// ─── WhatsApp message builder ─────────────────────────────────────────────────

function buildWhatsApp(appt: RiskyAppt): string {
  const nivel = appt.riskLevel;
  const nombre = appt.patientName.split(" ")[0];
  const hora = appt.startDisplay;
  const tratamiento = appt.treatmentName;
  if (nivel === "HIGH") {
    return `Hola ${nombre}, queremos confirmar tu cita de ${tratamiento} el ${formatDayLabel(appt.dayIso)} a las ${hora}. Por favor responde este mensaje para confirmar o llámanos. ¡Te esperamos!`;
  }
  if (nivel === "MEDIUM") {
    return `Hola ${nombre}, te recordamos tu cita de ${tratamiento} el ${DIAS_ES[new Date(appt.dayIso + "T12:00:00Z").getUTCDay() || 7]} a las ${hora}. Responde "OK" para confirmar.`;
  }
  return `Hola ${nombre}, recordatorio de tu cita el ${DIAS_ES[new Date(appt.dayIso + "T12:00:00Z").getUTCDay() || 7]} a las ${hora} para ${tratamiento}.`;
}

function buildRecallWhatsApp(recall: RecallAlert): string {
  const nombre = recall.patientName.split(" ")[0];
  return `Hola ${nombre}, llevamos ${recall.weeksSinceLast} semanas desde tu última cita de ${recall.treatmentName}. ¿Te gustaría agendar tu próxima sesión? Puedes elegir tu horario respondiendo a este mensaje.`;
}

// ─── RecallCard ───────────────────────────────────────────────────────────────

function RecallCard({ recall }: { recall: RecallAlert }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-orange-50 border border-orange-200 rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{recall.patientName}</p>
        <p className="text-xs text-slate-500 truncate">{recall.treatmentName}</p>
        <p className="text-xs text-orange-700 font-medium mt-0.5">
          {recall.weeksSinceLast} semanas sin próxima cita
          {recall.clinica ? ` · ${recall.clinica}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {recall.patientPhone && (
          <a
            href={`https://wa.me/${recall.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildRecallWhatsApp(recall))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-xl bg-green-600 text-white text-xs hover:bg-green-700 transition-colors"
            title="WhatsApp"
          >
            WA
          </a>
        )}
        {recall.patientPhone && (
          <a
            href={`tel:${recall.patientPhone}`}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-600 text-xs hover:bg-slate-50 transition-colors"
            title="Llamar"
          >
            Tel
          </a>
        )}
      </div>
    </div>
  );
}

// ─── RiskCard ─────────────────────────────────────────────────────────────────

function RiskCard({
  appt,
  done,
  onDone,
}: {
  appt: RiskyAppt;
  done: boolean;
  onDone: (id: string) => void;
}) {
  const color = riskColor(appt.riskLevel);
  const label = riskLabel(appt.riskLevel);
  const bgClass = riskBgClass(appt.riskLevel);

  return (
    <div
      className={`border-l-4 pl-3 pr-2 py-2.5 rounded-r-xl bg-white border border-l-0 border-slate-100 transition-opacity ${
        done ? "opacity-40" : ""
      }`}
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-500 w-11 shrink-0">
              {appt.startDisplay}
            </span>
            <span className="text-sm font-semibold text-slate-800 truncate">
              {appt.patientName}
            </span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${bgClass}`}
            >
              {label} {appt.riskScore}
            </span>
            {!appt.confirmed && (
              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full font-semibold">
                Sin confirmar
              </span>
            )}
            {appt.actionUrgent && (
              <span className="text-[10px] text-red-700 font-bold">⏰</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 ml-[52px] leading-snug">
            {appt.treatmentName}
            {appt.riskFactors.dayTimeLabel ? ` · ${appt.riskFactors.dayTimeLabel}` : ""}
            {appt.riskFactors.historicalNoShowCount > 0
              ? ` · ${appt.riskFactors.historicalNoShowCount} no-show prev.`
              : ""}
          </p>
        </div>

        {/* Actions */}
        {!done && appt.riskLevel !== "LOW" && (
          <div className="flex items-center gap-1 shrink-0">
            {appt.patientPhone && (
              <a
                href={`https://wa.me/${appt.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsApp(appt))}`}
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
              title="Marcar hecho"
            >
              ✓
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DayGroup ─────────────────────────────────────────────────────────────────

function DayGroup({
  dayIso,
  appointments,
  done,
  onDone,
}: {
  dayIso: string;
  appointments: RiskyAppt[];
  done: Set<string>;
  onDone: (id: string) => void;
}) {
  const highCount = appointments.filter((a) => a.riskLevel === "HIGH" && !done.has(a.id)).length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">
          {formatDayLabel(dayIso)}
        </p>
        {highCount > 0 && (
          <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full font-bold">
            {highCount} alto
          </span>
        )}
      </div>
      <div className="space-y-1.5 pl-0">
        {appointments.map((appt) => (
          <RiskCard
            key={appt.id}
            appt={appt}
            done={done.has(appt.id)}
            onDone={onDone}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RiesgoView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const [week, setWeek] = useState<string>(getCurrentWeekStr);
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicaFilter, setClinicaFilter] = useState<string>("");
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

  function markDone(id: string) {
    const next = new Set(done);
    next.add(id);
    setDone(next);
    try { localStorage.setItem("fyllio_noshows_done", JSON.stringify([...next])); } catch { /* */ }
  }

  function goWeek(delta: number) {
    setWeek((w) => offsetWeek(w, delta));
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full max-w-2xl">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-xl" />
          ))}
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

  // Agrupar citas por dayIso (lun–vie)
  const byDay = new Map<string, RiskyAppt[]>();
  for (const appt of data.appointments) {
    if (!byDay.has(appt.dayIso)) byDay.set(appt.dayIso, []);
    byDay.get(appt.dayIso)!.push(appt);
  }
  // Ordenar por hora dentro de cada día
  for (const arr of byDay.values()) {
    arr.sort((a, b) => a.startDisplay.localeCompare(b.startDisplay));
  }
  // Ordenar días
  const sortedDays = [...byDay.keys()].sort();

  const clinicas = isManager
    ? [...new Set(data.appointments.map((a) => a.clinica).filter(Boolean) as string[])].sort()
    : [];

  const isCurrentWeek = week === getCurrentWeekStr();

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 max-w-2xl w-full mx-auto">
      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* Header */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        {/* Week navigation */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => goWeek(-1)}
            className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
            title="Semana anterior"
          >
            ←
          </button>
          <div className="text-center flex-1">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              SEMANA {data.week?.replace(/.*-W/, "")}
            </p>
            <p className="text-sm font-bold text-slate-900">{weekRangeLabel(week)}</p>
            {isCurrentWeek && (
              <p className="text-[10px] text-cyan-600 font-semibold">Semana actual</p>
            )}
          </div>
          <button
            onClick={() => goWeek(1)}
            className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
            title="Semana siguiente"
          >
            →
          </button>
        </div>

        {/* Summary chips */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Total",    value: data.summary.totalAppointments, color: "text-slate-700"  },
            { label: "Alto",     value: data.summary.highRisk,          color: "text-red-700"    },
            { label: "Medio",    value: data.summary.mediumRisk,        color: "text-amber-700"  },
            { label: "Recall",   value: data.summary.recallCount,       color: "text-orange-700" },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center py-2 rounded-xl bg-slate-50 border border-slate-100">
              <p className={`text-lg font-extrabold leading-none ${color}`}>{value}</p>
              <p className="text-[10px] text-slate-400 mt-1 leading-none">{label}</p>
            </div>
          ))}
        </div>

        {/* Clinic filter */}
        {isManager && clinicas.length > 0 && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinicaFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <option value="">Todas las clínicas</option>
            {clinicas.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* RECALL section */}
      {data.recalls.length > 0 && (
        <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🔔</span>
            <p className="text-sm font-bold text-orange-800">
              RECALL — {data.recalls.length} paciente{data.recalls.length !== 1 ? "s" : ""} sin próxima cita
            </p>
          </div>
          <div className="space-y-2">
            {data.recalls.map((recall) => (
              <RecallCard key={recall.patientPhone + recall.treatmentName} recall={recall} />
            ))}
          </div>
        </div>
      )}

      {/* Risk alert */}
      {data.summary.highRisk > 0 && (
        <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-800">
          <span className="font-bold">
            ⚠️ {data.summary.highRisk} cita{data.summary.highRisk !== 1 ? "s" : ""} de riesgo ALTO
          </span>
          {" "}— contacta antes de sus deadlines.
        </div>
      )}

      {/* Day groups */}
      {sortedDays.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400">Sin citas de riesgo esta semana</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedDays.map((dayIso) => (
            <div key={dayIso} className="rounded-2xl bg-white border border-slate-200 p-4">
              <DayGroup
                dayIso={dayIso}
                appointments={byDay.get(dayIso)!}
                done={done}
                onDone={markDone}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
