"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoShowsUserSession, RiskyAppt, RecallAlert, RiskData } from "../../lib/no-shows/types";
import { riskBgClass } from "../../lib/no-shows/score";

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
  futuras?: RiskyAppt[];
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
  return dateToWeekStr(new Date());
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
    <div className="flex items-center gap-3 py-2 px-3 bg-orange-50 border border-orange-200 rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{recall.patientName}</p>
        <p className="text-xs text-slate-500 truncate">{recall.treatmentName}</p>
        <p className="text-xs text-orange-700 font-medium mt-0.5">
          {recall.weeksSinceLast} sem. sin próxima cita
          {recall.clinica ? ` · ${recall.clinica}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {recall.patientPhone && (
          <a
            href={`https://wa.me/${recall.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildRecallWhatsApp(recall))}`}
            target="_blank" rel="noopener noreferrer"
            className="p-1.5 rounded-xl bg-green-600 text-white text-xs hover:bg-green-700 transition-colors"
          >WA</a>
        )}
        {recall.patientPhone && (
          <a
            href={`tel:${recall.patientPhone}`}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-600 text-xs hover:bg-slate-50 transition-colors"
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
    appt.riskLevel === "HIGH"   ? "border-red-200 bg-red-50" :
    appt.riskLevel === "MEDIUM" ? "border-amber-200 bg-amber-50" :
    "border-slate-200 bg-white";
  const scoreBadge =
    appt.riskLevel === "HIGH"   ? "bg-red-500 text-white" :
    appt.riskLevel === "MEDIUM" ? "bg-amber-500 text-white" :
    "bg-slate-200 text-slate-600";

  return (
    <div className={`rounded-xl border p-2.5 transition-opacity ${bgBorder} ${isLow ? "opacity-60" : ""} ${done ? "opacity-30" : ""}`}>
      <div className="flex items-start justify-between gap-1 mb-0.5">
        <p className="text-xs font-bold text-slate-800 leading-snug break-words min-w-0">
          {appt.patientName}
        </p>
        <span className={`shrink-0 text-[10px] font-bold rounded-full px-1.5 py-0.5 ml-1 ${scoreBadge}`}>
          {appt.riskScore}
        </span>
      </div>
      <p className="text-[10px] text-slate-500 truncate">{appt.treatmentName}</p>
      <p className="text-[10px] text-slate-400">
        {appt.startDisplay}
        {appt.actionUrgent ? " ⏰" : ""}
        {!appt.confirmed ? " · sin conf." : ""}
      </p>
      {(appt.riskFactors.dayTimeLabel || appt.riskFactors.historicalNoShowCount > 0) && (
        <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
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
              className="flex-1 text-center text-[10px] font-bold py-1 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors"
            >WA</a>
          )}
          {appt.patientPhone && (
            <a
              href={`tel:${appt.patientPhone}`}
              className="flex-1 text-center text-[10px] font-bold py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >Tel</a>
          )}
          <button
            onClick={() => onDone(appt.id)}
            className="flex-1 text-center text-[10px] font-bold py-1 rounded-lg bg-cyan-100 text-cyan-700 hover:bg-cyan-200 transition-colors"
          >✓</button>
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
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden h-full flex flex-col">
        {/* Column header */}
        <div className={`px-3 py-2.5 border-b ${hasRisk ? "border-red-100 bg-red-50" : "border-slate-100 bg-slate-50"}`}>
          <p className="text-xs font-bold text-slate-700">{formatShortDay(dayIso)}</p>
          <p className="text-[10px] text-slate-400">{formatShortDate(dayIso)}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] text-slate-500">{appts.length} cita{appts.length !== 1 ? "s" : ""}</span>
            {euros > 0 && (
              <span className="text-[10px] font-semibold text-amber-600">€{euros}</span>
            )}
          </div>
          {hasRisk && (
            <div className="flex gap-1.5 mt-1">
              {highCount > 0 && (
                <span className="text-[10px] font-bold text-red-600 bg-red-100 rounded-full px-1.5 py-0.5">
                  {highCount}A
                </span>
              )}
              {medCount > 0 && (
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 rounded-full px-1.5 py-0.5">
                  {medCount}M
                </span>
              )}
            </div>
          )}
        </div>

        {/* Cards */}
        <div className="p-2 space-y-2 flex-1">
          {sorted.length === 0 ? (
            <p className="text-[10px] text-slate-300 text-center py-4">Sin citas</p>
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
      url.searchParams.set("incluirFuturas", "1");
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
        <div className="animate-pulse space-y-3 w-full">
          <div className="h-20 bg-slate-100 rounded-2xl" />
          <div className="flex gap-3">
            {[1,2,3,4,5].map((i) => <div key={i} className="flex-1 h-48 bg-slate-100 rounded-2xl" />)}
          </div>
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

  const days = weekDayIsos(week);

  // Agrupar citas por dayIso
  const byDay = new Map<string, RiskyAppt[]>();
  for (const dayIso of days) byDay.set(dayIso, []);
  for (const appt of data.appointments) {
    const arr = byDay.get(appt.dayIso);
    if (arr) arr.push(appt);
  }

  const clinicasMap = isManager
    ? new Map(
        data.appointments
          .filter((a) => a.clinica && a.clinicaNombre)
          .map((a) => [a.clinica!, a.clinicaNombre!] as [string, string])
      )
    : new Map<string, string>();

  const isCurrentWeek = week === getCurrentWeekStr();

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">

      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* ── Header ── */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        {/* Navegación de semana */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => goWeek(-1)}
            className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
          >←</button>
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
          >→</button>
        </div>

        {/* 5 Summary cards */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: "Total",    value: data.summary.totalAppointments,        bg: "bg-slate-50 border-slate-200",   text: "text-slate-800"  },
            { label: "Alto",     value: data.summary.highRisk,                 bg: "bg-red-50 border-red-200",       text: "text-red-700"    },
            { label: "Medio",    value: data.summary.mediumRisk,               bg: "bg-amber-50 border-amber-200",   text: "text-amber-700"  },
            { label: "€ riesgo", value: `€${data.summary.eurosEnRiesgo ?? 0}`, bg: "bg-orange-50 border-orange-200", text: "text-orange-700" },
            { label: "Recall",   value: data.summary.recallCount,              bg: "bg-orange-50 border-orange-200", text: "text-orange-700" },
          ].map(({ label, value, bg, text }) => (
            <div key={label} className={`text-center py-2.5 rounded-xl border ${bg}`}>
              <p className={`text-2xl font-black leading-none ${text}`}>{value}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-none">{label}</p>
            </div>
          ))}
        </div>

        {/* Clinic filter */}
        {isManager && clinicasMap.size > 0 && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinicaFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <option value="">Todas las clínicas</option>
            {[...clinicasMap.entries()]
              .sort(([, a], [, b]) => a.localeCompare(b))
              .map(([id, nombre]) => (
                <option key={id} value={id}>{nombre}</option>
              ))}
          </select>
        )}
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

      {/* ── Próximas semanas (score ≥ 70) ── */}
      {data.futuras && data.futuras.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            Próximas semanas — score ≥ 70
          </p>
          <div className="space-y-2">
            {data.futuras.map((appt) => {
              const bg = riskBgClass(appt.riskLevel);
              return (
                <div
                  key={appt.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{appt.patientName}</p>
                    <p className="text-xs text-slate-500">
                      {appt.treatmentName} · {formatDayLabel(appt.dayIso)} {appt.startDisplay}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full border ${bg}`}>
                    {appt.riskScore}
                  </span>
                  {appt.patientPhone && (
                    <a
                      href={`https://wa.me/${appt.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsApp(appt))}`}
                      target="_blank" rel="noopener noreferrer"
                      className="p-1.5 rounded-xl bg-green-600 text-white text-xs hover:bg-green-700 transition-colors"
                    >WA</a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── RECALL (colapsable al fondo) ── */}
      {data.recalls.length > 0 && (
        <details className="rounded-2xl bg-white border border-orange-200 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 flex items-center justify-between select-none list-none">
            <div className="flex items-center gap-2">
              <span className="text-sm">🔔</span>
              <p className="text-sm font-semibold text-orange-800">
                Pacientes en tratamiento activo sin próxima cita
              </p>
              <span className="text-xs text-orange-600 font-bold bg-orange-100 rounded-full px-1.5 py-0.5">
                {data.recalls.length}
              </span>
            </div>
            <span className="text-xs text-slate-400">Ver ▾</span>
          </summary>
          <div className="border-t border-orange-100 p-4 space-y-2">
            {data.recalls.map((recall) => (
              <RecallCard key={recall.patientPhone + recall.treatmentName} recall={recall} />
            ))}
          </div>
        </details>
      )}

    </div>
  );
}
