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
      `Se ha liberado una franja disponible el ${dayStr} a las ${timeStr} (${dur} min) ` +
      `para tu ${candidate.label}. ` +
      `¿Lo reservamos? Responde *SÍ* para confirmar o *NO* si no puedes.`
    );
  } else {
    return (
      `Hola ${candidate.patientName} 🙂 Desde la clínica queremos saber cómo estás ` +
      `y recordarte que tienes una revisión pendiente de ${candidate.label}. ` +
      `Tenemos una franja disponible el ${dayStr} a las ${timeStr} (${dur} min). ` +
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
  staffRecordId,
  onDismiss,
  onBlocked,
}: {
  gap: Gap;
  index: number;
  staffName: string;
  staffRecordId?: string;
  onDismiss: () => void;
  onBlocked: (key: string, durationMin: number) => void;
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

  const isPast = DateTime.fromISO(gap.startIso, { setZone: true })
    .setZone("Europe/Madrid")
    .diffNow("minutes").minutes < 0;

  function handleTypeChange(t: BlockType) {
    setBlockType(t);
    setBlockTitle(t);
  }

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

      const res = await fetch("/api/db/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 font-semibold">
        ✓ Franja bloqueada · se oculta en unos segundos
      </div>
    );
  }

  // Snap blockDuration to nearest 15min step within valid range
  const minDur = 15;
  const maxDur = gap.durationMin;
  const stepCount = Math.floor((maxDur - minDur) / 15);

  return (
    <div
      className={`rounded-2xl border bg-white ${
        isPast ? "border-slate-200 opacity-60" : "border-slate-200"
      }`}
    >
      {/* Collapsed header — always visible, click to expand */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-slate-50 rounded-2xl transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
            #{index}
          </span>
          <span className="text-sm font-semibold text-slate-900">
            {gap.start} – {gap.end}
          </span>
          <span className="text-xs text-slate-500">{gap.durationMin} min</span>
          {gap.candidates.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100">
              {gap.candidates.length} candidato{gap.candidates.length !== 1 ? "s" : ""}
            </span>
          )}
          {isPast && (
            <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
              Pasado
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="text-slate-300 hover:text-slate-500 text-sm leading-none"
            title="Descartar tarea"
          >
            ✕
          </button>
          <span className="text-slate-400 text-xs">{isOpen ? "▲" : "▾"}</span>
        </div>
      </button>

      {/* Expanded body */}
      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
          {/* Candidates */}
          {gap.candidates.length > 0 ? (
            <div className="space-y-0 pt-3">
              {gap.candidates.map((c, i) => (
                <CandidateRow
                  key={`${c.phone}-${i}`}
                  candidate={c}
                  gap={gap}
                  staffName={staffName}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic pt-3">
              Sin candidatos en lista de espera ni recall para esta franja.
            </p>
          )}

          {/* Block actions */}
          <div className="pt-1 border-t border-slate-100 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Sin paciente:</span>
              <button
                onClick={() => setBlockOpen((v) => !v)}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                  blockOpen
                    ? "border-violet-300 bg-violet-50 text-violet-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                ⏱ Reservar franja {blockOpen ? "▲" : "▾"}
              </button>
            </div>

            {blockOpen && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                {/* Tipo */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 font-medium">Tipo</label>
                  <select
                    value={blockType}
                    onChange={(e) => handleTypeChange(e.target.value as BlockType)}
                    className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  >
                    {BLOCK_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* Título */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 font-medium">Título</label>
                  <input
                    type="text"
                    value={blockTitle}
                    onChange={(e) => setBlockTitle(e.target.value)}
                    placeholder="Ej. Reunión con Dr. López"
                    className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>

                {/* Duración */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-500 font-medium">Duración</label>
                    <span className="text-xs font-semibold text-violet-700">{blockDuration} min</span>
                  </div>
                  {stepCount > 0 ? (
                    <input
                      type="range"
                      min={minDur}
                      max={maxDur}
                      step={15}
                      value={blockDuration}
                      onChange={(e) => setBlockDuration(Number(e.target.value))}
                      className="w-full accent-violet-600"
                    />
                  ) : (
                    <p className="text-xs text-slate-400 italic">Franja de {maxDur} min (fija)</p>
                  )}
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{minDur} min</span>
                    <span>{maxDur} min</span>
                  </div>
                </div>

                {/* Notas */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 font-medium">Notas <span className="font-normal">(opcionales)</span></label>
                  <textarea
                    rows={2}
                    value={blockNotes}
                    onChange={(e) => setBlockNotes(e.target.value)}
                    placeholder="Visible al abrir la cita en el calendario"
                    className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>

                {blockError && (
                  <p className="text-xs text-red-500">{blockError}</p>
                )}

                <button
                  onClick={handleBlock}
                  disabled={blockStatus === "blocking"}
                  className="w-full text-xs px-3 py-2 rounded-full bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50"
                >
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

// ── Progress Summary (sticky header) ────────────────────────────────────────

function ProgressSummary({
  data,
  dismissed,
  blockedKeys,
  blockedMin,
  staffName,
  onRefresh,
}: {
  data: Data | null;
  dismissed: Set<string>;
  blockedKeys: Set<string>;
  blockedMin: number;
  staffName: string;
  onRefresh: () => void;
}) {
  if (!data) return null;

  const totalGaps = data.gaps.length;
  const withCandidates = data.gaps.filter((g) => g.candidates.length > 0).length;
  const resolvedCount = dismissed.size;
  const blockedCount = blockedKeys.size;
  const pct = totalGaps > 0 ? Math.round((resolvedCount / totalGaps) * 100) : 0;
  const recoveredRevenue = Math.round((blockedMin / 60) * 60);

  return (
    <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-2 px-6 pt-4 pb-3 bg-white border-b border-slate-100 shadow-sm">
      {/* Top row */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Semana operativa · {staffName}
          </p>
          <p className="text-xs text-slate-500">
            {totalGaps} {totalGaps === 1 ? "franja" : "franjas"} ·{" "}
            {data.totalFreeMin} min libres ·{" "}
            <span className="font-medium text-amber-700">~€{data.estimatedRevenueImpact} en riesgo</span>
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50 shrink-0"
        >
          Refrescar
        </button>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">
            {resolvedCount} de {totalGaps} resueltos
          </span>
          <span className="font-semibold text-slate-700">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Stats chips */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-100">
          📋 {withCandidates} con candidatos
        </span>
        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">
          {totalGaps - withCandidates} sin candidatos
        </span>
        {blockedCount > 0 && (
          <>
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
              ⏱ {blockedMin} min cubiertos
            </span>
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
              💶 €{recoveredRevenue} recuperados
            </span>
          </>
        )}
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
}: {
  staffId: string;
  staffName: string;
  staffRecordId?: string;
  week: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [blockedKeys, setBlockedKeys] = useState<Set<string>>(new Set());
  const [blockedMin, setBlockedMin] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    setDismissed(new Set());
    setBlockedKeys(new Set());
    setBlockedMin(0);
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

  function dismissGap(key: string) {
    setDismissed((prev) => new Set(prev).add(key));
  }

  function markBlocked(key: string, durationMin: number) {
    setBlockedKeys((prev) => new Set(prev).add(key));
    setBlockedMin((prev) => prev + durationMin);
  }

  const visibleGaps = data
    ? data.gaps.filter((g) => !dismissed.has(`${g.dayIso}-${g.start}`))
    : [];

  const gapsByDay = visibleGaps.reduce<Record<string, Gap[]>>((acc, g) => {
    if (!acc[g.dayIso]) acc[g.dayIso] = [];
    acc[g.dayIso].push(g);
    return acc;
  }, {});

  const today = DateTime.now().setZone("Europe/Madrid").toISODate();

  return (
    <div className="space-y-5">
      {/* ── Hero gradient ─────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-700 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-violet-200 uppercase tracking-widest">Centro de operaciones</p>
            <h2 className="mt-1 text-3xl font-extrabold">
              {data ? data.gaps.length : "—"}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-violet-100">{data && data.gaps.length === 1 ? "franja disponible esta semana" : "franjas disponibles esta semana"}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 border border-white/25 text-white hover:bg-white/30 shrink-0"
          >
            Refrescar
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-violet-200 font-medium">Tiempo libre</p>
            <p className="text-xl font-extrabold mt-0.5">{data ? data.totalFreeMin : "—"} min</p>
          </div>
          <div className={`rounded-2xl border p-3 ${data && data.estimatedRevenueImpact > 0 ? "bg-amber-400/25 border-amber-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-xs text-violet-200 font-medium">Impacto estimado</p>
            <p className={`text-xl font-extrabold mt-0.5 ${data && data.estimatedRevenueImpact > 0 ? "text-amber-200" : ""}`}>
              €{data ? data.estimatedRevenueImpact : "—"}
            </p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-violet-200 font-medium">Lista de espera</p>
            <p className="text-xl font-extrabold mt-0.5">{data ? data.waitlistTotal : "—"}</p>
            <p className="text-[11px] text-violet-300 mt-0.5">candidatos activos</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-violet-200 font-medium">Recall</p>
            <p className="text-xl font-extrabold mt-0.5">{data ? data.recallTotal : "—"}</p>
            <p className="text-[11px] text-violet-300 mt-0.5">pacientes a recuperar</p>
          </div>
        </div>
      </div>

      {/* Sticky progress summary */}
      <ProgressSummary
        data={data}
        dismissed={dismissed}
        blockedKeys={blockedKeys}
        blockedMin={blockedMin}
        staffName={staffName}
        onRefresh={load}
      />

      {/* Content */}
      {loading ? (
        <p className="text-sm text-slate-500">Cargando tareas...</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !data || visibleGaps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">
            🎉 {dismissed.size > 0
              ? `${dismissed.size} ${dismissed.size === 1 ? "tarea resuelta" : "tareas resueltas"} — agenda gestionada`
              : `No hay franjas disponibles esta semana para ${staffName}`}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(gapsByDay).map(([dayIso, gaps]) => {
            const isToday = dayIso === today;
            const isFuture = dayIso > (today ?? "");
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
    </div>
  );
}
