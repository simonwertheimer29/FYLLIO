"use client";

import { useEffect, useState } from "react";

type Stats = {
  todayAppointments: number;
  weekAppointments: number;
  weekCancellations: number;
  weekNoShows: number;
  activeSessions: number;
  waitlist: {
    active: number;
    offered: number;
    booked: number;
  };
  channels: { name: string; count: number }[];
  whatsappAppts: number;
  conversionPct: number | null;
  generatedAt: string | null;
};

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className={`rounded-2xl border p-5 bg-white ${accent ?? "border-slate-200"}`}>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/stats", { cache: "no-store" });
      const json = await res.json();
      setStats(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Estadísticas</h2>
          <p className="text-xs text-slate-500 mt-1">Métricas en tiempo real · semana actual</p>
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
        <p className="text-sm text-slate-500">Cargando estadísticas...</p>
      ) : !stats ? (
        <p className="text-sm text-slate-500">Error al cargar métricas.</p>
      ) : (
        <>
          {/* Primary metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <StatCard label="Citas hoy" value={stats.todayAppointments} sub="activas" accent="border-sky-200" />
            <StatCard label="Citas esta semana" value={stats.weekAppointments} sub="lun–dom (activas)" />
            <StatCard
              label="Sesiones WhatsApp"
              value={stats.activeSessions}
              sub="conversaciones activas"
              accent="border-amber-200"
            />
            <StatCard
              label="En lista de espera"
              value={stats.waitlist.active}
              sub={`${stats.waitlist.offered} ofrecidos · ${stats.waitlist.booked} confirmados`}
              accent="border-emerald-200"
            />
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <StatCard
              label="Cancelaciones semana"
              value={stats.weekCancellations}
              sub="esta semana"
              accent="border-red-200"
            />
            <StatCard
              label="No-shows semana"
              value={stats.weekNoShows}
              sub="esta semana"
              accent="border-orange-200"
            />
            <StatCard
              label="Citas WhatsApp"
              value={stats.whatsappAppts}
              sub="esta semana"
              accent="border-green-200"
            />
            <StatCard
              label="Conversión WhatsApp"
              value={stats.conversionPct !== null ? `${stats.conversionPct}%` : "—"}
              sub="citas / sesiones activas"
              accent="border-purple-200"
            />
          </div>

          {/* Waitlist breakdown */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Lista de espera por estado</h3>
            <div className="flex gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-sky-400" />
                <span className="text-sm text-slate-700">Esperando: <b>{stats.waitlist.active}</b></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="text-sm text-slate-700">Contactados: <b>{stats.waitlist.offered}</b></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
                <span className="text-sm text-slate-700">Confirmados: <b>{stats.waitlist.booked}</b></span>
              </div>
            </div>
          </div>

          {/* Channel breakdown */}
          {stats.channels.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Canal de origen (semana)</h3>
              <div className="space-y-2">
                {stats.channels.map((ch) => {
                  const total = stats.channels.reduce((s, c) => s + c.count, 0);
                  const pct = total > 0 ? Math.round((ch.count / total) * 100) : 0;
                  return (
                    <div key={ch.name} className="flex items-center gap-3">
                      <span className="text-sm text-slate-700 w-28 shrink-0">{ch.name}</span>
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-sky-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-slate-600 w-16 text-right">
                        {ch.count} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stats.generatedAt && (
            <p className="text-[11px] text-slate-400">
              Actualizado: {new Date(stats.generatedAt).toLocaleString("es-ES")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
