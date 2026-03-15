"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";

const ZONE = "Europe/Madrid";

type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

type RiskFactors = {
  historicalNoShowRate: number;
  historicalNoShowCount: number;
  historicalCancelCount: number;
  historicalTotalAppts: number;
  daysSinceBooked: number;
  dayOfWeek: number;
  hourOfDay: number;
  treatmentRisk: "HIGH" | "MEDIUM" | "LOW";
  dayTimeLabel: string;
};

type RiskyAppt = {
  id: string;       // Airtable recordId
  patientName: string;
  patientPhone: string;
  start: string;
  end: string;
  treatmentName: string;
  dayIso: string;
  riskScore: number;
  riskLevel: RiskLevel;
  actionDeadline?: string;
  actionUrgent?: boolean;
  riskFactors: RiskFactors;
  actions: string[]; // kept for API compat
};

type RiskData = {
  staffId: string;
  week: string;
  appointments: RiskyAppt[];
  summary: {
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    totalAppointments: number;
  };
};

function formatHHMM(iso: string) {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return "—";
  return `${m[1]}:${m[2]}`;
}

function dayLabel(dayIso: string) {
  return DateTime.fromISO(dayIso, { zone: ZONE })
    .setLocale("es")
    .toFormat("EEEE d 'de' MMMM");
}

function riskConfig(level: RiskLevel) {
  if (level === "HIGH") return {
    icon: "🔴", label: "ALTO RIESGO",
    bgClass: "bg-rose-50 border-rose-200",
    badgeClass: "bg-rose-100 text-rose-700 border-rose-200",
    barClass: "bg-rose-500", scoreClass: "text-rose-700",
  };
  if (level === "MEDIUM") return {
    icon: "🟡", label: "RIESGO MEDIO",
    bgClass: "bg-amber-50 border-amber-200",
    badgeClass: "bg-amber-100 text-amber-700 border-amber-200",
    barClass: "bg-amber-400", scoreClass: "text-amber-700",
  };
  return {
    icon: "🟢", label: "BAJO RIESGO",
    bgClass: "bg-emerald-50/60 border-emerald-100",
    badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-100",
    barClass: "bg-emerald-400", scoreClass: "text-emerald-700",
  };
}

function deadlineLabel(deadlineIso: string, urgent: boolean): string {
  const dt = DateTime.fromISO(deadlineIso, { zone: ZONE });
  if (!dt.isValid) return "";
  const now = DateTime.now().setZone(ZONE);
  const hoursUntil = dt.diff(now, "hours").hours;

  if (hoursUntil < 0) {
    return `⚠️ Deadline pasado (era el ${dt.setLocale("es").toFormat("EEEE 'a las' HH:mm")})`;
  }
  const dayStr = dt.toISODate() === now.toISODate()
    ? `hoy a las ${dt.toFormat("HH:mm")}`
    : dt.toISODate() === now.minus({ days: -1 }).toISODate()
      ? `mañana a las ${dt.toFormat("HH:mm")}`
      : dt.setLocale("es").toFormat("EEEE d/M 'a las' HH:mm");

  if (urgent) return `⏰ Actuar antes de: ${dayStr}`;
  return `Actuar antes de: ${dayStr}`;
}

// ── Shared done state — same localStorage key as OperationsPanel ──────────────
// Key format: "noshow-{airtableRecordId}"

function readDoneIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem("fyllio_ops_completed");
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch { return new Set(); }
}

function writeDoneId(id: string) {
  try {
    const existing = readDoneIds();
    existing.add(id);
    localStorage.setItem("fyllio_ops_completed", JSON.stringify([...existing]));
  } catch {}
}

// ── Risk appointment card ─────────────────────────────────────────────────────

function RiskCard({
  appt, doneIds, onMarkDone,
}: {
  appt: RiskyAppt;
  doneIds: Set<string>;
  onMarkDone: (id: string) => void;
}) {
  const doneKey = `noshow-${appt.id}`;
  const [extra72h, setExtra72h] = useState(false);
  const [waSendStatus, setWaSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (doneIds.has(doneKey)) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center gap-3 opacity-40">
        <span className="text-emerald-500 font-bold text-sm">✓</span>
        <span className="text-sm text-slate-400 line-through">{appt.patientName}</span>
        <span className="text-xs text-slate-300">{formatHHMM(appt.start)} · gestionado</span>
      </div>
    );
  }

  const cfg = riskConfig(appt.riskLevel);
  const f = appt.riskFactors;

  const waMsg = appt.riskLevel === "HIGH"
    ? `Hola ${appt.patientName} 🙏 Tu cita del ${formatHHMM(appt.start)} aún no está confirmada. ¿Puedes confirmarnos que asistirás? Responde *SÍ* o escríbenos si necesitas cambiarla.`
    : `Hola ${appt.patientName} 🙂 Te recordamos tu cita del ${formatHHMM(appt.start)}${appt.treatmentName ? ` (${appt.treatmentName})` : ""}. ¿Confirmas asistencia? Responde *SÍ* o escríbenos si necesitas cambiarla.`;

  async function handleSendWA() {
    if (!appt.patientPhone) return;
    if (!confirm(`Enviar WhatsApp a ${appt.patientName}?\n\n"${waMsg}"`)) return;
    setWaSendStatus("sending");
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: appt.patientPhone, message: waMsg }),
      });
      if (!res.ok) throw new Error();
      setWaSendStatus("sent");
    } catch { setWaSendStatus("error"); }
  }

  function handleMarkDone() {
    writeDoneId(doneKey);
    onMarkDone(appt.id);
  }

  return (
    <div className={`rounded-2xl border ${cfg.bgClass} p-5`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11px] font-bold rounded-full border px-2.5 py-0.5 ${cfg.badgeClass}`}>
              {cfg.icon} {cfg.label}
            </span>
          </div>
          <p className="mt-1.5 font-semibold text-slate-900 text-base">{appt.patientName}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {formatHHMM(appt.start)} – {formatHHMM(appt.end)} · {appt.treatmentName}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-3xl font-extrabold ${cfg.scoreClass}`}>{appt.riskScore}</p>
          <p className="text-[11px] text-slate-400">/ 100</p>
        </div>
      </div>

      {/* Risk bar */}
      <div className="mt-3 h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div className={`h-full rounded-full ${cfg.barClass} transition-all`} style={{ width: `${appt.riskScore}%` }} />
      </div>

      {/* Deadline badge */}
      {appt.actionDeadline && appt.riskLevel !== "LOW" && (
        <div className={[
          "mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border",
          appt.actionUrgent ? "bg-red-100 border-red-300 text-red-700" : "bg-slate-100 border-slate-200 text-slate-600",
        ].join(" ")}>
          {deadlineLabel(appt.actionDeadline, !!appt.actionUrgent)}
        </div>
      )}

      {/* Risk factors — positive for LOW, warning for HIGH/MEDIUM */}
      <div className="mt-3 space-y-1">
        {appt.riskLevel === "LOW" ? (
          <>
            {f.historicalTotalAppts >= 3 && (
              <p className="text-xs text-emerald-700">
                ✓ Buen historial —{" "}
                {f.historicalNoShowCount === 0
                  ? `${f.historicalTotalAppts} citas sin ausencias`
                  : `solo ${f.historicalNoShowCount} ausencia(s) en ${f.historicalTotalAppts} citas`}
                {(f.historicalCancelCount ?? 0) > 0
                  ? ` · ${f.historicalCancelCount} cancelación${f.historicalCancelCount !== 1 ? "es" : ""}`
                  : ""}
              </p>
            )}
            {f.historicalTotalAppts > 0 && f.historicalTotalAppts < 3 && (
              <p className="text-xs text-emerald-700">
                ✓ Historial limpio ({f.historicalTotalAppts} {f.historicalTotalAppts === 1 ? "cita" : "citas"} sin ausencias)
              </p>
            )}
            {f.historicalTotalAppts === 0 && f.treatmentRisk === "LOW" && (
              <p className="text-xs text-emerald-700">✓ Tratamiento de alta implicación — baja tasa de fuga</p>
            )}
            {f.historicalTotalAppts === 0 && f.treatmentRisk !== "LOW" && (
              <p className="text-xs text-slate-500">Sin historial previo — riesgo bajo por horario y tipo de cita</p>
            )}
          </>
        ) : (
          <>
            {f.historicalTotalAppts > 0 && (
              <p className="text-xs text-slate-600">
                ⚠{" "}
                {f.historicalNoShowCount > 0
                  ? <><b>{f.historicalNoShowCount}</b> no-show{f.historicalNoShowCount !== 1 ? "s" : ""}</>
                  : <>0 no-shows</>}
                {(f.historicalCancelCount ?? 0) > 0 && (
                  <> + <b>{f.historicalCancelCount}</b> cancelación{f.historicalCancelCount !== 1 ? "es" : ""}</>
                )}
                {" "}en <b>{f.historicalTotalAppts}</b> citas anteriores
                {f.historicalNoShowCount > 0 && ` (${Math.round(f.historicalNoShowRate * 100)}% no-shows)`}
              </p>
            )}
            {f.historicalTotalAppts === 0 && (
              <p className="text-xs text-slate-500">Sin historial previo</p>
            )}
            {f.daysSinceBooked > 7 && (
              <p className="text-xs text-slate-600">⚠ Reservado hace <b>{f.daysSinceBooked}</b> días</p>
            )}
            {f.dayTimeLabel && (
              <p className="text-xs text-slate-600">⚠ {f.dayTimeLabel}</p>
            )}
            {f.treatmentRisk === "HIGH" && (
              <p className="text-xs text-slate-600">⚠ {appt.treatmentName} — tratamiento de alta tasa de fuga</p>
            )}
          </>
        )}
      </div>

      {/* ── Actions — concordant with OperationsPanel ── */}
      <div className="mt-4 space-y-3">

        {/* Auto-reminders (informational, same as OperationsPanel) */}
        <div className="rounded-xl bg-white/60 border border-black/5 p-3 space-y-1.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            Recordatorios automáticos — Fyllio
          </p>
          <p className="text-xs text-slate-500">📱 48h antes — programado</p>
          <p className="text-xs text-slate-500">📱 24h antes — programado</p>
          {appt.riskLevel === "HIGH" && (
            <button
              onClick={() => setExtra72h((v) => !v)}
              className="text-xs text-sky-600 hover:text-sky-700 font-medium underline underline-offset-2"
            >
              {extra72h ? "📱 72h antes — añadido ✓" : "+ Añadir recordatorio 72h (mayor insistencia)"}
            </button>
          )}
        </div>

        {/* Manual action (same as OperationsPanel) */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            {appt.riskLevel === "LOW" ? "Sugerencia" : "Acción manual recomendada"}
          </p>

          {appt.patientPhone && (
            <a
              href={`tel:${appt.patientPhone}`}
              className={[
                "flex items-center justify-center gap-2 text-xs px-3 py-2.5 rounded-xl font-semibold w-full",
                appt.riskLevel === "LOW"
                  ? "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  : "bg-rose-600 text-white hover:bg-rose-700",
              ].join(" ")}
            >
              📞 {appt.riskLevel === "LOW" ? "Llamar si se quiere confirmar" : "Llamar personalmente — confirmar asistencia"}
            </a>
          )}

          {/* WA as secondary — only for HIGH/MEDIUM */}
          {appt.patientPhone && appt.riskLevel !== "LOW" && (
            waSendStatus === "sent" ? (
              <span className="inline-flex text-xs text-emerald-600 font-semibold px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">✓ WhatsApp enviado</span>
            ) : waSendStatus === "error" ? (
              <span className="inline-flex text-xs text-red-500 font-semibold px-3 py-1.5 rounded-full bg-red-50 border border-red-200">Error al enviar</span>
            ) : (
              <button
                onClick={handleSendWA}
                disabled={waSendStatus === "sending"}
                className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                {waSendStatus === "sending" ? "Enviando..." : "💬 Enviar recordatorio WA ahora"}
              </button>
            )
          )}
        </div>

        {/* Mark as managed — synced with OperationsPanel via localStorage */}
        <div className="pt-1 border-t border-black/5">
          <button
            onClick={handleMarkDone}
            className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-500 font-medium hover:bg-slate-50 hover:text-slate-700"
          >
            ✓ Gestionado — no mostrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function NoShowRiskPanel({
  staffId,
  onGoToActions,
}: {
  staffId?: string;
  onGoToActions?: () => void;
}) {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [doneIds, setDoneIds] = useState<Set<string>>(readDoneIds);

  async function load() {
    setLoading(true);
    try {
      const url = `/api/dashboard/noshow-risk${staffId ? `?staffId=${staffId}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      setData(json);
      // Re-read in case OperationsPanel updated localStorage
      setDoneIds(readDoneIds());
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [staffId]);

  function handleMarkDone(apptId: string) {
    setDoneIds((prev) => new Set(prev).add(`noshow-${apptId}`));
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 rounded-3xl bg-slate-100" />
        <div className="h-48 rounded-3xl bg-slate-100" />
        <div className="h-32 rounded-3xl bg-slate-100" />
      </div>
    );
  }

  if (!data || !data.appointments) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-500 text-sm">
        No se pudieron cargar los datos de riesgo.
      </div>
    );
  }

  const { appointments, summary } = data;
  const visible = appointments.filter((a) => !doneIds.has(`noshow-${a.id}`));

  const byDay = new Map<string, RiskyAppt[]>();
  for (const a of visible) {
    if (!byDay.has(a.dayIso)) byDay.set(a.dayIso, []);
    byDay.get(a.dayIso)!.push(a);
  }
  const days = Array.from(byDay.keys()).sort();

  const weekLabel = data.week
    ? DateTime.fromISO(data.week, { zone: ZONE }).setLocale("es").toFormat("d 'de' MMMM")
    : "";

  const visibleHigh   = visible.filter((a) => a.riskLevel === "HIGH").length;
  const visibleMedium = visible.filter((a) => a.riskLevel === "MEDIUM").length;
  const visibleLow    = visible.filter((a) => a.riskLevel === "LOW").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-3xl bg-gradient-to-br from-rose-700 to-orange-700 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-rose-200 uppercase tracking-widest">
              Riesgo de No-show · {weekLabel}
            </p>
            <h2 className="mt-1 text-3xl font-extrabold">
              {visibleHigh + visibleMedium} pacientes en riesgo
            </h2>
            <p className="text-sm text-rose-100 mt-0.5">de {visible.length} citas esta semana</p>
          </div>
          <button type="button" onClick={load}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 border border-white/25 text-white hover:bg-white/30 shrink-0">
            Refrescar
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            { label: "🔴 Alto riesgo",   count: visibleHigh,   textCls: "text-rose-200",    valCls: "text-rose-300" },
            { label: "🟡 Riesgo medio",  count: visibleMedium, textCls: "text-amber-200",   valCls: "text-amber-300" },
            { label: "🟢 Bajo riesgo",   count: visibleLow,    textCls: "text-emerald-200", valCls: "text-emerald-300" },
          ].map(({ label, count, textCls, valCls }) => (
            <div key={label} className="rounded-2xl bg-white/15 border border-white/20 p-3 text-center">
              <p className={`text-xs font-medium ${textCls}`}>{label}</p>
              <p className="text-2xl font-extrabold mt-0.5">{count}</p>
              <p className={`text-[11px] mt-0.5 ${valCls}`}>citas</p>
            </div>
          ))}
        </div>
      </div>

      {visible.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-500 text-sm">
          No hay citas pendientes para esta semana.
        </div>
      )}

      {days.map((dayIso) => {
        const dayAppts = byDay.get(dayIso)!;
        return (
          <div key={dayIso} className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest capitalize px-1">
              {dayLabel(dayIso)}
            </p>
            {dayAppts.map((appt) => (
              <RiskCard key={appt.id} appt={appt} doneIds={doneIds} onMarkDone={handleMarkDone} />
            ))}
          </div>
        );
      })}

      {onGoToActions && visible.some((a) => a.riskLevel !== "LOW") && (
        <button
          type="button"
          onClick={onGoToActions}
          className="w-full flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 hover:bg-rose-100 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">⚡</span>
            <div>
              <p className="text-sm font-bold text-rose-900">Ir a Acciones</p>
              <p className="text-xs text-rose-600">Gestionar no-shows urgentes</p>
            </div>
          </div>
          <span className="text-rose-400 text-sm shrink-0">→</span>
        </button>
      )}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
        <span className="text-slate-400 text-lg shrink-0">💡</span>
        <div>
          <p className="text-sm font-semibold text-slate-700">¿Cómo se calcula el riesgo?</p>
          <p className="text-xs text-slate-500 mt-1">
            El score (0–100) combina 4 factores: historial de no-shows del paciente (40%),
            tiempo desde la reserva (25%), día y hora de la cita (20%) y tipo de tratamiento (15%).
            Los recordatorios automáticos de Fyllio reducen el riesgo en todos los niveles.
          </p>
        </div>
      </div>
    </div>
  );
}
