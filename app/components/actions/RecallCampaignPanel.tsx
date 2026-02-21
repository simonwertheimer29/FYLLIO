"use client";

import { useEffect, useState } from "react";

type Patient = {
  name: string;
  phone: string;
  lastVisit: string;
  lastVisitDisplay: string;
  lastTreatment: string;
  daysSinceVisit: number;
};

type SendStatus = "idle" | "sending" | "sent" | "error";

function priorityConfig(days: number) {
  if (days >= 270) return { dot: "bg-rose-500", badge: "text-rose-700 bg-rose-50 border-rose-200", label: "+9 meses" };
  if (days >= 180) return { dot: "bg-amber-400", badge: "text-amber-700 bg-amber-50 border-amber-200", label: "6-9 meses" };
  return { dot: "bg-slate-300", badge: "text-slate-500 bg-slate-50 border-slate-200", label: "<6 meses" };
}

function buildRecallMessage(patient: Patient): string {
  return (
    `Hola ${patient.name.split(" ")[0]} 🙂 Desde la clínica te echamos de menos. ` +
    `Hace tiempo que no te vemos y queremos saber cómo estás. ` +
    (patient.lastTreatment ? `Tu última visita fue para ${patient.lastTreatment}. ` : "") +
    `¿Te apetece venir a una revisión? Tenemos huecos disponibles esta semana. Solo escríbenos o responde aquí y te buscamos un hueco.`
  );
}

function PatientRow({ patient, onSent }: { patient: Patient; onSent: () => void }) {
  const [status, setStatus] = useState<SendStatus>("idle");
  const [showMsg, setShowMsg] = useState(false);
  const message = buildRecallMessage(patient);
  const priority = priorityConfig(patient.daysSinceVisit);

  async function handleSend() {
    if (!patient.phone) return;
    if (!confirm(`Enviar WhatsApp a ${patient.name}?\n\n"${message}"`)) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: patient.phone, message }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("sent");
      onSent();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-t border-slate-100 first:border-t-0 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`h-2 w-2 rounded-full shrink-0 ${priority.dot}`} />
          <span className="text-sm font-semibold text-slate-900">{patient.name}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${priority.badge}`}>
            {priority.label}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {patient.daysSinceVisit} días sin visita · última: {patient.lastVisitDisplay}
          {patient.lastTreatment && ` · ${patient.lastTreatment}`}
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
        {!patient.phone ? (
          <span className="text-xs text-slate-400 italic">Sin teléfono</span>
        ) : status === "sent" ? (
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
            className="text-xs px-3 py-1.5 rounded-full bg-orange-600 text-white font-semibold hover:bg-orange-700 disabled:opacity-50"
          >
            {status === "sending" ? "Enviando..." : "💬 Contactar"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function RecallCampaignPanel() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [months, setMonths] = useState(6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [batchStatus, setBatchStatus] = useState<"idle" | "running" | "done">("idle");
  const [batchProgress, setBatchProgress] = useState(0);

  async function load(m = months) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/db/recall?months=${m}`, { cache: "no-store" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPatients(json.patients ?? []);
      setSentCount(0);
    } catch (e: any) {
      setError(e.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleMonthChange(m: number) {
    setMonths(m);
    load(m);
  }

  async function handleBatchSend() {
    const withPhone = patients.filter((p) => p.phone);
    if (withPhone.length === 0) return;
    if (!confirm(
      `¿Enviar mensajes de recuperación a ${withPhone.length} pacientes?\n\n` +
      `Solo continúa si no has enviado mensajes recientemente a estos pacientes.`
    )) return;

    setBatchStatus("running");
    setBatchProgress(0);
    let sent = 0;
    for (const p of withPhone) {
      try {
        await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: p.phone, message: buildRecallMessage(p) }),
        });
        sent++;
      } catch { /* continue */ }
      setBatchProgress(Math.round((sent / withPhone.length) * 100));
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    }
    setSentCount(sent);
    setBatchStatus("done");
  }

  const withPhone = patients.filter((p) => p.phone);
  // Revenue potential: 10% response × avg ticket €90
  const potentialRevenue = Math.round(withPhone.length * 0.10 * 90);
  const redCount = patients.filter((p) => p.daysSinceVisit >= 270).length;
  const amberCount = patients.filter((p) => p.daysSinceVisit >= 180 && p.daysSinceVisit < 270).length;

  return (
    <div className="space-y-5">

      {/* ── Hero gradient ─────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-orange-500 to-red-600 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-orange-100 uppercase tracking-widest">Campaña de recuperación</p>
            <h2 className="mt-1 text-3xl font-extrabold">
              {loading ? "—" : patients.length}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-orange-100">pacientes sin visitar en más de {months} meses</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 border border-white/25 text-white hover:bg-white/30 shrink-0"
          >
            Refrescar
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className={`rounded-2xl border p-3 ${redCount > 0 ? "bg-rose-500/30 border-rose-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-xs text-orange-100 font-medium">🔴 Críticos (+9m)</p>
            <p className="text-xl font-extrabold mt-0.5">{loading ? "—" : redCount}</p>
          </div>
          <div className={`rounded-2xl border p-3 ${amberCount > 0 ? "bg-amber-400/25 border-amber-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-xs text-orange-100 font-medium">🟡 Prioridad (6-9m)</p>
            <p className="text-xl font-extrabold mt-0.5">{loading ? "—" : amberCount}</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-orange-100 font-medium">Con teléfono</p>
            <p className="text-xl font-extrabold mt-0.5">{loading ? "—" : withPhone.length}</p>
            <p className="text-[11px] text-orange-200 mt-0.5">contactables vía WhatsApp</p>
          </div>
          <div className="rounded-2xl bg-emerald-500/30 border border-emerald-300/30 p-3">
            <p className="text-xs text-orange-100 font-medium">Potencial</p>
            <p className="text-xl font-extrabold mt-0.5 text-emerald-100">€{potentialRevenue.toLocaleString("es-ES")}</p>
            <p className="text-[11px] text-orange-200 mt-0.5">si 10% responde</p>
          </div>
        </div>
      </div>

      {/* ── Batch action ──────────────────────────────────────────── */}
      {!loading && patients.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">
              {batchStatus === "done"
                ? `✅ Campaña enviada · ${sentCount} mensajes`
                : `Contactar a todos (${withPhone.length} pacientes con teléfono)`}
            </p>
            {batchStatus === "running" && (
              <div className="mt-2 space-y-1">
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden w-48">
                  <div
                    className="h-full rounded-full bg-orange-500 transition-all duration-300"
                    style={{ width: `${batchProgress}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">{batchProgress}% completado…</p>
              </div>
            )}
            {batchStatus === "idle" && (
              <p className="text-xs text-slate-400 mt-0.5">
                Envía un mensaje personalizado de recuperación a cada uno
              </p>
            )}
          </div>

          {batchStatus === "idle" && (
            <button
              onClick={handleBatchSend}
              disabled={withPhone.length === 0}
              className="text-sm px-4 py-2 rounded-full bg-orange-600 text-white font-semibold hover:bg-orange-700 disabled:opacity-40 shrink-0"
            >
              💬 Enviar campaña
            </button>
          )}
        </div>
      )}

      {/* ── Filter ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-500 font-medium">Sin visitar en más de:</span>
        {[3, 6, 9, 12].map((m) => (
          <button
            key={m}
            onClick={() => handleMonthChange(m)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
              months === m
                ? "bg-orange-600 text-white border-orange-600"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {m} meses
          </button>
        ))}
      </div>

      {/* ── Patient list ──────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl bg-slate-100" />)}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
      ) : patients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-lg mb-1">🎉</p>
          <p className="text-sm text-slate-500">No hay pacientes sin visitar en los últimos {months} meses.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">
              {patients.length} pacientes · ordenados por tiempo sin visita
            </p>
            <span className="text-xs text-slate-400">{withPhone.length} con WhatsApp</span>
          </div>
          <div>
            {patients.map((p, i) => (
              <PatientRow
                key={`${p.phone || p.name}-${i}`}
                patient={p}
                onSent={() => setSentCount((c) => c + 1)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Tip ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-700">Sobre las campañas de recuperación</p>
        <ul className="mt-2 space-y-1 text-xs text-slate-500 list-disc pl-4">
          <li>La tasa media de respuesta a mensajes de recuperación es del 8-15%</li>
          <li>Enfócate primero en los 🔴 críticos (+9 meses) — tienen más urgencia clínica</li>
          <li>Espera al menos 3 meses entre campañas para no saturar al paciente</li>
          <li>Los pacientes que responden entran automáticamente al flujo de WhatsApp para reservar cita</li>
        </ul>
      </div>
    </div>
  );
}
