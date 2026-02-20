"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";

type Candidate = {
  type: "WAITLIST" | "RECALL";
  patientName: string;
  phone: string;
  label: string;
  waitingLabel: string;
  priorityBadge?: string;
  waitlistRecordId?: string;
};

type Gap = {
  dayIso: string;
  dayLabel: string;
  start: string;
  end: string;
  startIso: string;
  durationMin: number;
  candidates: Candidate[];
};

type Data = {
  gaps: Gap[];
  totalFreeMin: number;
  estimatedRevenueImpact: number;
  recallTotal: number;
  waitlistTotal: number;
};

// State per (phone + startIso): "idle" | "sending" | "sent" | "error"
type SendStatus = "idle" | "sending" | "sent" | "error";

function buildMessage(
  candidate: Candidate,
  gap: Gap,
  staffName: string
): string {
  const dt = DateTime.fromISO(gap.startIso, { setZone: true }).setZone("Europe/Madrid");
  const dayStr = dt.setLocale("es").toFormat("EEEE d 'de' MMMM");
  const timeStr = gap.start;
  const dur = gap.durationMin;

  if (candidate.type === "WAITLIST") {
    return (
      `Hola ${candidate.patientName} 🙂 Buenas noticias! ` +
      `Se ha liberado un hueco el ${dayStr} a las ${timeStr} (${dur} min) ` +
      `para tu ${candidate.label}. ` +
      `¿Lo reservamos? Responde *SÍ* para confirmar o *NO* si no puedes.`
    );
  } else {
    return (
      `Hola ${candidate.patientName} 🙂 Desde la clínica queremos saber cómo estás ` +
      `y recordarte que tienes una revisión pendiente de ${candidate.label}. ` +
      `Tenemos un hueco el ${dayStr} a las ${timeStr} (${dur} min). ` +
      `¿Te viene bien? Responde *SÍ* para confirmar.`
    );
  }
}

function CandidateRow({
  candidate,
  gap,
  staffName,
}: {
  candidate: Candidate;
  gap: Gap;
  staffName: string;
}) {
  const [status, setStatus] = useState<SendStatus>("idle");
  const [showMsg, setShowMsg] = useState(false);
  const message = buildMessage(candidate, gap, staffName);

  async function handleSend() {
    if (!confirm(`Enviar WhatsApp a ${candidate.patientName}?\n\n"${message}"`)) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: candidate.phone, message }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("sent");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  const isWaitlist = candidate.type === "WAITLIST";

  return (
    <div className="flex items-start justify-between gap-3 py-2 border-t border-slate-100 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${
              isWaitlist
                ? "bg-sky-50 text-sky-700 border border-sky-200"
                : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}
          >
            {isWaitlist ? "Lista espera" : "Recall"}
          </span>
          {candidate.priorityBadge && (
            <span className="text-sm">{candidate.priorityBadge}</span>
          )}
          <span className="text-sm font-semibold text-slate-900">{candidate.patientName}</span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {candidate.label} · {candidate.waitingLabel}
        </p>
        {showMsg && (
          <p className="text-xs text-slate-400 mt-1 italic leading-relaxed border-l-2 border-slate-200 pl-2">
            "{message}"
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => setShowMsg((v) => !v)}
          className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100"
          title="Ver mensaje"
        >
          👁
        </button>

        {status === "sent" ? (
          <span className="text-xs text-emerald-600 font-semibold px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200">
            ✓ Enviado
          </span>
        ) : status === "error" ? (
          <span className="text-xs text-red-600 font-semibold px-2 py-1 rounded-full bg-red-50 border border-red-200">
            Error
          </span>
        ) : (
          <button
            onClick={handleSend}
            disabled={status === "sending"}
            className="text-xs px-3 py-1.5 rounded-full bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {status === "sending" ? "Enviando..." : "💬 Enviar"}
          </button>
        )}
      </div>
    </div>
  );
}

function GapCard({
  gap,
  index,
  staffName,
}: {
  gap: Gap;
  index: number;
  staffName: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const isPast = DateTime.fromISO(gap.startIso, { setZone: true })
    .setZone("Europe/Madrid")
    .diffNow("minutes").minutes < 0;

  return (
    <div
      className={`rounded-2xl border bg-white p-4 space-y-3 ${
        isPast ? "border-slate-200 opacity-60" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              #{index}
            </span>
            <span className="text-sm font-semibold text-slate-900">
              {gap.start} – {gap.end}
            </span>
            <span className="text-xs text-slate-500">{gap.durationMin} min libre</span>
            {isPast && (
              <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                Pasado
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="text-slate-300 hover:text-slate-500 text-sm leading-none shrink-0"
          title="Descartar tarea"
        >
          ✕
        </button>
      </div>

      {gap.candidates.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          Sin candidatos · Puedes marcar como tiempo interno desde el calendario.
        </p>
      ) : (
        <div className="space-y-0">
          {gap.candidates.map((c, i) => (
            <CandidateRow
              key={`${c.phone}-${i}`}
              candidate={c}
              gap={gap}
              staffName={staffName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OperationsPanel({
  staffId,
  staffName,
  week,
}: {
  staffId: string;
  staffName: string;
  week: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/db/gaps?staffId=${staffId}&week=${week}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setError(e.message ?? "Error al cargar tareas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (staffId && week) load();
  }, [staffId, week]);

  // Group gaps by day
  const gapsByDay = data
    ? data.gaps.reduce<Record<string, Gap[]>>((acc, g) => {
        if (!acc[g.dayIso]) acc[g.dayIso] = [];
        acc[g.dayIso].push(g);
        return acc;
      }, {})
    : {};

  const today = DateTime.now().setZone("Europe/Madrid").toISODate();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Tareas operativas</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Huecos reales de la agenda · Candidatos de lista de espera y recall
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50"
        >
          Refrescar
        </button>
      </div>

      {/* Impact banner */}
      {data && data.totalFreeMin > 0 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {data.gaps.length} huecos sin cubrir esta semana
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {data.totalFreeMin} min libres ·{" "}
              <span className="font-semibold">~€{data.estimatedRevenueImpact}</span> en ingresos potenciales
            </p>
          </div>
          <div className="flex gap-3 text-xs text-amber-700 font-medium">
            <span>📋 {data.waitlistTotal} en lista de espera</span>
            <span>🔔 {data.recallTotal} en recall</span>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <p className="text-sm text-slate-500">Cargando tareas...</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !data || data.gaps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">
            🎉 No hay huecos libres esta semana para {staffName}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(gapsByDay).map(([dayIso, gaps]) => {
            const isToday = dayIso === today;
            const isFuture = dayIso > (today ?? "");
            let taskCounter = 0;
            // Count global task index across all days
            const dayStartIdx =
              Object.entries(gapsByDay)
                .filter(([d]) => d < dayIso)
                .reduce((s, [, gs]) => s + gs.length, 0) + 1;

            return (
              <div key={dayIso} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h4
                    className={`text-sm font-semibold capitalize ${
                      isToday ? "text-sky-700" : isFuture ? "text-slate-900" : "text-slate-400"
                    }`}
                  >
                    {isToday ? "📅 Hoy, " : ""}
                    {gaps[0].dayLabel}
                  </h4>
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                    {gaps.length} {gaps.length === 1 ? "tarea" : "tareas"}
                  </span>
                </div>

                <div className="space-y-2">
                  {gaps.map((gap, i) => (
                    <GapCard
                      key={`${gap.dayIso}-${gap.start}`}
                      gap={gap}
                      index={dayStartIdx + i}
                      staffName={staffName}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
