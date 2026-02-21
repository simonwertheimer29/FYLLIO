"use client";

import { useEffect, useState } from "react";

type FeedbackStats = {
  count: number;
  avg: number | null;
  distribution: Record<string, number>;
  googleReviewsSent: number;
  negativeAlerts: { score: number; name: string }[];
  negativeCount: number;
};

const DEMO_STATS: FeedbackStats = {
  count: 34,
  avg: 4.6,
  distribution: { 1: 1, 2: 1, 3: 2, 4: 10, 5: 20 },
  googleReviewsSent: 22,
  negativeAlerts: [
    { score: 2, name: "Carlos García Molina" },
    { score: 1, name: "Rosa Fernández Ortega" },
  ],
  negativeCount: 2,
};

function StarBar({ star, count, max }: { star: number; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-500 w-4 shrink-0">{star}⭐</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${star >= 4 ? "bg-emerald-400" : star === 3 ? "bg-amber-400" : "bg-rose-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-slate-500 w-5 text-right shrink-0">{count}</span>
    </div>
  );
}

export default function FeedbackPanel() {
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/feedback", { cache: "no-store" });
      const json: FeedbackStats = await res.json();
      if (json.count === 0) {
        setStats(DEMO_STATS);
        setIsDemo(true);
      } else {
        setStats(json);
        setIsDemo(false);
      }
    } catch {
      setStats(DEMO_STATS);
      setIsDemo(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-40 rounded-3xl bg-slate-100" />
        <div className="h-48 rounded-3xl bg-slate-100" />
      </div>
    );
  }

  if (!stats) return null;

  const maxCount = Math.max(...Object.values(stats.distribution));
  const avgDisplay = stats.avg !== null ? stats.avg.toFixed(1) : "—";
  const stars = stats.avg !== null ? Math.round(stats.avg) : 0;

  return (
    <div className="space-y-5">

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-amber-100 uppercase tracking-widest">Reputación y feedback</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-extrabold">{avgDisplay}</span>
              <span className="text-xl text-amber-200">/ 5</span>
            </div>
            <p className="text-sm text-amber-100 mt-0.5">
              {"⭐".repeat(stars)}{"☆".repeat(Math.max(0, 5 - stars))}
            </p>
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
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-amber-100 font-medium">Respuestas</p>
            <p className="text-2xl font-extrabold mt-0.5">{stats.count}</p>
            <p className="text-[11px] text-amber-200 mt-0.5">valoraciones totales</p>
          </div>
          <div className="rounded-2xl bg-emerald-500/30 border border-emerald-300/30 p-3">
            <p className="text-xs text-amber-100 font-medium">Reseñas Google</p>
            <p className="text-2xl font-extrabold mt-0.5 text-emerald-100">{stats.googleReviewsSent}</p>
            <p className="text-[11px] text-amber-200 mt-0.5">generadas automáticamente</p>
          </div>
          <div className={`rounded-2xl border p-3 ${stats.negativeCount > 0 ? "bg-rose-500/30 border-rose-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-xs text-amber-100 font-medium">Alertas</p>
            <p className={`text-2xl font-extrabold mt-0.5 ${stats.negativeCount > 0 ? "text-rose-200" : ""}`}>{stats.negativeCount}</p>
            <p className="text-[11px] text-amber-200 mt-0.5">valoraciones bajas</p>
          </div>
        </div>
      </div>

      {/* ── Negative alerts ───────────────────────────────────────── */}
      {stats.negativeAlerts.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-rose-200 flex items-center gap-2">
            <span className="text-rose-500">⚠️</span>
            <p className="text-sm font-semibold text-rose-800">
              {stats.negativeAlerts.length} {stats.negativeAlerts.length === 1 ? "paciente dejó" : "pacientes dejaron"} valoración baja — llama hoy
            </p>
          </div>
          <div className="divide-y divide-rose-100">
            {stats.negativeAlerts.map((a, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{"⭐".repeat(a.score)}</span>
                  <span className="text-sm font-semibold text-slate-800">{a.name}</span>
                </div>
                <span className="text-xs font-bold text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full">
                  {a.score}/5
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Score distribution ────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-800 mb-4">Distribución de valoraciones</p>
        <div className="space-y-2">
          {[5, 4, 3, 2, 1].map((s) => (
            <StarBar key={s} star={s} count={stats.distribution[s] ?? 0} max={maxCount} />
          ))}
        </div>
      </div>

      {/* ── Google Reviews tip ────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-700">¿Cómo funciona el loop de reseñas?</p>
        <ol className="mt-2 space-y-1 text-xs text-slate-500 list-decimal pl-4">
          <li>Al día siguiente de la cita, Fyllio envía un WhatsApp: "¿Cómo fue tu visita? Responde del 1 al 5"</li>
          <li>Si responde 4 o 5 → recibe automáticamente el link de Google Reviews para dejar una reseña</li>
          <li>Si responde 1-3 → aparece aquí como alerta para que el dentista llame ese mismo día</li>
        </ol>
        {!process.env.NEXT_PUBLIC_GOOGLE_REVIEWS_CONFIGURED && (
          <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Para activar el envío del link de Google, añade <code className="bg-amber-100 px-1 rounded">GOOGLE_REVIEWS_URL</code> en las variables de entorno de Vercel con tu link de Google Business Profile.
          </p>
        )}
      </div>

      {isDemo && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-start gap-3">
          <span className="text-slate-400 text-lg shrink-0">ℹ️</span>
          <p className="text-xs text-slate-500">
            Datos de demostración. Las valoraciones reales aparecerán aquí cuando los pacientes respondan al WhatsApp de feedback post-cita.
          </p>
        </div>
      )}
    </div>
  );
}
