"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";

const ZONE = "Europe/Madrid";

// ── Domain types ──────────────────────────────────────────────────────────────

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

type AtRiskAppt = {
  recordId: string;
  patientName: string;
  phone: string;
  treatmentName: string;
  start: string; // "HH:mm" display
  durationMin: number;
  noShowRisk: "HIGH" | "MED" | "LOW";
  confirmed: boolean;
};

type OngoingPatient = {
  patientName: string;
  phone: string;
  treatmentName: string;
  treatmentValue?: number;
  lastVisitLabel: string;
  status: "ALERT" | "WARN" | "OK";
};

type ReputationAlert = {
  patientName: string;
  phone: string;
  score: number;
  hoursAgo: number;
  treatment: string;
};

type Quote = {
  id: string;
  patientName: string;
  patientPhone?: string;
  treatment: string;
  amount: number;
  status: "PRESENTADO" | "INTERESADO" | "CONFIRMADO" | "PERDIDO";
  presentedAt: string;
  daysSince: number;
  notes?: string;
};

type SendStatus = "idle" | "sending" | "sent" | "error";
type BlockStatus = "idle" | "blocking" | "blocked" | "error";

const BLOCK_TYPES = [
  "Tiempo interno",
  "Descanso",
  "Reunión de equipo",
  "Formación",
  "Admin",
  "Otro",
] as const;
type BlockType = (typeof BLOCK_TYPES)[number];

// ── Unified action task ───────────────────────────────────────────────────────

type ActionTask = {
  id: string;
  category: "NO_SHOW" | "GAP" | "PRESUPUESTO" | "REPUTATION";
  patientName: string;
  phone?: string;
  description: string;
  whatsappMsg?: string;
  deadline: DateTime | null;
  // Raw source for inline actions
  atRiskAppt?: AtRiskAppt;
  gap?: Gap;
  quote?: Quote;
  reputationAlert?: ReputationAlert;
};

// ── Deadline helpers ──────────────────────────────────────────────────────────

function computeDeadline(
  category: ActionTask["category"],
  opts: { apptStartIso?: string; gap?: Gap; presentedAt?: string }
): DateTime | null {
  const now = DateTime.now().setZone(ZONE);

  if (category === "NO_SHOW" && opts.apptStartIso) {
    const dt = DateTime.fromISO(opts.apptStartIso, { zone: ZONE });
    if (!dt.isValid) return null;
    const dow = dt.weekday;
    const hour = dt.hour;
    if (hour < 13) {
      if (dow === 1) return dt.minus({ days: 3 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
      return dt.minus({ days: 1 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    }
    return dt.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  }

  if (category === "GAP" && opts.gap) {
    // Same advance-deadline logic as NO_SHOW: act the day before
    const dt = DateTime.fromISO(opts.gap.startIso, { setZone: true }).setZone(ZONE);
    if (!dt.isValid) return null;
    const dow = dt.weekday;
    const hour = dt.hour;
    if (hour < 13) {
      if (dow === 1) return dt.minus({ days: 3 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
      return dt.minus({ days: 1 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    }
    return dt.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  }

  if (category === "PRESUPUESTO" && opts.presentedAt) {
    // 14 days from presentation date
    return DateTime.fromISO(opts.presentedAt, { zone: ZONE })
      .plus({ days: 14 })
      .set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
  }

  if (category === "REPUTATION") {
    // Call same day — close of business
    return now.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  }

  return null;
}

function formatDeadline(deadline: DateTime | null): { label: string; urgent: boolean } {
  if (!deadline) return { label: "", urgent: false };
  const now = DateTime.now().setZone(ZONE);
  const hoursUntil = deadline.diff(now, "hours").hours;

  let timeRemaining: string;
  if (hoursUntil < 0) {
    timeRemaining = "deadline pasado";
  } else if (hoursUntil < 1) {
    timeRemaining = `quedan ${Math.max(1, Math.round(hoursUntil * 60))} min`;
  } else if (hoursUntil < 24) {
    timeRemaining = `quedan ${Math.round(hoursUntil)}h`;
  } else {
    const days = Math.floor(hoursUntil / 24);
    timeRemaining = `quedan ${days}d`;
  }

  const todayIso = now.toISODate();
  const tomorrowIso = now.plus({ days: 1 }).toISODate();
  const dlIso = deadline.toISODate();
  const dayStr =
    dlIso === todayIso
      ? `hoy ${deadline.toFormat("HH:mm")}`
      : dlIso === tomorrowIso
        ? `mañana ${deadline.toFormat("HH:mm")}`
        : deadline.setLocale("es").toFormat("EEE d/M HH:mm");

  return {
    label: `hasta ${dayStr} · ${timeRemaining}`,
    urgent: hoursUntil < 4,
  };
}

// ── WhatsApp send helper ──────────────────────────────────────────────────────

async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const res = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── Quote WA message builder ──────────────────────────────────────────────────

function buildQuoteMessage(q: Quote): string {
  if (q.status === "INTERESADO") {
    return (
      `Hola ${q.patientName} 🙂 Sabemos que te interesó el presupuesto de ` +
      `${q.treatment} (€${q.amount.toLocaleString()}). ` +
      `¿Has podido tomar una decisión? Podemos hablar de opciones de pago si lo necesitas.`
    );
  }
  return (
    `Hola ${q.patientName} 🙂 ¿Has podido revisar el presupuesto de ` +
    `${q.treatment} (€${q.amount.toLocaleString()})? ` +
    `Aquí estamos si tienes alguna pregunta.`
  );
}

// ── Gap message builder ───────────────────────────────────────────────────────

function buildCandidateMessage(candidate: Candidate, gap: Gap, staffName: string): string {
  const dt = DateTime.fromISO(gap.startIso, { setZone: true }).setZone(ZONE);
  const dayStr = dt.setLocale("es").toFormat("EEEE d 'de' MMMM");
  if (candidate.type === "WAITLIST") {
    return (
      `Hola ${candidate.patientName} 🙂 Buenas noticias! ` +
      `Se ha liberado una franja el ${dayStr} a las ${gap.start} (${gap.durationMin} min) ` +
      `para tu ${candidate.label}. ` +
      `¿Lo reservamos? Responde *SÍ* para confirmar o *NO* si no puedes.`
    );
  }
  return (
    `Hola ${candidate.patientName} 🙂 Desde la clínica queremos saber cómo estás ` +
    `y recordarte que tienes una revisión pendiente de ${candidate.label}. ` +
    `Tenemos una franja el ${dayStr} a las ${gap.start}. ` +
    `¿Te viene bien? Responde *SÍ* para confirmar.`
  );
}

// ── CandidateRow ──────────────────────────────────────────────────────────────

function CandidateRow({ candidate, gap, staffName }: { candidate: Candidate; gap: Gap; staffName: string }) {
  const [status, setStatus] = useState<SendStatus>("idle");
  const [showMsg, setShowMsg] = useState(false);
  const message = buildCandidateMessage(candidate, gap, staffName);

  async function handleSend() {
    if (!confirm(`Enviar WhatsApp a ${candidate.patientName}?\n\n"${message}"`)) return;
    setStatus("sending");
    try {
      await sendWhatsApp(candidate.phone, message);
      setStatus("sent");
    } catch { setStatus("error"); }
  }

  const isWaitlist = candidate.type === "WAITLIST";
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-t border-slate-100 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${isWaitlist ? "bg-sky-50 text-sky-700 border border-sky-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
            {isWaitlist ? "Lista espera" : "Recall"}
          </span>
          {candidate.priorityBadge && <span className="text-sm">{candidate.priorityBadge}</span>}
          <span className="text-sm font-semibold text-slate-900">{candidate.patientName}</span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">{candidate.label} · {candidate.waitingLabel}</p>
        {showMsg && (
          <p className="text-xs text-slate-400 mt-1 italic leading-relaxed border-l-2 border-slate-200 pl-2">"{message}"</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={() => setShowMsg((v) => !v)} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100">👁</button>
        {status === "sent" ? (
          <span className="text-xs text-emerald-600 font-semibold px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200">✓ Enviado</span>
        ) : status === "error" ? (
          <span className="text-xs text-red-600 font-semibold px-2 py-1 rounded-full bg-red-50 border border-red-200">Error</span>
        ) : (
          <button onClick={handleSend} disabled={status === "sending"} className="text-xs px-3 py-1.5 rounded-full bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-50">
            {status === "sending" ? "Enviando..." : "💬 Enviar"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Block creation form ───────────────────────────────────────────────────────

function BlockForm({ gap, staffRecordId, onBlocked }: {
  gap: Gap;
  staffRecordId?: string;
  onBlocked: () => void;
}) {
  const [status, setStatus] = useState<BlockStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [blockType, setBlockType] = useState<BlockType>("Tiempo interno");
  const [blockTitle, setBlockTitle] = useState("Tiempo interno");
  const [blockDuration, setBlockDuration] = useState(gap.durationMin);
  const [blockNotes, setBlockNotes] = useState("");

  const minDur = 15;
  const maxDur = gap.durationMin;
  const stepCount = Math.floor((maxDur - minDur) / 15);

  if (status === "blocked") {
    return <p className="text-xs text-emerald-600 font-semibold">✓ Franja bloqueada</p>;
  }

  async function handleBlock() {
    setStatus("blocking");
    setError(null);
    try {
      const startDt = DateTime.fromISO(gap.startIso, { setZone: true }).toUTC();
      const endDt = startDt.plus({ minutes: blockDuration });
      const body: Record<string, unknown> = {
        name: blockTitle || blockType,
        startIso: startDt.toISO(),
        endIso: endDt.toISO(),
        notes: blockNotes || `Marcado como "${blockTitle || blockType}" desde Acciones`,
      };
      if (staffRecordId) body.staffRecordId = staffRecordId;
      const res = await fetch("/api/db/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      setStatus("blocked");
      onBlocked();
    } catch (e: any) {
      setError(e.message ?? "Error");
      setStatus("error");
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
      <p className="text-xs font-semibold text-slate-600">⏱ Bloquear franja para uso interno</p>
      <div className="flex gap-2">
        <select value={blockType}
          onChange={(e) => { setBlockType(e.target.value as BlockType); setBlockTitle(e.target.value); }}
          className="flex-1 text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300">
          {BLOCK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="text" value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)}
          placeholder="Título"
          className="flex-1 text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300" />
      </div>
      {stepCount > 0 && (
        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Duración</span><span className="font-semibold text-violet-700">{blockDuration} min</span>
          </div>
          <input type="range" min={minDur} max={maxDur} step={15} value={blockDuration}
            onChange={(e) => setBlockDuration(Number(e.target.value))} className="w-full accent-violet-600" />
        </div>
      )}
      <textarea rows={2} value={blockNotes} onChange={(e) => setBlockNotes(e.target.value)}
        placeholder="Notas (opcional)"
        className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300" />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button onClick={handleBlock} disabled={status === "blocking"}
        className="w-full text-xs px-3 py-1.5 rounded-full bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50">
        {status === "blocking" ? "Creando..." : "✓ Confirmar bloqueo"}
      </button>
    </div>
  );
}

// ── ActionCard ────────────────────────────────────────────────────────────────

const CAT_CONFIG = {
  NO_SHOW:    { icon: "🔴", label: "No-show",    bg: "bg-rose-50 border-rose-200",      badge: "bg-rose-100 text-rose-700 border-rose-200" },
  GAP:        { icon: "🕳",  label: "Hueco",      bg: "bg-sky-50 border-sky-200",        badge: "bg-sky-100 text-sky-700 border-sky-200" },
  PRESUPUESTO:{ icon: "💶", label: "Presupuesto", bg: "bg-emerald-50 border-emerald-200", badge: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  REPUTATION: { icon: "⭐", label: "Reputación",  bg: "bg-orange-50 border-orange-200",  badge: "bg-orange-100 text-orange-700 border-orange-200" },
};

function ActionCard({
  task, index, staffName, staffRecordId, onDone, isDone,
}: {
  task: ActionTask;
  index: number;
  staffName: string;
  staffRecordId?: string;
  onDone: (id: string) => void;
  isDone: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [waSendStatus, setWaSendStatus] = useState<SendStatus>("idle");
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [gapBlocked, setGapBlocked] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState<Quote["status"] | null>(null);
  const [quotePatching, setQuotePatching] = useState(false);
  const [waAdded72h, setWaAdded72h] = useState(false);

  const cfg = CAT_CONFIG[task.category];
  const dl = formatDeadline(task.deadline);

  if (isDone) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center gap-3 opacity-50">
        <span className="text-xs font-bold text-slate-300 w-6 shrink-0">#{index + 1}</span>
        <span className="text-emerald-500 font-bold">✓</span>
        <span className="text-sm text-slate-400 line-through">{task.patientName}</span>
        <span className="text-xs text-slate-300">{task.description}</span>
      </div>
    );
  }

  async function handleWaSend(msg: string, phone: string) {
    if (!confirm(`Enviar WhatsApp a ${task.patientName}?\n\n"${msg}"`)) return;
    setWaSendStatus("sending");
    try {
      await sendWhatsApp(phone, msg);
      setWaSendStatus("sent");
    } catch { setWaSendStatus("error"); }
  }

  async function patchQuoteStatus(newStatus: Quote["status"]) {
    if (!task.quote) return;
    setQuotePatching(true);
    try {
      await fetch("/api/db/quotes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.quote.id, status: newStatus }),
      });
      setQuoteStatus(newStatus);
      if (newStatus === "CONFIRMADO" || newStatus === "PERDIDO") onDone(task.id);
    } finally {
      setQuotePatching(false);
    }
  }

  const currentQuoteStatus = quoteStatus ?? task.quote?.status;

  return (
    <div className={`rounded-2xl border ${cfg.bg} overflow-hidden`}>
      {/* ── Card header ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:brightness-95 transition-all"
      >
        {/* Number */}
        <span className="text-xs font-bold text-slate-400 w-6 shrink-0 mt-0.5">#{index + 1}</span>
        <span className="text-base shrink-0 mt-0.5">{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900">{task.patientName}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${cfg.badge}`}>
              {cfg.label}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5 truncate">{task.description}</p>
          {dl.label && (
            <p className={`text-xs font-semibold mt-1 ${dl.urgent ? "text-red-600" : "text-slate-500"}`}>
              {dl.urgent ? "⏰ " : "🕐 "}{dl.label}
            </p>
          )}
        </div>
        <span className="text-slate-400 text-xs shrink-0 mt-0.5">{expanded ? "▲" : "▾"}</span>
      </button>

      {/* ── Expanded inline actions ── */}
      {expanded && (
        <div className="border-t border-black/5 px-4 pb-4 pt-3 space-y-4">

          {/* NO_SHOW — auto-reminders + manual call */}
          {task.category === "NO_SHOW" && task.atRiskAppt && (
            <>
              {/* Automatic reminders */}
              <div className="rounded-xl bg-white/70 border border-black/5 p-3 space-y-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Recordatorios automáticos — Fyllio
                </p>
                <p className="text-xs text-slate-500">📱 48h antes — programado</p>
                <p className="text-xs text-slate-500">📱 24h antes — programado</p>
                {task.atRiskAppt.noShowRisk === "HIGH" && !waAdded72h && (
                  <button
                    onClick={() => setWaAdded72h(true)}
                    className="mt-1 text-xs text-sky-600 hover:text-sky-700 font-medium underline underline-offset-2"
                  >
                    + Añadir recordatorio 72h (mayor insistencia)
                  </button>
                )}
                {waAdded72h && (
                  <p className="text-xs text-sky-600">📱 72h antes — añadido ✓</p>
                )}
              </div>

              {/* Manual action */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Acción manual recomendada
                </p>
                {task.phone && (
                  <a
                    href={`tel:${task.phone}`}
                    className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl bg-rose-600 text-white font-semibold hover:bg-rose-700 w-full justify-center"
                  >
                    📞 Llamar personalmente — confirmar asistencia
                  </a>
                )}
                {task.whatsappMsg && task.phone && (
                  <div className="space-y-1.5">
                    {waSendStatus === "sent" ? (
                      <span className="inline-flex text-xs text-emerald-600 font-semibold px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">✓ WhatsApp enviado</span>
                    ) : waSendStatus === "error" ? (
                      <span className="inline-flex text-xs text-red-500 font-semibold px-3 py-1.5 rounded-full bg-red-50 border border-red-200">Error al enviar</span>
                    ) : (
                      <button
                        onClick={() => handleWaSend(task.whatsappMsg!, task.phone!)}
                        disabled={waSendStatus === "sending"}
                        className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 font-semibold hover:bg-slate-50 disabled:opacity-50"
                      >
                        {waSendStatus === "sending" ? "Enviando..." : "💬 Enviar recordatorio WA ahora"}
                      </button>
                    )}
                    <p className="text-xs text-slate-400 italic leading-relaxed border-l-2 border-slate-200 pl-2">
                      "{task.whatsappMsg}"
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* GAP — candidates + block form */}
          {task.category === "GAP" && task.gap && !gapBlocked && (
            <div className="space-y-2">
              {task.gap.candidates.length > 0 ? (
                <div className="space-y-0">
                  {task.gap.candidates.map((c, i) => (
                    <CandidateRow key={`${c.phone}-${i}`} candidate={c} gap={task.gap!} staffName={staffName} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">Sin candidatos en lista de espera ni recall para esta franja.</p>
              )}
              <button
                onClick={() => setShowBlockForm((v) => !v)}
                className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 font-medium hover:bg-slate-50">
                ⏱ {showBlockForm ? "Ocultar" : "Bloquear para uso interno"}
              </button>
              {showBlockForm && (
                <BlockForm
                  gap={task.gap}
                  staffRecordId={staffRecordId}
                  onBlocked={() => { setGapBlocked(true); onDone(task.id); }}
                />
              )}
            </div>
          )}

          {/* PRESUPUESTO — WA follow-up + status buttons */}
          {task.category === "PRESUPUESTO" && task.quote && (
            <div className="space-y-3">
              {/* Info row */}
              <div className="rounded-xl bg-white/70 border border-black/5 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-emerald-700">€{task.quote.amount.toLocaleString()}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    currentQuoteStatus === "INTERESADO"
                      ? "bg-sky-100 text-sky-700 border-sky-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                  }`}>
                    {currentQuoteStatus === "INTERESADO" ? "Interesado" : "Presentado"} · {task.quote.daysSince}d
                  </span>
                </div>
                <p className="text-xs text-slate-600">{task.quote.treatment}</p>
                {task.quote.notes && (
                  <p className="text-xs text-slate-400 italic">{task.quote.notes}</p>
                )}
              </div>

              {/* WA message */}
              {task.whatsappMsg && task.quote.patientPhone && (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-400 italic leading-relaxed border-l-2 border-emerald-200 pl-2">
                    "{task.whatsappMsg}"
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {waSendStatus === "sent" ? (
                      <span className="text-xs text-emerald-600 font-semibold px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">✓ Enviado</span>
                    ) : waSendStatus === "error" ? (
                      <span className="text-xs text-red-500 font-semibold px-3 py-1.5 rounded-full bg-red-50 border border-red-200">Error al enviar</span>
                    ) : (
                      <button
                        onClick={() => handleWaSend(task.whatsappMsg!, task.quote!.patientPhone!)}
                        disabled={waSendStatus === "sending"}
                        className="text-xs px-3 py-1.5 rounded-full bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {waSendStatus === "sending" ? "Enviando..." : "💬 Enviar seguimiento WA"}
                      </button>
                    )}
                    {task.quote.patientPhone && (
                      <a
                        href={`tel:${task.quote.patientPhone}`}
                        className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 font-semibold hover:bg-slate-50"
                      >
                        📞 Llamar
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Status change buttons */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Actualizar estado</p>
                <div className="flex gap-2 flex-wrap">
                  {currentQuoteStatus !== "INTERESADO" && (
                    <button
                      onClick={() => patchQuoteStatus("INTERESADO")}
                      disabled={quotePatching}
                      className="text-xs px-3 py-1.5 rounded-full border border-sky-200 bg-sky-50 text-sky-700 font-semibold hover:bg-sky-100 disabled:opacity-50"
                    >
                      Interesado ✓
                    </button>
                  )}
                  <button
                    onClick={() => patchQuoteStatus("CONFIRMADO")}
                    disabled={quotePatching}
                    className="text-xs px-3 py-1.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold hover:bg-emerald-100 disabled:opacity-50"
                  >
                    Confirmar ✓
                  </button>
                  <button
                    onClick={() => patchQuoteStatus("PERDIDO")}
                    disabled={quotePatching}
                    className="text-xs px-3 py-1.5 rounded-full border border-red-200 bg-red-50 text-red-600 font-semibold hover:bg-red-100 disabled:opacity-50"
                  >
                    Perdido ✗
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* REPUTATION — only call */}
          {task.category === "REPUTATION" && task.reputationAlert && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-base">{"⭐".repeat(task.reputationAlert.score)}{"☆".repeat(5 - task.reputationAlert.score)}</span>
                <span className="text-xs text-slate-500">{task.reputationAlert.treatment} · hace {task.reputationAlert.hoursAgo}h</span>
              </div>
              {task.phone && (
                <a
                  href={`tel:${task.phone}`}
                  className="inline-flex text-xs px-3 py-1.5 rounded-full bg-orange-500 text-white font-semibold hover:bg-orange-600"
                >
                  📞 Llamar ahora
                </a>
              )}
            </div>
          )}

          {/* Mark as done */}
          <div className="pt-1 border-t border-black/5">
            <button
              onClick={() => onDone(task.id)}
              className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-500 font-medium hover:bg-slate-50 hover:text-slate-700">
              ✓ Marcar como hecho
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OperationsPanel({
  staffId,
  staffName,
  staffRecordId,
  week,
  clinicId,
  onGoToSection,
}: {
  staffId: string;
  staffName: string;
  staffRecordId?: string;
  week: string;
  clinicId?: string;
  onGoToSection?: (sectionKey: string) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [atRiskToday, setAtRiskToday] = useState<AtRiskAppt[]>([]);
  const [atRiskTomorrow, setAtRiskTomorrow] = useState<AtRiskAppt[]>([]);
  const [ongoingAlert, setOngoingAlert] = useState<OngoingPatient[]>([]);
  const [reputationAlerts, setReputationAlerts] = useState<ReputationAlert[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);

  // Progress tracking (localStorage)
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("fyllio_ops_completed");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  function markDone(id: string) {
    setCompletedIds((prev) => {
      const next = new Set(prev).add(id);
      try { localStorage.setItem("fyllio_ops_completed", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  async function load() {
    setLoading(true);
    setError(null);

    const now = DateTime.now().setZone(ZONE);
    const tomorrowIso = now.plus({ days: 1 }).toISODate()!;

    try {
      const gapsUrl = `/api/db/gaps?staffId=${staffId}&week=${week}${clinicId ? `&clinicId=${clinicId}` : ""}`;
      const [gapsRes, todayRes, tomorrowRes, treatmentsRes, feedbackRes, quotesRes] = await Promise.all([
        fetch(gapsUrl, { cache: "no-store" }),
        fetch(`/api/db/today?staffId=${staffId}`, { cache: "no-store" }),
        fetch(`/api/db/today?staffId=${staffId}&date=${tomorrowIso}`, { cache: "no-store" }),
        fetch(`/api/db/ongoing-treatments?staffId=${staffId}`, { cache: "no-store" }),
        fetch(`/api/dashboard/feedback`, { cache: "no-store" }),
        fetch(`/api/db/quotes`, { cache: "no-store" }),
      ]);

      const gapsJson = await gapsRes.json();
      if (gapsJson.error) throw new Error(gapsJson.error);
      setData(gapsJson);

      if (todayRes.ok) {
        const todayJson = await todayRes.json();
        setAtRiskToday(
          (todayJson.appointments ?? []).filter(
            (a: any) => !a.isBlock && !a.confirmed && (a.noShowRisk === "HIGH" || a.noShowRisk === "MED")
          )
        );
      }

      if (tomorrowRes.ok) {
        const tomJson = await tomorrowRes.json();
        setAtRiskTomorrow(
          (tomJson.appointments ?? []).filter(
            (a: any) => !a.isBlock && !a.confirmed && a.noShowRisk === "HIGH"
          )
        );
      }

      if (treatmentsRes.ok) {
        const txJson = await treatmentsRes.json();
        const patients: OngoingPatient[] = (txJson.patients ?? [])
          .map((p: any) => ({
            patientName: p.patientName,
            phone: p.phone ?? "",
            treatmentName: p.treatmentName,
            treatmentValue: p.treatmentValue ?? 0,
            lastVisitLabel: p.lastVisitLabel ?? "",
            status: p.status,
          }))
          .filter((p: OngoingPatient) => p.status === "ALERT");
        patients.sort((a, b) => (b.treatmentValue ?? 0) - (a.treatmentValue ?? 0));
        setOngoingAlert(patients);
      }

      if (feedbackRes.ok) {
        const fbJson = await feedbackRes.json();
        const alerts: ReputationAlert[] = (fbJson.negativeAlerts ?? []).map((a: any) => ({
          patientName: a.patientName ?? "Paciente",
          phone: a.phone ?? "",
          score: a.score ?? 1,
          hoursAgo: a.hoursAgo ?? 24,
          treatment: a.treatment ?? "Tratamiento",
        }));
        setReputationAlerts(alerts);
      }

      if (quotesRes.ok) {
        const quotesJson = await quotesRes.json();
        const pendingQuotes: Quote[] = (quotesJson.quotes ?? []).filter(
          (q: Quote) => q.status === "PRESENTADO" || q.status === "INTERESADO"
        );
        setQuotes(pendingQuotes);
      }
    } catch (e: any) {
      setError(e.message ?? "Error al cargar tareas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (staffId && week) load();
  }, [staffId, week]);

  // ── Build unified task list ───────────────────────────────────────────────

  const now = DateTime.now().setZone(ZONE);
  const todayIso = now.toISODate()!;
  const tomorrowIso = now.plus({ days: 1 }).toISODate()!;

  // Convert ongoing patients into RECALL candidates for gaps
  const ongoingCandidates: Candidate[] = ongoingAlert.map((p) => ({
    type: "RECALL",
    patientName: p.patientName,
    phone: p.phone,
    label: p.treatmentName,
    waitingLabel: p.lastVisitLabel,
    priorityBadge: "🔴",
  }));

  const tasks: ActionTask[] = [];

  // NO_SHOW — today
  atRiskToday.forEach((a) => {
    const fullIso = `${todayIso}T${a.start}:00`;
    const deadline = computeDeadline("NO_SHOW", { apptStartIso: fullIso });
    const msg = a.noShowRisk === "HIGH"
      ? `Hola ${a.patientName} 🙏 Tu cita de hoy a las ${a.start} con ${staffName}${a.treatmentName ? ` (${a.treatmentName})` : ""} aún no está confirmada. ¿Puedes confirmarnos que asistirás? Responde *SÍ* o escríbenos si necesitas cambiarla.`
      : `Hola ${a.patientName} 🙂 Te recordamos tu cita de hoy a las ${a.start} con ${staffName}${a.treatmentName ? ` (${a.treatmentName})` : ""}. ¿Confirmas asistencia? Responde *SÍ* o escríbenos si necesitas cambiarla.`;
    tasks.push({
      id: `noshow-today-${a.recordId}`,
      category: "NO_SHOW",
      patientName: a.patientName,
      phone: a.phone,
      description: `Cita hoy ${a.start} · ${a.treatmentName || "Cita"} · sin confirmar`,
      whatsappMsg: msg,
      deadline,
      atRiskAppt: a,
    });
  });

  // NO_SHOW — tomorrow
  atRiskTomorrow.forEach((a) => {
    const fullIso = `${tomorrowIso}T${a.start}:00`;
    const deadline = computeDeadline("NO_SHOW", { apptStartIso: fullIso });
    const msg = `Hola ${a.patientName} 🙏 Te recordamos tu cita de mañana a las ${a.start} con ${staffName}${a.treatmentName ? ` (${a.treatmentName})` : ""}. ¿Confirmas asistencia? Responde *SÍ* o escríbenos si necesitas cambiarla.`;
    tasks.push({
      id: `noshow-tom-${a.recordId}`,
      category: "NO_SHOW",
      patientName: a.patientName,
      phone: a.phone,
      description: `Cita mañana ${a.start} · ${a.treatmentName || "Cita"} · sin confirmar`,
      whatsappMsg: msg,
      deadline,
      atRiskAppt: a,
    });
  });

  // REPUTATION
  reputationAlerts.forEach((r) => {
    const deadline = computeDeadline("REPUTATION", {});
    tasks.push({
      id: `reputation-${r.patientName}-${r.hoursAgo}`,
      category: "REPUTATION",
      patientName: r.patientName,
      phone: r.phone,
      description: `${r.score}/5 ⭐ · ${r.treatment} · hace ${r.hoursAgo}h`,
      deadline,
      reputationAlert: r,
    });
  });

  // GAP — with ongoing patients merged in as RECALL candidates
  (data?.gaps ?? []).forEach((g) => {
    const deadline = computeDeadline("GAP", { gap: g });
    const isToday = g.dayIso === todayIso;

    // Enrich candidates with ongoing patients (up to 8 total)
    const enrichedCandidates = [...g.candidates, ...ongoingCandidates].slice(0, 8);

    tasks.push({
      id: `gap-${g.dayIso}-${g.start}`,
      category: "GAP",
      patientName: `Hueco ${g.start}–${g.end}`,
      description: `${isToday ? "Hoy" : g.dayLabel} · ${g.durationMin} min · ${enrichedCandidates.length} candidato${enrichedCandidates.length !== 1 ? "s" : ""}`,
      deadline,
      gap: { ...g, candidates: enrichedCandidates },
    });
  });

  // PRESUPUESTO — pending quotes
  quotes.forEach((q) => {
    const deadline = computeDeadline("PRESUPUESTO", { presentedAt: q.presentedAt });
    const msg = buildQuoteMessage(q);
    tasks.push({
      id: `quote-${q.id}`,
      category: "PRESUPUESTO",
      patientName: q.patientName,
      phone: q.patientPhone,
      description: `${q.treatment} · €${q.amount.toLocaleString()} · ${q.daysSince}d sin respuesta`,
      whatsappMsg: msg,
      deadline,
      quote: q,
    });
  });

  // Sort by deadline ASC (closest first; null deadlines go last)
  tasks.sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.toMillis() - b.deadline.toMillis();
  });

  // ── Header calcs ─────────────────────────────────────────────────────────

  const pendingTasks = tasks.filter((t) => !completedIds.has(t.id));
  const totalTasks = tasks.length;
  const completedCount = totalTasks - pendingTasks.length;
  const progressPct = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  const noShowCount = (atRiskToday.length + atRiskTomorrow.length);
  const gapCount = data?.gaps.length ?? 0;
  const presupuestoCount = quotes.length;
  const reputationCount = reputationAlerts.length;

  const atRiskEur =
    atRiskToday.reduce((s, a) => s + a.durationMin, 0) +
    atRiskTomorrow.reduce((s, a) => s + a.durationMin, 0) +
    (data?.estimatedRevenueImpact ?? 0) +
    quotes.reduce((s, q) => s + q.amount, 0);

  const estMinutes = pendingTasks.length * 5;
  const estLabel = estMinutes >= 60
    ? `~${Math.floor(estMinutes / 60)}h ${estMinutes % 60 > 0 ? `${estMinutes % 60}min` : ""}`
    : `~${estMinutes} min`;

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-3xl bg-slate-100" />
        <div className="h-48 rounded-2xl bg-slate-100" />
        <div className="h-32 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Error al cargar tareas: {error}
        <button onClick={load} className="ml-3 text-xs underline">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-700 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-violet-200 uppercase tracking-widest">
              Centro de operaciones · {staffName}
            </p>
            <h2 className="mt-1 text-3xl font-extrabold">{pendingTasks.length} tareas pendientes</h2>
            <p className="text-sm text-violet-100 mt-0.5">
              {atRiskEur > 0 ? (
                <><span className="text-amber-300 font-bold">~€{atRiskEur.toLocaleString()} en juego</span> · {estLabel} para completar</>
              ) : (
                "agenda al día — sin tareas urgentes"
              )}
            </p>
          </div>
          <button type="button" onClick={load}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 border border-white/25 text-white hover:bg-white/30 shrink-0">
            Refrescar
          </button>
        </div>

        {totalTasks > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-violet-200">{completedCount}/{totalTasks} completadas</span>
              <span className="text-xs font-bold text-white">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/20">
              <div className="h-2 rounded-full bg-white transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-4 gap-2">
          {[
            { count: noShowCount,      label: "No-show",      active: noShowCount > 0,      activeColor: "bg-rose-500/30 border-rose-400/40" },
            { count: gapCount,         label: "Huecos",       active: gapCount > 0,         activeColor: "bg-sky-400/25 border-sky-300/30" },
            { count: presupuestoCount, label: "Presupuestos", active: presupuestoCount > 0, activeColor: "bg-emerald-500/30 border-emerald-400/40" },
            { count: reputationCount,  label: "Reputación",   active: reputationCount > 0,  activeColor: "bg-orange-400/25 border-orange-300/30" },
          ].map(({ count, label, active, activeColor }) => (
            <div key={label} className={`rounded-2xl border p-3 text-center ${active ? activeColor : "bg-white/15 border-white/20"}`}>
              <p className="text-lg font-extrabold">{count}</p>
              <p className="text-[10px] text-violet-200 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Task list — sorted by deadline ────────────────────────────── */}
      {pendingTasks.length === 0 && completedCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
          <p className="text-sm text-slate-500">🎉 Sin tareas pendientes esta semana — agenda al día</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task, i) => (
            <ActionCard
              key={task.id}
              task={task}
              index={i}
              staffName={staffName}
              staffRecordId={staffRecordId}
              onDone={markDone}
              isDone={completedIds.has(task.id)}
            />
          ))}
          {completedCount > 0 && (
            <p className="text-xs text-center text-slate-400 pt-1">
              {completedCount} tarea{completedCount !== 1 ? "s" : ""} completada{completedCount !== 1 ? "s" : ""} hoy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
