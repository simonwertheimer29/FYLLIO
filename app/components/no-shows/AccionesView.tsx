"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  NoShowsUserSession,
  RiskyAppt,
  GapSlot,
  RecallAlert,
  AccionTask,
} from "../../lib/no-shows/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type AccionesData = {
  tasks: AccionTask[];
  canceladosHoy: RiskyAppt[];
  proximosDias: RiskyAppt[];
  recalls: RecallAlert[];
  summary: { total: number; urgent: number; pending: number };
};

type StaffEntry   = { id: string; nombre: string };
type ClinicaEntry = { id: string; nombre: string; recordId: string };
type ToneType     = "urgente" | "cordial" | "motivacional";
type BottomTab    = "riesgo" | "huecos";

type UnifiedItem =
  | { type: "appt"; id: string; scoreAccion: number; hoursUntil: number; data: RiskyAppt; task: AccionTask }
  | { type: "gap";  id: string; scoreAccion: number; hoursUntil: number; data: GapSlot; task: AccionTask; overbooking: boolean; recalls: RecallAlert[] };

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getTodayIso(): string { return new Date().toISOString().slice(0, 10); }

function getTomorrowIso(): string {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWA(phone: string, msg: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
}

function dayLabel(dayIso: string, todayIso: string, tomorrowIso: string): string {
  if (dayIso === todayIso) return "HOY";
  if (dayIso === tomorrowIso) return "MAÑANA";
  const d = new Date(dayIso + "T12:00:00Z");
  const days   = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function dayBadgeClass(label: string): string {
  if (label === "HOY")    return "bg-red-100 text-red-700";
  if (label === "MAÑANA") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function scoreBorderColor(score: number): string {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 40) return "#3b82f6";
  return "#94a3b8";
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "bg-red-50 text-red-700 border-red-200";
  if (score >= 60) return "bg-orange-50 text-orange-700 border-orange-200";
  if (score >= 40) return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

function contextualRec(appt: RiskyAppt, todayIso: string, tomorrowIso: string): string {
  const isToday    = appt.dayIso === todayIso;
  const isTomorrow = appt.dayIso === tomorrowIso;
  if (appt.riskLevel === "HIGH" && isToday)    return "Llama ahora. Si no responde, deja mensaje de voz.";
  if (appt.riskLevel === "HIGH" && isTomorrow) return "Envía WA esta tarde antes de las 18:00";
  if (appt.riskLevel === "MEDIUM" && isTomorrow) return "WA recordatorio cordial es suficiente";
  return "Contactar en los próximos 2 días";
}

// ─── IA Panel ─────────────────────────────────────────────────────────────────

function IaSection({
  appt,
  tone,
}: {
  appt: RiskyAppt;
  tone: ToneType;
}) {
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState("");
  const [error,   setError]   = useState("");
  const [generated, setGenerated] = useState(false);

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/no-shows/acciones/generar-mensaje", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientName:   appt.patientName,
          treatmentName: appt.treatmentName,
          riskScore:     appt.riskScore,
          riskLevel:     appt.riskLevel,
          category:      "NO_SHOW",
          hora:          appt.startDisplay,
          tone,
        }),
      });
      const data = await res.json();
      if (data.mensaje) { setMsg(data.mensaje); setGenerated(true); }
      else setError(data.error ?? "Error al generar");
    } catch { setError("Error de red"); }
    finally  { setLoading(false); }
  }

  const waLink = msg && appt.patientPhone ? buildWA(appt.patientPhone, msg) : null;

  return (
    <div className="space-y-2">
      {!generated && !loading && (
        <button
          onClick={generate}
          className="text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5 hover:bg-violet-100 transition-colors"
        >
          ✦ Generar mensaje IA
        </button>
      )}
      {loading && <p className="text-xs text-violet-400 animate-pulse">Generando…</p>}
      {error && !loading && <p className="text-xs text-red-500">{error}</p>}
      {generated && !loading && msg && (
        <>
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={3}
            className="w-full text-xs rounded-lg border border-violet-200 px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-300 resize-none bg-white"
          />
          <div className="flex items-center gap-2 flex-wrap">
            {waLink && (
              <a href={waLink} target="_blank" rel="noopener noreferrer"
                className="text-xs font-semibold text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg transition-colors">
                Enviar WA
              </a>
            )}
            {appt.patientPhone && (
              <a href={`tel:${appt.patientPhone}`}
                className="text-xs font-semibold border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
                Llamar
              </a>
            )}
            <button onClick={() => navigator.clipboard.writeText(msg).catch(() => {})}
              className="text-xs text-slate-500 hover:text-slate-700 transition-colors">
              Copiar
            </button>
            <button onClick={() => { setMsg(""); setGenerated(false); generate(); }}
              className="text-xs text-violet-500 hover:text-violet-700 transition-colors">
              Regenerar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── RegisterForm ─────────────────────────────────────────────────────────────

function RegisterForm({
  recordId,
  onDone,
}: {
  recordId: string;
  onDone: () => void;
}) {
  const [tipo,       setTipo]       = useState("");
  const [fase,       setFase]       = useState("");
  const [notas,      setNotas]      = useState("");
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [error,      setError]      = useState("");

  async function handleRegister() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/no-shows/acciones/registrar", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordId, tipo, fase, notas }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      setSaved(true);
    } catch (e: any) {
      setError(e?.message ?? "Error al registrar");
    } finally { setSaving(false); }
  }

  if (saved) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
          ✓ Acción registrada
        </span>
        <button onClick={onDone}
          className="text-xs text-slate-500 hover:text-slate-700 transition-colors">
          ✓ Marcar contactado
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}
          className="flex-1 text-xs rounded-lg border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-300">
          <option value="">Tipo de acción…</option>
          <option value="WhatsApp">WhatsApp</option>
          <option value="Llamada">Llamada</option>
          <option value="Sin respuesta">Sin respuesta</option>
          <option value="Confirmado">Confirmado</option>
          <option value="Cancelado">Cancelado</option>
        </select>
        <select value={fase} onChange={(e) => setFase(e.target.value)}
          className="flex-1 text-xs rounded-lg border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-300">
          <option value="">Fase…</option>
          <option value="Sin iniciar">Sin iniciar</option>
          <option value="72h">72h</option>
          <option value="48h">48h</option>
          <option value="24h">24h</option>
          <option value="Completado">Completado</option>
        </select>
      </div>
      <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)}
        placeholder="Notas (opcional)…"
        className="w-full text-xs rounded-lg border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-300"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={handleRegister} disabled={saving || !tipo}
          className="text-xs font-semibold bg-cyan-600 text-white px-3 py-1.5 rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50">
          {saving ? "Guardando…" : "Registrar acción"}
        </button>
        <button onClick={onDone}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
          ✓ Solo marcar contactado
        </button>
      </div>
    </div>
  );
}

// ─── UnifiedCard ──────────────────────────────────────────────────────────────

function UnifiedCard({
  item,
  staffById,
  done,
  onDone,
  todayIso,
  tomorrowIso,
}: {
  item: UnifiedItem;
  staffById: Record<string, string>;
  done: boolean;
  onDone: (id: string) => void;
  todayIso: string;
  tomorrowIso: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tone, setTone]         = useState<ToneType>("cordial");

  // ── GAP card ──────────────────────────────────────────────────────────────
  if (item.type === "gap") {
    const { data: gap, overbooking, recalls } = item;
    const dLabel = dayLabel(gap.dayIso, todayIso, tomorrowIso);
    const candidates = recalls.slice(0, 3);

    return (
      <div className={`rounded-xl bg-white border border-slate-200 overflow-hidden transition-opacity ${done ? "opacity-40" : ""}`}>
        <div className="p-3 flex items-start gap-2" style={{ borderLeft: `3px solid #10b981` }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              <span className="text-sm font-bold text-slate-700">{gap.startDisplay}–{gap.endDisplay}</span>
              <span className="text-xs text-slate-400">{gap.durationMin} min</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${dayBadgeClass(dLabel)}`}>{dLabel}</span>
              {overbooking && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
                  ⚡ Reschedulable
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400">Hueco disponible</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!done && (
              <button onClick={() => setExpanded((o) => !o)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 text-[10px] transition-colors">
                {expanded ? "▲" : "▼"}
              </button>
            )}
            {!done && (
              <button onClick={() => onDone(item.id)}
                className="p-1.5 rounded-xl border border-slate-200 text-slate-400 text-[10px] hover:bg-slate-50 transition-colors">
                ✓
              </button>
            )}
          </div>
        </div>

        {expanded && !done && (
          <div className="border-t border-slate-100 px-3 pb-3">
            {candidates.length > 0 ? (
              <>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-2 mb-1.5">Candidatos sugeridos</p>
                <div className="space-y-1.5">
                  {candidates.map((r) => (
                    <div key={r.patientPhone} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg bg-slate-50">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-700 truncate">{r.patientName}</p>
                        <p className="text-[10px] text-slate-400 truncate">{r.treatmentName} · {r.weeksSinceLast} sem sin cita</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {r.patientPhone && (
                          <a href={buildWA(r.patientPhone, `Hola ${r.patientName.split(" ")[0]}, tenemos un hueco disponible ${dLabel.toLowerCase()} a las ${gap.startDisplay}. ¿Te interesa agendar tu próxima sesión de ${r.treatmentName}?`)}
                            target="_blank" rel="noopener noreferrer"
                            className="p-1 rounded-lg bg-green-600 text-white text-[10px] font-bold hover:bg-green-700 transition-colors">WA</a>
                        )}
                        {r.patientPhone && (
                          <a href={`tel:${r.patientPhone}`}
                            className="p-1 rounded-lg border border-slate-200 text-slate-600 text-[10px] hover:bg-slate-50 transition-colors">Tel</a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[10px] text-slate-400 mt-2">Sin candidatos disponibles</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── APPT card ─────────────────────────────────────────────────────────────
  const { data: appt, scoreAccion } = item;
  const dLabel      = dayLabel(appt.dayIso, todayIso, tomorrowIso);
  const borderColor = scoreBorderColor(scoreAccion);
  const badgeClass  = scoreBadgeClass(appt.riskScore);
  const doctorNombre = appt.profesionalId
    ? (staffById[appt.profesionalId] ?? appt.doctorNombre ?? appt.doctor)
    : (appt.doctorNombre ?? appt.doctor);
  const rec = contextualRec(appt, todayIso, tomorrowIso);

  return (
    <div className={`rounded-xl bg-white border border-slate-100 overflow-hidden transition-opacity ${done ? "opacity-40" : ""}`}>
      {/* Cabecera */}
      <div
        className="flex items-start gap-3 p-3 cursor-pointer"
        style={{ borderLeft: `3px solid ${borderColor}` }}
        onClick={() => !done && setExpanded((o) => !o)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-slate-800 truncate">{appt.patientName}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${badgeClass}`}>
              {appt.riskScore}
            </span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${dayBadgeClass(dLabel)}`}>
              {dLabel}
            </span>
            {!appt.confirmed && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                Sin confirmar
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">{appt.treatmentName}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {appt.startDisplay}{doctorNombre ? ` · ${doctorNombre}` : ""}
          </p>
        </div>
        {!done && (
          <span className="text-slate-400 text-[10px] shrink-0 pt-0.5">{expanded ? "▲" : "▼"}</span>
        )}
        {done && (
          <span className="text-green-600 text-xs shrink-0">✓</span>
        )}
      </div>

      {/* Panel expandido */}
      {expanded && !done && (
        <div className="border-t border-slate-100 px-3 pb-3 space-y-3">

          {/* Historial */}
          <div className="pt-2">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Historial</p>
            <p className="text-xs text-slate-600">
              {appt.riskFactors.historicalNoShowCount > 0
                ? `${appt.riskFactors.historicalNoShowCount} no-show · ${appt.riskFactors.historicalCancelCount} cancelaciones · ${appt.riskFactors.historicalTotalAppts} visitas`
                : appt.riskFactors.historicalTotalAppts === 0
                  ? "Sin historial previo"
                  : `${appt.riskFactors.historicalTotalAppts} visitas sin no-shows`
              }
            </p>
          </div>

          <div className="h-px bg-slate-100" />

          {/* Tono + IA */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Mensaje</p>
            <div className="flex gap-1.5 mb-2">
              {(["urgente", "cordial", "motivacional"] as ToneType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-lg capitalize transition-colors ${
                    tone === t
                      ? "bg-violet-100 text-violet-700 border border-violet-200"
                      : "border border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <IaSection appt={appt} tone={tone} />
          </div>

          <div className="h-px bg-slate-100" />

          {/* Recomendación */}
          <div className="rounded-lg bg-cyan-50 border border-cyan-100 px-3 py-2">
            <p className="text-[10px] font-bold text-cyan-700 uppercase tracking-wider mb-0.5">Recomendación</p>
            <p className="text-xs text-cyan-800">{rec}</p>
          </div>

          <div className="h-px bg-slate-100" />

          {/* Registro de acción */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Registrar acción</p>
            <RegisterForm recordId={appt.id} onDone={() => onDone(appt.id)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccionesView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";

  const [data,                setData]                = useState<AccionesData | null>(null);
  const [loading,             setLoading]             = useState(true);
  const [clinicaFilter,       setClinicaFilter]       = useState("");
  const [profesionalFilter,   setProfesionalFilter]   = useState("");
  const [clinicasDisponibles, setClinicasDisponibles] = useState<ClinicaEntry[]>([]);
  const [staffPorClinica,     setStaffPorClinica]     = useState<Record<string, StaffEntry[]>>({});
  const [staffById,           setStaffById]           = useState<Record<string, string>>({});
  const [bottomTab,           setBottomTab]           = useState<BottomTab>("riesgo");
  const [done, setDone] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem("fyllio_acciones_done") ?? "[]")); }
    catch { return new Set(); }
  });

  const todayIso    = getTodayIso();
  const tomorrowIso = getTomorrowIso();

  const load = useCallback(async (clinica?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/acciones", location.href);
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(clinicaFilter || undefined); }, [load, clinicaFilter]);

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
        const byClinica: Record<string, StaffEntry[]> = {};
        const byId: Record<string, string> = {};
        for (const s of (d.staff ?? [])) {
          byId[s.id] = s.nombre;
          if (!s.clinicaRecordId) continue;
          if (s.rol && String(s.rol).toLowerCase().includes("recep")) continue;
          if (!byClinica[s.clinicaRecordId]) byClinica[s.clinicaRecordId] = [];
          byClinica[s.clinicaRecordId].push({ id: s.id, nombre: s.nombre });
        }
        setStaffPorClinica(byClinica);
        setStaffById(byId);
      }
    }
    loadMeta();
  }, []);

  function markDone(id: string) {
    const next = new Set(done);
    next.add(id);
    setDone(next);
    try { localStorage.setItem("fyllio_acciones_done", JSON.stringify([...next])); } catch { /* */ }
  }

  function handleClinicaChange(c: string) {
    setClinicaFilter(c);
    setProfesionalFilter("");
  }

  // ── Derived: unifiedItems ──────────────────────────────────────────────────

  function profMatchesAppt(appt: RiskyAppt): boolean {
    if (!profesionalFilter) return true;
    return appt.profesionalId === profesionalFilter || appt.doctor === profesionalFilter;
  }

  const allTasks    = data?.tasks ?? [];
  const allRecalls  = data?.recalls ?? [];

  const apptItems: UnifiedItem[] = allTasks
    .filter((t) => t.category === "NO_SHOW" && t.appt && profMatchesAppt(t.appt))
    .map((t) => ({
      type:        "appt" as const,
      id:          t.id,
      scoreAccion: t.scoreAccion ?? t.appt!.riskScore,
      hoursUntil:  t.hoursUntil ?? 99,
      data:        t.appt!,
      task:        t,
    }));

  const clinicaRecordId = clinicaFilter
    ? (clinicasDisponibles.find((c) => c.id === clinicaFilter)?.recordId ?? "")
    : "";
  const filteredRecalls = clinicaFilter
    ? allRecalls.filter((r) => !r.clinica || r.clinica === clinicaFilter)
    : allRecalls;

  const gapItems: UnifiedItem[] = allTasks
    .filter((t) => t.category === "GAP" && t.gap)
    .map((t) => ({
      type:        "gap" as const,
      id:          t.id,
      scoreAccion: t.scoreAccion ?? 50,
      hoursUntil:  t.hoursUntil ?? 99,
      data:        t.gap!,
      task:        t,
      overbooking: t.overbooking ?? false,
      recalls:     filteredRecalls,
    }));

  const allItems: UnifiedItem[] = [...apptItems, ...gapItems];

  const urgenteItems = allItems
    .filter((i) => i.scoreAccion >= 70 || i.hoursUntil < 24)
    .sort((a, b) => b.scoreAccion - a.scoreAccion);

  const semanaItems = allItems
    .filter((i) => {
      const apptScore = i.type === "appt" ? i.data.riskScore : 50;
      return apptScore >= 30 && i.hoursUntil >= 24 && i.hoursUntil <= 120;
    })
    .sort((a, b) => b.scoreAccion - a.scoreAccion);

  // ── Metrics ──────────────────────────────────────────────────────────────

  const totalCount    = urgenteItems.length + semanaItems.length;
  const contactados   = [...urgenteItems, ...semanaItems].filter((i) => done.has(i.id)).length;
  const pendingCount  = totalCount - contactados;
  const progreso      = totalCount > 0 ? Math.round((contactados / totalCount) * 100) : 0;
  const urgentesVivos = urgenteItems.filter((i) => i.type === "appt" && !done.has(i.id)).length;
  const euroEnJuego   = urgentesVivos * 80;

  // ── Profesionales ─────────────────────────────────────────────────────────

  const allProfesionales = Object.values(staffPorClinica).flat();
  const profesionalesDisponibles = clinicaFilter && clinicaRecordId
    ? (staffPorClinica[clinicaRecordId] ?? [])
    : allProfesionales;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full max-w-md">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-slate-100 rounded-xl" />)}
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

  // ── Bottom tables data ────────────────────────────────────────────────────

  const proximosDias = (data.proximosDias ?? []).filter(profMatchesAppt);
  const gapTasksAll  = allTasks.filter((t) => t.category === "GAP" && t.gap);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 w-full">

      {/* ── Header ── */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">ACCIONES HOY</p>
            <p className="text-base font-extrabold text-slate-900 leading-tight mt-0.5">
              {pendingCount} acciones pendientes{euroEnJuego > 0 ? ` · €${euroEnJuego.toLocaleString()} en juego` : ""}
            </p>
          </div>
          <button
            onClick={() => load(clinicaFilter || undefined)}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
          >
            ↻ Actualizar
          </button>
        </div>

        {/* Progress bar */}
        <div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-500 rounded-full transition-all duration-500"
              style={{ width: `${progreso}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>{contactados} contactados</span>
            <span>{progreso}% completado</span>
          </div>
        </div>

        {/* Filtros */}
        {isManager && clinicasDisponibles.length > 0 && (
          <div className="flex gap-2">
            <select
              value={clinicaFilter}
              onChange={(e) => handleClinicaChange(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
            >
              <option value="">Todas las clínicas</option>
              {clinicasDisponibles.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            {profesionalesDisponibles.length > 0 && (
              <select
                value={profesionalFilter}
                onChange={(e) => setProfesionalFilter(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
              >
                <option value="">Todos</option>
                {profesionalesDisponibles.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* ── Dos columnas ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {/* Col izquierda: URGENTE HOY */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider">
              Urgente Hoy
            </h3>
            {urgenteItems.filter((i) => !done.has(i.id)).length > 0 && (
              <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                {urgenteItems.filter((i) => !done.has(i.id)).length}
              </span>
            )}
          </div>

          {urgenteItems.length === 0 ? (
            <div className="rounded-xl bg-white border border-slate-100 py-8 text-center">
              <p className="text-xl mb-1">✓</p>
              <p className="text-sm text-slate-400">Sin urgencias hoy</p>
            </div>
          ) : (
            [
              ...urgenteItems.filter((i) => !done.has(i.id)),
              ...urgenteItems.filter((i) =>  done.has(i.id)),
            ].map((item) => (
              <UnifiedCard
                key={item.id}
                item={item}
                staffById={staffById}
                done={done.has(item.id)}
                onDone={markDone}
                todayIso={todayIso}
                tomorrowIso={tomorrowIso}
              />
            ))
          )}
        </section>

        {/* Col derecha: ESTA SEMANA */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Esta Semana
            </h3>
            {semanaItems.filter((i) => !done.has(i.id)).length > 0 && (
              <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                {semanaItems.filter((i) => !done.has(i.id)).length}
              </span>
            )}
          </div>

          {semanaItems.length === 0 ? (
            <div className="rounded-xl bg-white border border-slate-100 py-8 text-center">
              <p className="text-xl mb-1">✓</p>
              <p className="text-sm text-slate-400">Sin pendientes esta semana</p>
            </div>
          ) : (
            [
              ...semanaItems.filter((i) => !done.has(i.id)),
              ...semanaItems.filter((i) =>  done.has(i.id)),
            ].map((item) => (
              <UnifiedCard
                key={item.id}
                item={item}
                staffById={staffById}
                done={done.has(item.id)}
                onDone={markDone}
                todayIso={todayIso}
                tomorrowIso={tomorrowIso}
              />
            ))
          )}
        </section>
      </div>

      {/* ── Tablas resumen al fondo ── */}
      {(proximosDias.length > 0 || gapTasksAll.length > 0) && (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-slate-100">
            {[
              { id: "riesgo" as BottomTab, label: `Riesgo semana (${proximosDias.length})` },
              { id: "huecos" as BottomTab, label: `Huecos (${gapTasksAll.length})` },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setBottomTab(id)}
                className={`px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                  bottomTab === id
                    ? "border-cyan-500 text-cyan-700 bg-cyan-50"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab: Pacientes riesgo semana */}
          {bottomTab === "riesgo" && (
            <div className="overflow-x-auto">
              {proximosDias.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Sin citas de riesgo esta semana</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                      <th className="px-4 py-2">Paciente</th>
                      <th className="px-4 py-2">Tratamiento</th>
                      <th className="px-4 py-2">Día</th>
                      <th className="px-4 py-2">Hora</th>
                      <th className="px-4 py-2 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proximosDias.map((a) => (
                      <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 font-medium text-slate-800">{a.patientName}</td>
                        <td className="px-4 py-2 text-slate-500 max-w-[140px] truncate">{a.treatmentName}</td>
                        <td className="px-4 py-2 text-slate-500">
                          {dayLabel(a.dayIso, todayIso, tomorrowIso)}
                        </td>
                        <td className="px-4 py-2 text-slate-500">{a.startDisplay}</td>
                        <td className="px-4 py-2 text-right">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${scoreBadgeClass(a.riskScore)}`}>
                            {a.riskScore}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab: Huecos */}
          {bottomTab === "huecos" && (
            <div className="overflow-x-auto">
              {gapTasksAll.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Sin huecos registrados</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                      <th className="px-4 py-2">Día</th>
                      <th className="px-4 py-2">Hora inicio</th>
                      <th className="px-4 py-2">Duración</th>
                      <th className="px-4 py-2">Candidatos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gapTasksAll.map((t) => {
                      const g = t.gap!;
                      const cands = filteredRecalls.slice(0, 2);
                      return (
                        <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-2 text-slate-500">{dayLabel(g.dayIso, todayIso, tomorrowIso)}</td>
                          <td className="px-4 py-2 font-medium text-slate-800">{g.startDisplay}</td>
                          <td className="px-4 py-2 text-slate-500">{g.durationMin} min</td>
                          <td className="px-4 py-2 text-slate-400">
                            {cands.length > 0
                              ? cands.map((r) => r.patientName.split(" ")[0]).join(", ")
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
