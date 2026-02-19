"use client";

import { useEffect, useState } from "react";

type Session = {
  phone: string;
  stage: string;
  treatmentName: string | null;
  staffId: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
};

function stageBadgeClass(stage: string) {
  if (stage.includes("ASK_WHEN") || stage.includes("ASK_TREATMENT") || stage.includes("ASK_DOCTOR")) {
    return "bg-sky-50 border-sky-200 text-sky-800";
  }
  if (stage.includes("OFFER_SLOTS") || stage.includes("OFFER_WAITLIST")) {
    return "bg-amber-50 border-amber-200 text-amber-800";
  }
  if (stage.includes("CONFIRM") || stage.includes("BOOKED") || stage.includes("PATIENT_NAME")) {
    return "bg-emerald-50 border-emerald-200 text-emerald-800";
  }
  if (stage.includes("CANCEL") || stage.includes("RESCHEDULE")) {
    return "bg-rose-50 border-rose-200 text-rose-800";
  }
  return "bg-slate-50 border-slate-200 text-slate-700";
}

function timeAgo(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

export default function MessagesPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/sessions", { cache: "no-store" });
      const json = await res.json();
      setSessions(json.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function clearSession(phone: string) {
    await fetch(`/api/dashboard/sessions?phone=${encodeURIComponent(phone)}`, { method: "DELETE" });
    await load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Sesiones WhatsApp</h2>
          <p className="text-xs text-slate-500 mt-1">Conversaciones activas en curso</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-xs px-3 py-2 rounded-full border border-slate-200 hover:bg-slate-50"
        >
          Refrescar
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Cargando...</p>
      ) : sessions.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No hay sesiones activas.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-[700px] w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs text-slate-600">
                <th className="px-4 py-3 font-semibold">Teléfono</th>
                <th className="px-4 py-3 font-semibold">Etapa</th>
                <th className="px-4 py-3 font-semibold">Tratamiento</th>
                <th className="px-4 py-3 font-semibold">Última actividad</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sessions.map((s) => (
                <tr key={s.phone} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{s.phone}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex text-[11px] px-3 py-1 rounded-full border font-semibold ${stageBadgeClass(s.stage)}`}>
                      {s.stage}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{s.treatmentName ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{timeAgo(s.updatedAtMs)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => clearSession(s.phone)}
                      className="text-[11px] px-3 py-1 rounded-full border border-slate-200 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-slate-600"
                    >
                      Limpiar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
