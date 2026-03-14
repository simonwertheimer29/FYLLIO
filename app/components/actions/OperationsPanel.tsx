"use client";

import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";

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

type NoShowRisk = "HIGH" | "MED" | "LOW";

type AtRiskAppt = {
  recordId: string;
  patientName: string;
  phone: string;
  treatmentName: string;
  start: string;
  durationMin: number;
  noShowRisk: NoShowRisk;
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
  score: number;      // 1-5
  hoursAgo: number;
  treatment: string;
};

type SendStatus = "idle" | "sending" | "sent" | "error";
type BlockStatus = "idle" | "blocking" | "blocked" | "error";

// ── Priority task list type ───────────────────────────────────────────────────

type TaskCategory = "NO_SHOW" | "ONGOING" | "GAP" | "REPUTATION";

type TaskItem = {
  id: string;
  urgencyScore: number;
  urgency: "HIGH" | "MED" | "LOW";
  category: TaskCategory;
  title: string;
  detail: string;
  sub?: string;
};

// ── Block types ───────────────────────────────────────────────────────────────

const BLOCK_TYPES = [
  "Tiempo interno",
  "Descanso",
  "Reunión de equipo",
  "Formación",
  "Admin",
  "Otro",
] as const;
type BlockType = (typeof BLOCK_TYPES)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMessage(candidate: Candidate, gap: Gap, staffName: string): string {
  const dt = DateTime.fromISO(gap.startIso, { setZone: true }).setZone("Europe/Madrid");
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

// ── Sub-components ────────────────────────────────────────────────────────────

function CandidateRow({ candidate, gap, staffName }: { candidate: Candidate; gap: Gap; staffName: string }) {
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
    } catch {
      setStatus("error");
    }
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
        <button onClick={() => setShowMsg((v) => !v)} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100" title="Ver mensaje">👁</button>
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

function GapCard({ gap, index, staffName, staffRecordId, onDismiss, onBlocked }: {
  gap: Gap; index: number; staffName: string; staffRecordId?: string;
  onDismiss: () => void; onBlocked: (key: string, durationMin: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [blockStatus, setBlockStatus] = useState<BlockStatus>("idle");
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockType, setBlockType] = useState<BlockType>("Tiempo interno");
  const [blockTitle, setBlockTitle] = useState("Tiempo interno");
  const [blockDuration, setBlockDuration] = useState(gap.durationMin);
  const [blockNotes, setBlockNotes] = useState("");

  const gapKey = `${gap.dayIso}-${gap.start}`;
  const isPast = DateTime.fromISO(gap.startIso, { setZone: true }).setZone("Europe/Madrid").diffNow("minutes").minutes < 0;

  async function handleBlock() {
    setBlockStatus("blocking");
    setBlockError(null);
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
      setBlockStatus("blocked");
      onBlocked(gapKey, blockDuration);
      setTimeout(onDismiss, 800);
    } catch (e: any) {
      setBlockError(e.message ?? "Error");
      setBlockStatus("error");
    }
  }

  if (blockStatus === "blocked") {
    return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 font-semibold">✓ Franja bloqueada</div>;
  }

  const minDur = 15;
  const maxDur = gap.durationMin;
  const stepCount = Math.floor((maxDur - minDur) / 15);

  return (
    <div className={`rounded-2xl border bg-white ${isPast ? "border-slate-200 opacity-60" : "border-sky-100"}`}>
      <button type="button" onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-sky-50 rounded-2xl transition-colors">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full shrink-0">#{index}</span>
          <span className="text-sm font-semibold text-slate-900">{gap.start} – {gap.end}</span>
          <span className="text-xs text-slate-500">{gap.durationMin} min</span>
          {gap.candidates.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100">
              {gap.candidates.length} candidato{gap.candidates.length !== 1 ? "s" : ""}
            </span>
          )}
          {isPast && <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Pasado</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onDismiss(); }} className="text-slate-300 hover:text-slate-500 text-sm" title="Descartar">✕</button>
          <span className="text-slate-400 text-xs">{isOpen ? "▲" : "▾"}</span>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-sky-100">
          {gap.candidates.length > 0 ? (
            <div className="space-y-0 pt-3">
              {gap.candidates.map((c, i) => <CandidateRow key={`${c.phone}-${i}`} candidate={c} gap={gap} staffName={staffName} />)}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic pt-3">Sin candidatos en lista de espera ni recall para esta franja.</p>
          )}

          <div className="pt-1 border-t border-slate-100 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Sin paciente:</span>
              <button onClick={() => setBlockOpen((v) => !v)} className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${blockOpen ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                ⏱ Reservar franja {blockOpen ? "▲" : "▾"}
              </button>
            </div>
            {blockOpen && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 font-medium">Tipo</label>
                  <select value={blockType} onChange={(e) => { setBlockType(e.target.value as BlockType); setBlockTitle(e.target.value); }}
                    className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300">
                    {BLOCK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 font-medium">Título</label>
                  <input type="text" value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)}
                    className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-500 font-medium">Duración</label>
                    <span className="text-xs font-semibold text-violet-700">{blockDuration} min</span>
                  </div>
                  {stepCount > 0 ? (
                    <input type="range" min={minDur} max={maxDur} step={15} value={blockDuration}
                      onChange={(e) => setBlockDuration(Number(e.target.value))} className="w-full accent-violet-600" />
                  ) : (
                    <p className="text-xs text-slate-400 italic">Franja de {maxDur} min (fija)</p>
                  )}
                  <div className="flex justify-between text-xs text-slate-400"><span>{minDur} min</span><span>{maxDur} min</span></div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 font-medium">Notas <span className="font-normal">(opcionales)</span></label>
                  <textarea rows={2} value={blockNotes} onChange={(e) => setBlockNotes(e.target.value)}
                    className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300" />
                </div>
                {blockError && <p className="text-xs text-red-500">{blockError}</p>}
                <button onClick={handleBlock} disabled={blockStatus === "blocking"}
                  className="w-full text-xs px-3 py-2 rounded-full bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50">
                  {blockStatus === "blocking" ? "Creando..." : "✓ Confirmar bloqueo"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AtRiskRow({ appt, staffName, isUrgentHour }: { appt: AtRiskAppt; staffName: string; isUrgentHour?: boolean }) {
  const [status, setStatus] = useState<SendStatus>("idle");
  async function handleSend() {
    if (!appt.phone) return;
    const msg = appt.noShowRisk === "HIGH"
      ? `Hola ${appt.patientName} 🙏 Tu cita de hoy a las ${appt.start} con ${staffName}${appt.treatmentName ? ` (${appt.treatmentName})` : ""} aún no está confirmada. ¿Puedes confirmarnos que asistirás? Responde *SÍ* o escríbenos si necesitas cambiarla.`
      : `Hola ${appt.patientName} 🙂 Te recordamos tu cita de hoy a las ${appt.start} con ${staffName}${appt.treatmentName ? ` (${appt.treatmentName})` : ""}. ¿Confirmas asistencia? Responde *SÍ* o escríbenos si necesitas cambiarla.`;
    if (!confirm(`Enviar WhatsApp a ${appt.patientName}?\n\n"${msg}"`)) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: appt.phone, message: msg }) });
      if (!res.ok) throw new Error();
      setStatus("sent");
    } catch { setStatus("error"); }
  }
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900">{appt.patientName}</p>
          {isUrgentHour && appt.noShowRisk === "HIGH" && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-red-700">
              llamar antes de las 10h
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {appt.start} · {appt.treatmentName || "Cita"} · {appt.durationMin} min
          <span className="ml-2 font-medium text-rose-600">~€{appt.durationMin} en riesgo</span>
        </p>
      </div>
      {status === "sent" ? (
        <span className="text-xs text-emerald-600 font-semibold px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 shrink-0">✓ Enviado</span>
      ) : status === "error" ? (
        <span className="text-xs text-red-500 font-semibold px-2 py-1 rounded-full bg-red-50 border border-red-200 shrink-0">Error</span>
      ) : appt.phone ? (
        <button type="button" onClick={handleSend} disabled={status === "sending"}
          className={`text-xs px-3 py-1.5 rounded-full font-semibold disabled:opacity-50 shrink-0 ${appt.noShowRisk === "HIGH" ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-amber-500 text-white hover:bg-amber-600"}`}>
          {status === "sending" ? "Enviando..." : appt.noShowRisk === "HIGH" ? "⚠️ Recordar ahora" : "💬 Recordatorio"}
        </button>
      ) : null}
    </div>
  );
}

function OngoingRow({ patient }: { patient: OngoingPatient }) {
  const [status, setStatus] = useState<SendStatus>("idle");
  async function handleSend() {
    if (!patient.phone) return;
    const msg = `Hola ${patient.patientName} 🙂 Te escribimos para recordarte que tu tratamiento de ${patient.treatmentName} requiere una próxima visita. ¿Cuándo podrías venir? Estamos aquí para ayudarte.`;
    if (!confirm(`Enviar WhatsApp a ${patient.patientName}?\n\n"${msg}"`)) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: patient.phone, message: msg }) });
      if (!res.ok) throw new Error();
      setStatus("sent");
    } catch { setStatus("error"); }
  }
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{patient.patientName}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {patient.treatmentName} · {patient.lastVisitLabel}
          {patient.treatmentValue && patient.treatmentValue > 0 && (
            <span className="ml-2 text-violet-700 font-semibold">€{patient.treatmentValue.toLocaleString()}</span>
          )}
          <span className="ml-2 text-rose-600 font-semibold">Sin cita próxima</span>
        </p>
      </div>
      {status === "sent" ? (
        <span className="text-xs text-emerald-600 font-semibold px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 shrink-0">✓ Enviado</span>
      ) : status === "error" ? (
        <span className="text-xs text-red-500 font-semibold px-2 py-1 rounded-full bg-red-50 border border-red-200 shrink-0">Error</span>
      ) : patient.phone ? (
        <button type="button" onClick={handleSend} disabled={status === "sending"}
          className="text-xs px-3 py-1.5 rounded-full font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 shrink-0">
          {status === "sending" ? "Enviando..." : "💬 Contactar"}
        </button>
      ) : null}
    </div>
  );
}

function ReputationRow({ alert }: { alert: ReputationAlert }) {
  const [called, setCalled] = useState(false);
  const stars = "⭐".repeat(alert.score) + "☆".repeat(5 - alert.score);

  function handleCall() {
    // Demo: show success state
    setCalled(true);
    setTimeout(() => {
      alert.phone && window.open(`tel:${alert.phone}`, "_self");
    }, 100);
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{alert.patientName}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          <span className="text-base leading-none">{stars}</span>
          <span className="ml-2">{alert.treatment}</span>
          <span className="ml-2 text-orange-600 font-medium">hace {alert.hoursAgo}h</span>
        </p>
      </div>
      {called ? (
        <span className="text-xs text-emerald-600 font-semibold px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 shrink-0">✓ Llamando</span>
      ) : (
        <button type="button" onClick={handleCall}
          className="text-xs px-3 py-1.5 rounded-full font-semibold bg-orange-500 text-white hover:bg-orange-600 shrink-0">
          📞 Llamar hoy
        </button>
      )}
    </div>
  );
}

// ── CollapsibleSection ────────────────────────────────────────────────────────

function CollapsibleSection({
  icon, title, count, headerBg, badgeColor, isOpen, onToggle, sectionRef, children,
}: {
  icon: string;
  title: string;
  count: number;
  headerBg: string;    // e.g. "bg-red-50 border-red-100"
  badgeColor: string;  // e.g. "bg-red-100 text-red-700 border-red-200"
  isOpen: boolean;
  onToggle: () => void;
  sectionRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  return (
    <div ref={sectionRef} className="rounded-2xl border border-slate-200 bg-white overflow-hidden scroll-mt-4">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between gap-3 px-5 py-4 hover:opacity-90 transition-opacity text-left ${headerBg}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg shrink-0">{icon}</span>
          <span className="text-sm font-bold text-slate-900">{title}</span>
          {count > 0 && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border shrink-0 ${badgeColor}`}>
              {count}
            </span>
          )}
        </div>
        <span className="text-slate-400 text-sm shrink-0">{isOpen ? "▲" : "▾"}</span>
      </button>
      {isOpen && (
        <div className="border-t border-slate-100">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Priority table ────────────────────────────────────────────────────────────

function PriorityTable({
  tasks,
  onJump,
}: {
  tasks: TaskItem[];
  onJump: (category: TaskCategory) => void;
}) {
  if (tasks.length === 0) return null;

  const urgencyDot: Record<string, string> = {
    HIGH: "bg-rose-500",
    MED: "bg-amber-400",
    LOW: "bg-emerald-400",
  };
  const categoryLabel: Record<TaskCategory, string> = {
    NO_SHOW:    "🔴 No-show",
    ONGOING:    "🦷 Tratamiento",
    GAP:        "🕳 Hueco",
    REPUTATION: "⭐ Reputación",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <span className="text-sm font-bold text-slate-900">Tareas por prioridad</span>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{tasks.length} pendientes</span>
      </div>
      <div className="divide-y divide-slate-50">
        {tasks.map((task, i) => (
          <div key={task.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group">
            <span className="text-xs font-bold text-slate-400 w-5 shrink-0 text-right">#{i + 1}</span>
            <span className={`h-2 w-2 rounded-full shrink-0 ${urgencyDot[task.urgency]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 truncate">{task.title}</p>
              <p className="text-xs text-slate-500 truncate">{task.detail}</p>
            </div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide shrink-0 hidden sm:block">
              {categoryLabel[task.category]}
            </span>
            <button
              type="button"
              onClick={() => onJump(task.category)}
              className="text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300 font-semibold shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              → Ver
            </button>
          </div>
        ))}
      </div>
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
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [blockedKeys, setBlockedKeys] = useState<Set<string>>(new Set());
  const [blockedMin, setBlockedMin] = useState(0);
  const [atRiskToday, setAtRiskToday] = useState<AtRiskAppt[]>([]);
  const [atRiskTomorrow, setAtRiskTomorrow] = useState<AtRiskAppt[]>([]);
  const [ongoingAlert, setOngoingAlert] = useState<OngoingPatient[]>([]);
  const [reputationAlerts, setReputationAlerts] = useState<ReputationAlert[]>([]);

  // Collapsible state — Block 1 open by default, others closed
  const [openUrgent,     setOpenUrgent]     = useState(true);
  const [openGaps,       setOpenGaps]       = useState(false);
  const [openOngoing,    setOpenOngoing]    = useState(false);
  const [openReputation, setOpenReputation] = useState(false);

  // Section refs for scroll-to
  const urgentRef     = useRef<HTMLDivElement>(null);
  const gapsRef       = useRef<HTMLDivElement>(null);
  const ongoingRef    = useRef<HTMLDivElement>(null);
  const reputationRef = useRef<HTMLDivElement>(null);

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
    setDismissed(new Set());
    setBlockedKeys(new Set());
    setBlockedMin(0);

    const tomorrowIso = DateTime.now().setZone("Europe/Madrid").plus({ days: 1 }).toISODate()!;

    try {
      const gapsUrl = `/api/db/gaps?staffId=${staffId}&week=${week}${clinicId ? `&clinicId=${clinicId}` : ""}`;
      const [gapsRes, todayRes, tomorrowRes, treatmentsRes, feedbackRes] = await Promise.all([
        fetch(gapsUrl, { cache: "no-store" }),
        fetch(`/api/db/today?staffId=${staffId}`, { cache: "no-store" }),
        fetch(`/api/db/today?staffId=${staffId}&date=${tomorrowIso}`, { cache: "no-store" }),
        fetch(`/api/db/ongoing-treatments?staffId=${staffId}`, { cache: "no-store" }),
        fetch(`/api/dashboard/feedback`, { cache: "no-store" }),
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
        // Sort by treatmentValue descending
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
    } catch (e: any) {
      setError(e.message ?? "Error al cargar tareas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (staffId && week) load();
  }, [staffId, week]);

  function dismissGap(key: string) {
    setDismissed((prev) => new Set(prev).add(key));
  }
  function markBlocked(key: string, durationMin: number) {
    setBlockedKeys((prev) => new Set(prev).add(key));
    setBlockedMin((prev) => prev + durationMin);
  }

  const todayIso = DateTime.now().setZone("Europe/Madrid").toISODate();
  const currentHour = DateTime.now().setZone("Europe/Madrid").hour;
  const isUrgentHour = currentHour < 10;

  const visibleGaps = data ? data.gaps.filter((g) => !dismissed.has(`${g.dayIso}-${g.start}`)) : [];
  const gapsByDay = visibleGaps.reduce<Record<string, Gap[]>>((acc, g) => {
    if (!acc[g.dayIso]) acc[g.dayIso] = [];
    acc[g.dayIso].push(g);
    return acc;
  }, {});

  // ── Build priority task list ──────────────────────────────────────────────

  const tasks: TaskItem[] = [];

  atRiskToday.forEach((a) => {
    tasks.push({
      id: `noshow-today-${a.recordId}`,
      urgencyScore: a.noShowRisk === "HIGH" ? 100 : 80,
      urgency: a.noShowRisk === "HIGH" ? "HIGH" : "MED",
      category: "NO_SHOW",
      title: a.patientName,
      detail: `${a.start} · ${a.treatmentName || "Cita"} · Sin confirmar HOY`,
      sub: `Riesgo ${a.noShowRisk === "HIGH" ? "ALTO" : "MEDIO"}`,
    });
  });

  reputationAlerts.forEach((r) => {
    tasks.push({
      id: `reputation-${r.patientName}`,
      urgencyScore: 90,
      urgency: "HIGH",
      category: "REPUTATION",
      title: r.patientName,
      detail: `${r.score}/5 estrellas · ${r.treatment} · hace ${r.hoursAgo}h`,
    });
  });

  ongoingAlert.forEach((p) => {
    tasks.push({
      id: `ongoing-${p.patientName}`,
      urgencyScore: 70,
      urgency: "HIGH",
      category: "ONGOING",
      title: p.patientName,
      detail: `${p.treatmentName} · ${p.lastVisitLabel} · Sin cita próxima`,
    });
  });

  atRiskTomorrow.forEach((a) => {
    tasks.push({
      id: `noshow-tom-${a.recordId}`,
      urgencyScore: 55,
      urgency: "MED",
      category: "NO_SHOW",
      title: a.patientName,
      detail: `${a.start} · ${a.treatmentName || "Cita"} · Sin confirmar MAÑANA`,
    });
  });

  visibleGaps.forEach((g) => {
    const isToday = g.dayIso === todayIso;
    tasks.push({
      id: `gap-${g.dayIso}-${g.start}`,
      urgencyScore: isToday ? 40 : 20,
      urgency: isToday ? "MED" : "LOW",
      category: "GAP",
      title: `Hueco ${g.start}–${g.end} · ${g.dayLabel}`,
      detail: `${g.durationMin} min libre · ${g.candidates.length} candidato${g.candidates.length !== 1 ? "s" : ""}`,
    });
  });

  tasks.sort((a, b) => b.urgencyScore - a.urgencyScore);

  // ── Header calculations ───────────────────────────────────────────────────

  const totalTasks = tasks.length;
  const completedCount = tasks.filter((t) => completedIds.has(t.id)).length;
  const progressPct = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  // Estimated €€ at stake: unconfirmed × €durationMin + gap potential + ongoing × treatmentValue
  const atRiskEur = atRiskToday.reduce((s, a) => s + a.durationMin, 0)
    + atRiskTomorrow.reduce((s, a) => s + a.durationMin, 0)
    + (data?.estimatedRevenueImpact ?? 0)
    + ongoingAlert.reduce((s, p) => s + (p.treatmentValue ?? 0), 0);

  // Estimated time to complete: ~5 min per task
  const estMinutes = tasks.length * 5;
  const estLabel = estMinutes >= 60
    ? `~${Math.floor(estMinutes / 60)}h ${estMinutes % 60 > 0 ? `${estMinutes % 60}min` : ""}`
    : `~${estMinutes} min`;

  // ── Jump to section ───────────────────────────────────────────────────────

  function jumpToSection(category: TaskCategory) {
    const refMap: Record<TaskCategory, { ref: React.RefObject<HTMLDivElement | null>; open: () => void }> = {
      NO_SHOW:    { ref: urgentRef,     open: () => setOpenUrgent(true)     },
      REPUTATION: { ref: reputationRef, open: () => setOpenReputation(true) },
      ONGOING:    { ref: ongoingRef,    open: () => setOpenOngoing(true)    },
      GAP:        { ref: gapsRef,       open: () => setOpenGaps(true)       },
    };
    const target = refMap[category];
    target.open();
    setTimeout(() => {
      target.ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

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

  const urgentCount = atRiskToday.length + atRiskTomorrow.length;

  return (
    <div className="space-y-4">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-700 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-violet-200 uppercase tracking-widest">Centro de operaciones · {staffName}</p>
            <h2 className="mt-1 text-3xl font-extrabold">{totalTasks} tareas</h2>
            <p className="text-sm text-violet-100 mt-0.5">
              {atRiskEur > 0
                ? <><span className="text-amber-300 font-bold">~€{atRiskEur.toLocaleString()} en juego</span> · {estLabel} para completar todo</>
                : "agenda al día — sin tareas urgentes"}
            </p>
          </div>
          <button type="button" onClick={load}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 border border-white/25 text-white hover:bg-white/30 shrink-0">
            Refrescar
          </button>
        </div>

        {/* Progress bar */}
        {totalTasks > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-violet-200">{completedCount}/{totalTasks} completadas</span>
              <span className="text-xs font-bold text-white">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/20">
              <div
                className="h-2 rounded-full bg-white transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-4 gap-2">
          <div className={`rounded-2xl border p-3 text-center ${urgentCount > 0 ? "bg-rose-500/30 border-rose-400/40" : "bg-white/15 border-white/20"}`}>
            <p className="text-lg font-extrabold">{urgentCount}</p>
            <p className="text-[10px] text-violet-200 mt-0.5">Urgente hoy</p>
          </div>
          <div className={`rounded-2xl border p-3 text-center ${visibleGaps.length > 0 ? "bg-sky-400/25 border-sky-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-lg font-extrabold">{visibleGaps.length}</p>
            <p className="text-[10px] text-violet-200 mt-0.5">Huecos</p>
          </div>
          <div className={`rounded-2xl border p-3 text-center ${ongoingAlert.length > 0 ? "bg-violet-500/30 border-violet-400/40" : "bg-white/15 border-white/20"}`}>
            <p className="text-lg font-extrabold">{ongoingAlert.length}</p>
            <p className="text-[10px] text-violet-200 mt-0.5">Tratamientos</p>
          </div>
          <div className={`rounded-2xl border p-3 text-center ${reputationAlerts.length > 0 ? "bg-orange-400/25 border-orange-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-lg font-extrabold">{reputationAlerts.length}</p>
            <p className="text-[10px] text-violet-200 mt-0.5">Reputación</p>
          </div>
        </div>
      </div>

      {/* ── Priority table ────────────────────────────────────────────── */}
      {tasks.length > 0 ? (
        <PriorityTable tasks={tasks} onJump={jumpToSection} />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
          <p className="text-sm text-slate-500">🎉 Sin tareas pendientes esta semana — agenda al día</p>
        </div>
      )}

      {/* ── Bloque 1: URGENTE HOY ─────────────────────────────────────── */}
      <CollapsibleSection
        icon="🔴"
        title="Urgente hoy"
        count={urgentCount}
        headerBg={urgentCount > 0 ? "bg-red-50 border-b border-red-100" : "bg-slate-50"}
        badgeColor="bg-red-100 text-red-700 border-red-200"
        isOpen={openUrgent}
        onToggle={() => setOpenUrgent((v) => !v)}
        sectionRef={urgentRef}
      >
        {urgentCount === 0 ? (
          <p className="text-xs text-slate-400 italic px-5 py-4">Sin citas en riesgo de no-show hoy ni mañana.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {atRiskToday.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-5 pt-3 pb-1">
                  <p className="text-xs font-semibold text-rose-600 uppercase tracking-widest">🔴 HOY — actúa ahora</p>
                  {isUrgentHour && <span className="text-[10px] text-rose-500 font-medium">⚠️ antes de las 10h</span>}
                </div>
                {atRiskToday.map((a) => <AtRiskRow key={a.recordId} appt={a} staffName={staffName} isUrgentHour={isUrgentHour} />)}
              </div>
            )}
            {atRiskTomorrow.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest px-5 pt-3 pb-1">🟡 MAÑANA — confirmar hoy</p>
                {atRiskTomorrow.map((a) => <AtRiskRow key={a.recordId} appt={a} staffName={staffName} />)}
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* ── Bloque 2: LLENAR AGENDA ───────────────────────────────────── */}
      <CollapsibleSection
        icon="🕳"
        title="Llenar agenda"
        count={visibleGaps.length}
        headerBg={visibleGaps.length > 0 ? "bg-sky-50 border-b border-sky-100" : "bg-slate-50"}
        badgeColor="bg-sky-100 text-sky-700 border-sky-200"
        isOpen={openGaps}
        onToggle={() => setOpenGaps((v) => !v)}
        sectionRef={gapsRef}
      >
        {visibleGaps.length === 0 ? (
          <p className="text-xs text-slate-400 italic px-5 py-4">
            {dismissed.size > 0
              ? `🎉 ${dismissed.size} franja${dismissed.size !== 1 ? "s" : ""} resuelta${dismissed.size !== 1 ? "s" : ""}`
              : "Sin franjas libres detectadas esta semana."}
          </p>
        ) : (
          <div className="p-4 space-y-6">
            {data && (
              <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                <span>{data.totalFreeMin} min libres</span>
                <span>·</span>
                <span className="text-sky-700 font-semibold">~€{data.estimatedRevenueImpact} potencial</span>
                {blockedMin > 0 && <><span>·</span><span className="text-emerald-600 font-semibold">€{Math.round(blockedMin / 60 * 60)} recuperados</span></>}
              </div>
            )}
            {Object.entries(gapsByDay).map(([dayIso, gaps]) => {
              const isToday = dayIso === todayIso;
              const dayStartIdx = Object.entries(gapsByDay).filter(([d]) => d < dayIso).reduce((s, [, gs]) => s + gs.length, 0) + 1;
              return (
                <div key={dayIso} className="space-y-3">
                  <p className={`text-xs font-semibold uppercase tracking-widest capitalize ${isToday ? "text-sky-700" : "text-slate-500"}`}>
                    {isToday ? "📅 Hoy — " : ""}{gaps[0].dayLabel}
                  </p>
                  <div className="space-y-2">
                    {gaps.map((gap, i) => (
                      <GapCard
                        key={`${gap.dayIso}-${gap.start}`}
                        gap={gap}
                        index={dayStartIdx + i}
                        staffName={staffName}
                        staffRecordId={staffRecordId}
                        onDismiss={() => dismissGap(`${gap.dayIso}-${gap.start}`)}
                        onBlocked={(key, dur) => markBlocked(key, dur)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* ── Bloque 3: TRATAMIENTOS ACTIVOS ───────────────────────────── */}
      <CollapsibleSection
        icon="🦷"
        title="Tratamientos activos"
        count={ongoingAlert.length}
        headerBg={ongoingAlert.length > 0 ? "bg-violet-50 border-b border-violet-100" : "bg-slate-50"}
        badgeColor="bg-violet-100 text-violet-700 border-violet-200"
        isOpen={openOngoing}
        onToggle={() => setOpenOngoing((v) => !v)}
        sectionRef={ongoingRef}
      >
        {ongoingAlert.length === 0 ? (
          <p className="text-xs text-slate-400 italic px-5 py-4">Sin pacientes con tratamiento activo sin cita próxima.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {ongoingAlert.map((p, i) => <OngoingRow key={i} patient={p} />)}
          </div>
        )}
      </CollapsibleSection>

      {/* ── Bloque 4: REPUTACIÓN ─────────────────────────────────────── */}
      <CollapsibleSection
        icon="⭐"
        title="Reputación"
        count={reputationAlerts.length}
        headerBg={reputationAlerts.length > 0 ? "bg-orange-50 border-b border-orange-100" : "bg-slate-50"}
        badgeColor="bg-orange-100 text-orange-700 border-orange-200"
        isOpen={openReputation}
        onToggle={() => setOpenReputation((v) => !v)}
        sectionRef={reputationRef}
      >
        {reputationAlerts.length === 0 ? (
          <p className="text-xs text-slate-400 italic px-5 py-4">Sin valoraciones bajas en las últimas 48h. ¡Todo bien!</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {reputationAlerts.map((r, i) => <ReputationRow key={i} alert={r} />)}
          </div>
        )}
      </CollapsibleSection>

      {/* ── Presupuestos — link to section ───────────────────────────── */}
      {onGoToSection && (
        <button
          type="button"
          onClick={() => onGoToSection("PRESUPUESTOS")}
          className="w-full flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">💶</span>
            <div>
              <p className="text-sm font-bold text-slate-900">Presupuestos pendientes</p>
              <p className="text-xs text-slate-500">Ver y gestionar en la sección Presupuestos</p>
            </div>
          </div>
          <span className="text-slate-400 text-sm shrink-0">→</span>
        </button>
      )}
    </div>
  );
}
