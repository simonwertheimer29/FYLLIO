"use client";

import { useEffect, useState } from "react";

type NoShowRisk = "HIGH" | "MED" | "LOW";

const RISK_CONFIG: Record<NoShowRisk, { label: string; dot: string; badge: string }> = {
  HIGH: { label: "Riesgo alto",  dot: "bg-rose-500",   badge: "text-rose-700 bg-rose-50 border-rose-200" },
  MED:  { label: "Riesgo medio", dot: "bg-amber-400",  badge: "text-amber-700 bg-amber-50 border-amber-200" },
  LOW:  { label: "Riesgo bajo",  dot: "bg-emerald-400", badge: "text-emerald-600 bg-emerald-50 border-emerald-200" },
};

type Appt = {
  recordId: string;
  patientName: string;
  phone: string;
  treatmentName: string;
  start: string;
  end: string;
  startIso: string;
  durationMin: number;
  confirmed: boolean;
  isBlock: boolean;
  noShowRisk: NoShowRisk;
};

type Gap = {
  start: string;
  end: string;
  startIso: string;
  durationMin: number;
  potentialRevenue: number;
};

type TodayData = {
  todayIso: string;
  todayLabel: string;
  staffId: string;
  staffName: string;
  appointments: Appt[];
  confirmedRevenue: number;
  atRiskRevenue: number;
  gapRevenue: number;
  unconfirmedCount: number;
  gaps: Gap[];
  workStart: string;
  workEnd: string;
};

type SendStatus = "idle" | "sending" | "sent" | "error";

function ReminderButton({
  appt,
  staffName,
  variant = "default",
}: {
  appt: Appt;
  staffName?: string;
  variant?: "default" | "urgent" | "compact";
}) {
  const [status, setStatus] = useState<SendStatus>("idle");

  async function handleSend() {
    if (!appt.phone) return;

    let message: string;
    if (appt.noShowRisk === "HIGH") {
      message =
        `Hola ${appt.patientName} 🙏 Te escribimos porque tu cita de hoy a las ${appt.start}` +
        (staffName ? ` con ${staffName}` : "") +
        (appt.treatmentName ? ` (${appt.treatmentName})` : "") +
        ` aún no está confirmada. ¿Puedes confirmarnos que asistirás? Responde *SÍ* para confirmar o escríbenos si necesitas cambiarla. ¡Gracias!`;
    } else if (appt.noShowRisk === "MED") {
      message =
        `Hola ${appt.patientName} 🙂 Te recordamos tu cita` +
        (staffName ? ` con ${staffName}` : "") +
        ` de hoy a las ${appt.start}` +
        (appt.treatmentName ? ` — ${appt.treatmentName}` : "") +
        `. ¿Confirmas que vendrás? Responde *SÍ* o escríbenos si necesitas cambiarla. ¡Hasta luego!`;
    } else {
      message =
        `Hola ${appt.patientName} 🙂 Te recordamos tu cita de hoy a las ${appt.start}` +
        (staffName ? ` con ${staffName}` : "") +
        (appt.treatmentName ? ` (${appt.treatmentName})` : "") +
        `. Por favor confirma respondiendo *SÍ* o escríbenos si necesitas cambiarla. ¡Hasta luego!`;
    }

    if (!confirm(`Enviar WhatsApp a ${appt.patientName}?\n\n"${message}"`)) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: appt.phone, message }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (!appt.phone) return null;

  if (status === "sent") {
    return (
      <span className="text-xs text-emerald-600 font-semibold px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 shrink-0">
        ✓ Enviado
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-xs text-red-500 font-semibold px-2 py-1 rounded-full bg-red-50 border border-red-200 shrink-0">
        Error
      </span>
    );
  }

  const btnLabel = status === "sending"
    ? "Enviando..."
    : variant === "compact"
    ? "💬"
    : appt.noShowRisk === "HIGH"
    ? "⚠️ Recordar ahora"
    : "💬 Recordatorio";

  const btnClass =
    variant === "compact"
      ? "text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 disabled:opacity-50 shrink-0"
      : appt.noShowRisk === "HIGH"
      ? "text-xs px-3 py-1.5 rounded-full bg-rose-600 text-white font-semibold hover:bg-rose-700 disabled:opacity-50 shrink-0"
      : "text-xs px-3 py-1.5 rounded-full bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 shrink-0";

  return (
    <button
      type="button"
      onClick={handleSend}
      disabled={status === "sending"}
      className={btnClass}
    >
      {btnLabel}
    </button>
  );
}

export default function TodayBriefing({
  staffId,
  onGoToActions,
}: {
  staffId: string;
  onGoToActions?: () => void;
}) {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!staffId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/db/today?staffId=${staffId}`, { cache: "no-store" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setError(e.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-32 rounded-3xl bg-slate-100" />
        <div className="h-48 rounded-3xl bg-slate-100" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        {error ?? "No se pudo cargar el resumen de hoy"}
      </div>
    );
  }

  const unconfirmed = data.appointments
    .filter((a) => !a.confirmed && !a.isBlock)
    .sort((a, b) => {
      const order: Record<NoShowRisk, number> = { HIGH: 0, MED: 1, LOW: 2 };
      return order[a.noShowRisk] - order[b.noShowRisk];
    });
  const confirmed = data.appointments.filter((a) => a.confirmed && !a.isBlock);
  const blocks = data.appointments.filter((a) => a.isBlock);
  const highRiskConfirmed = confirmed.filter((a) => a.noShowRisk === "HIGH");
  const medRiskConfirmed = confirmed.filter((a) => a.noShowRisk === "MED");
  const totalRevenue = data.confirmedRevenue + data.atRiskRevenue;
  const fillRate = totalRevenue > 0
    ? Math.round((data.confirmedRevenue / totalRevenue) * 100)
    : 100;

  return (
    <div className="space-y-4">

      {/* ── Hero header ─────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-sky-600 to-blue-700 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-sky-200 uppercase tracking-widest">Resumen del día</p>
            <h2 className="mt-1 text-2xl font-extrabold capitalize">{data.todayLabel}</h2>
            <p className="text-sm text-sky-100 mt-0.5">{data.staffName}</p>
          </div>
          <button
            type="button"
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 border border-white/25 text-white hover:bg-white/30 shrink-0"
          >
            Refrescar
          </button>
        </div>

        {/* Revenue summary */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-sky-200 font-medium">Ingresos confirmados</p>
            <p className="text-xl font-extrabold mt-0.5">€{data.confirmedRevenue}</p>
            <p className="text-[11px] text-sky-200 mt-0.5">{confirmed.length} citas</p>
          </div>
          <div className={`rounded-2xl border p-3 ${data.atRiskRevenue > 0 ? "bg-amber-400/20 border-amber-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-xs text-sky-200 font-medium">En riesgo</p>
            <p className={`text-xl font-extrabold mt-0.5 ${data.atRiskRevenue > 0 ? "text-amber-200" : ""}`}>
              €{data.atRiskRevenue}
            </p>
            <p className="text-[11px] text-sky-200 mt-0.5">{unconfirmed.length} sin confirmar</p>
          </div>
          <div className={`rounded-2xl border p-3 ${data.gaps.length > 0 ? "bg-red-400/20 border-red-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-xs text-sky-200 font-medium">Franjas disponibles</p>
            <p className={`text-xl font-extrabold mt-0.5 ${data.gaps.length > 0 ? "text-red-200" : ""}`}>
              €{data.gapRevenue}
            </p>
            <p className="text-[11px] text-sky-200 mt-0.5">{data.gaps.length} {data.gaps.length === 1 ? "franja" : "franjas"}</p>
          </div>
        </div>

        {/* Risk summary bar */}
        {(highRiskConfirmed.length > 0 || medRiskConfirmed.length > 0 || unconfirmed.length > 0) && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-sky-300 font-medium">Alertas:</span>
            {unconfirmed.filter(a => a.noShowRisk === "HIGH").length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-500/30 border border-rose-400/40 text-rose-200">
                🔴 {unconfirmed.filter(a => a.noShowRisk === "HIGH").length} sin confirmar · riesgo alto
              </span>
            )}
            {highRiskConfirmed.length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-400/30 text-rose-200">
                ⚠️ {highRiskConfirmed.length} confirmadas con riesgo alto
              </span>
            )}
            {data.gaps.length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/15 border border-white/20 text-sky-200">
                🕳 {data.gaps.length} {data.gaps.length === 1 ? "hueco" : "huecos"} libres
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Unconfirmed appointments ─────────────────────────────────── */}
      {unconfirmed.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200 flex items-center gap-2">
            <span className="text-amber-600 font-bold text-base">⚠️</span>
            <p className="text-sm font-semibold text-amber-800">
              {unconfirmed.length} {unconfirmed.length === 1 ? "cita sin confirmar" : "citas sin confirmar"} — actúa ahora
            </p>
          </div>
          <div className="divide-y divide-amber-100">
            {unconfirmed.map((appt) => {
              const risk = RISK_CONFIG[appt.noShowRisk];
              return (
                <div key={appt.recordId} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${risk.dot}`} />
                      <span className="text-sm font-semibold text-slate-900">{appt.patientName}</span>
                      {appt.treatmentName && (
                        <span className="text-xs text-slate-500">{appt.treatmentName}</span>
                      )}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${risk.badge}`}>
                        {risk.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {appt.start} – {appt.end} · {appt.durationMin} min
                      <span className="ml-2 text-amber-700 font-medium">~€{appt.durationMin} en riesgo</span>
                    </p>
                  </div>
                  <ReminderButton appt={appt} staffName={data.staffName} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── High-risk confirmed: actionable rows ────────────────────── */}
      {highRiskConfirmed.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-rose-200 flex items-center gap-2">
            <span className="text-rose-500 shrink-0">🔴</span>
            <p className="text-sm font-semibold text-rose-800">
              {highRiskConfirmed.length} {highRiskConfirmed.length === 1 ? "cita confirmada" : "citas confirmadas"} con riesgo alto de no-show
            </p>
          </div>
          <div className="divide-y divide-rose-100">
            {highRiskConfirmed.map((appt) => (
              <div key={appt.recordId} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{appt.patientName}</p>
                  <p className="text-xs text-rose-600 mt-0.5">
                    {appt.start} · {appt.treatmentName || "Cita"} · confirmó pero historial sugiere riesgo
                  </p>
                </div>
                <ReminderButton appt={appt} staffName={data.staffName} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Free gaps ────────────────────────────────────────────────── */}
      {data.gaps.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-base">🕳</span>
              <p className="text-sm font-semibold text-slate-800">
                {data.gaps.length} {data.gaps.length === 1 ? "franja disponible" : "franjas disponibles"} hoy
              </p>
              <span className="text-xs text-slate-500">
                · €{data.gapRevenue} potencial sin cubrir
              </span>
            </div>
            {onGoToActions && (
              <button
                type="button"
                onClick={onGoToActions}
                className="text-xs px-3 py-1.5 rounded-full bg-slate-900 text-white font-semibold hover:bg-slate-800 shrink-0"
              >
                Ver candidatos →
              </button>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {data.gaps.map((gap) => (
              <div key={gap.startIso} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {gap.start} – {gap.end}
                      <span className="ml-2 text-xs text-slate-500">{gap.durationMin} min</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full shrink-0">
                    +€{gap.potentialRevenue}
                  </span>
                  {onGoToActions && (
                    <button
                      type="button"
                      onClick={onGoToActions}
                      className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 shrink-0"
                    >
                      Candidatos →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── All good banner ──────────────────────────────────────────── */}
      {unconfirmed.length === 0 && highRiskConfirmed.length === 0 && data.gaps.length === 0 && data.appointments.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="text-sm font-semibold text-emerald-800">Todo bajo control</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              {data.appointments.length} citas · €{data.confirmedRevenue} asegurados · Sin alertas pendientes
            </p>
          </div>
        </div>
      )}

      {/* ── Confirmed appointments (compact list with risk for all) ─── */}
      {confirmed.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              ✅ {confirmed.length} citas confirmadas
            </p>
            <span className="text-xs text-slate-400">Score de riesgo activo</span>
          </div>
          <div className="divide-y divide-slate-100">
            {confirmed.map((appt) => {
              const risk = RISK_CONFIG[appt.noShowRisk];
              return (
                <div key={appt.recordId} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${risk.dot}`} />
                  <span className="text-xs text-slate-500 w-16 shrink-0">{appt.start}</span>
                  <span className="text-sm font-medium text-slate-800 min-w-0 flex-1 truncate">{appt.patientName}</span>
                  {appt.treatmentName && (
                    <span className="text-xs text-slate-400 min-w-0 truncate hidden sm:block">{appt.treatmentName}</span>
                  )}
                  {/* Risk badge: always visible for all risk levels */}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${risk.badge}`}>
                    {risk.label}
                  </span>
                  {/* CTA for HIGH/MED confirmed appointments */}
                  {appt.noShowRisk !== "LOW" && !appt.isBlock && (
                    <ReminderButton appt={appt} staffName={data.staffName} variant="compact" />
                  )}
                  <span className="text-xs text-slate-400 shrink-0">{appt.durationMin} min</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Internal blocks (compact) ───────────────────────────────── */}
      {blocks.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Bloques internos · {blocks.length}
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {blocks.map((appt) => (
              <div key={appt.recordId} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-xs text-slate-400 w-16 shrink-0">{appt.start}</span>
                <span className="text-xs text-slate-600">{appt.patientName}</span>
                <span className="text-xs text-slate-400 ml-auto shrink-0">{appt.durationMin} min</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {data.appointments.length === 0 && data.gaps.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-slate-500 text-sm">No hay citas programadas para hoy.</p>
        </div>
      )}
    </div>
  );
}
