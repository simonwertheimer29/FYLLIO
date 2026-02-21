"use client";

import { useEffect, useState } from "react";

type Patient = {
  patientName: string;
  phone: string;
  treatmentName: string;
  totalVisits: number;
  lastVisitDisplay: string;
  daysSinceLastVisit: number;
  nextVisitDisplay: string | null;
  weeksSinceLastVisit: number;
  alertThresholdWeeks: number;
  status: "OK" | "WARN" | "ALERT";
};

type Data = {
  patients: Patient[];
  alertCount: number;
  warnCount: number;
  total: number;
};

type SendStatus = "idle" | "sending" | "sent" | "error";

const STATUS_CONFIG = {
  ALERT: {
    dot: "bg-rose-500",
    badge: "text-rose-700 bg-rose-50 border-rose-200",
    label: "Sin cita programada",
    row: "bg-rose-50/40",
  },
  WARN: {
    dot: "bg-amber-400",
    badge: "text-amber-700 bg-amber-50 border-amber-200",
    label: "Próxima cita tarde",
    row: "bg-amber-50/30",
  },
  OK: {
    dot: "bg-emerald-400",
    badge: "text-emerald-700 bg-emerald-50 border-emerald-200",
    label: "Al día",
    row: "",
  },
};

function ContactButton({ patient }: { patient: Patient }) {
  const [status, setStatus] = useState<SendStatus>("idle");

  if (!patient.phone) return null;

  const message =
    `Hola ${patient.patientName.split(" ")[0]} 🙂 Te escribimos desde la clínica. ` +
    `Estamos haciendo seguimiento de tu tratamiento de ${patient.treatmentName}. ` +
    `¿Cómo estás? ¿Has podido venir últimamente? ` +
    `Nos gustaría programar tu próxima revisión. ¿Cuándo te viene bien?`;

  async function handleSend() {
    if (!confirm(`Enviar recordatorio a ${patient.patientName}?\n\n"${message}"`)) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: patient.phone, message }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <span className="text-xs text-emerald-600 font-semibold px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200">
        ✓ Enviado
      </span>
    );
  }
  if (status === "error") {
    return <span className="text-xs text-red-500">Error</span>;
  }
  return (
    <button
      onClick={handleSend}
      disabled={status === "sending"}
      className="text-xs px-3 py-1.5 rounded-full bg-rose-600 text-white font-semibold hover:bg-rose-700 disabled:opacity-50 shrink-0"
    >
      {status === "sending" ? "Enviando..." : "💬 Recordar"}
    </button>
  );
}

export default function OngoingTreatmentsPanel({ staffId }: { staffId?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "ALERT" | "WARN">("ALL");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/db/ongoing-treatments${staffId ? `?staffId=${staffId}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setError(e.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [staffId]);

  const visible = data
    ? data.patients.filter((p) => filter === "ALL" || p.status === filter)
    : [];

  return (
    <div className="space-y-5">

      {/* ── Hero gradient ─────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-rose-600 to-pink-700 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-rose-200 uppercase tracking-widest">Tratamientos en curso</p>
            <h2 className="mt-1 text-3xl font-extrabold">
              {loading ? "—" : data?.total ?? 0}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-rose-100">pacientes con tratamiento activo detectado</span>
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

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className={`rounded-2xl border p-3 ${data && data.alertCount > 0 ? "bg-rose-500/30 border-rose-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-xs text-rose-200 font-medium">🔴 Sin cita</p>
            <p className="text-xl font-extrabold mt-0.5">{loading ? "—" : data?.alertCount ?? 0}</p>
            <p className="text-[11px] text-rose-300 mt-0.5">necesitan programar ya</p>
          </div>
          <div className={`rounded-2xl border p-3 ${data && data.warnCount > 0 ? "bg-amber-400/25 border-amber-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-xs text-rose-200 font-medium">🟡 Atención</p>
            <p className={`text-xl font-extrabold mt-0.5 ${data && data.warnCount > 0 ? "text-amber-200" : ""}`}>
              {loading ? "—" : data?.warnCount ?? 0}
            </p>
            <p className="text-[11px] text-rose-300 mt-0.5">próxima cita tardía</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-rose-200 font-medium">🟢 Al día</p>
            <p className="text-xl font-extrabold mt-0.5">
              {loading ? "—" : (data ? data.total - (data.alertCount + data.warnCount) : 0)}
            </p>
            <p className="text-[11px] text-rose-300 mt-0.5">con cita programada</p>
          </div>
        </div>
      </div>

      {/* ── How it works ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-700">¿Cómo funciona el tracker?</p>
        <ul className="mt-2 space-y-1 text-xs text-slate-500 list-disc pl-4">
          <li>Detecta automáticamente pacientes con tratamientos multi-sesión (ortodoncia, implantes, periodoncia, endodoncia)</li>
          <li>🔴 Alerta cuando llevan demasiado tiempo sin visita y no tienen próxima cita programada</li>
          <li>🟡 Aviso cuando la próxima cita está muy lejos del intervalo recomendado</li>
          <li>Umbrales: Ortodoncia 8 sem · Implante 6 sem · Periodoncia 10 sem · Endodoncia 4 sem</li>
        </ul>
      </div>

      {/* ── Filter tabs ───────────────────────────────────────────── */}
      {data && data.total > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {(["ALL", "ALERT", "WARN"] as const).map((f) => {
            const count = f === "ALL" ? data.total : f === "ALERT" ? data.alertCount : data.warnCount;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                  filter === f
                    ? f === "ALERT"
                      ? "bg-rose-600 text-white border-rose-600"
                      : f === "WARN"
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-slate-800 text-white border-slate-800"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f === "ALL" ? `Todos (${count})` : f === "ALERT" ? `🔴 Sin cita (${count})` : `🟡 Atención (${count})`}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Patient list ──────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-slate-100" />)}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
      ) : !data || data.total === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">No se detectaron tratamientos en curso activos.<br />El sistema analiza citas con ortodoncia, implantes, periodoncia y endodoncia.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
          <p className="text-sm text-slate-500">Sin pacientes en esta categoría.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">
              {visible.length} paciente{visible.length !== 1 ? "s" : ""} · ordenados por urgencia
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {visible.map((p, i) => {
              const cfg = STATUS_CONFIG[p.status];
              return (
                <div key={`${p.phone || p.patientName}-${p.treatmentName}-${i}`}
                  className={`flex items-start justify-between gap-3 px-4 py-3 flex-wrap ${cfg.row}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className={`h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
                      <span className="text-sm font-semibold text-slate-900">{p.patientName}</span>
                      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
                        {p.treatmentName}
                      </span>
                      {p.status !== "OK" && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {p.totalVisits} {p.totalVisits === 1 ? "sesión" : "sesiones"} ·
                      última: {p.lastVisitDisplay} ({p.weeksSinceLastVisit} sem)
                      {p.nextVisitDisplay
                        ? <span className="ml-1 text-emerald-600 font-medium">· próxima: {p.nextVisitDisplay}</span>
                        : <span className="ml-1 text-rose-600 font-medium"> · sin próxima cita</span>
                      }
                    </p>
                  </div>
                  {p.status === "ALERT" && <ContactButton patient={p as any} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
