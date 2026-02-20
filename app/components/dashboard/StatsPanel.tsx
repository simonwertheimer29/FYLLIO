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
  // Last week comparison
  lastWeekAppointments: number;
  lastWeekCancellations: number;
  weekAppointmentsDelta: number;
  weekCancellationsDelta: number;
  // ROI metrics
  timeSavedMinByWhatsapp: number;
  estimatedWaitlistRevenue: number;
  cancellationRate: number | null;
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

function Delta({ delta, invert }: { delta: number; invert?: boolean }) {
  if (delta === 0) return <span className="text-slate-400 text-xs font-semibold">= igual</span>;
  const good = invert ? delta < 0 : delta > 0;
  return (
    <span
      className={`text-xs font-semibold ${good ? "text-emerald-600" : "text-red-500"}`}
    >
      {delta > 0 ? "+" : ""}{delta} {good ? "↑" : "↓"}
    </span>
  );
}

function RoiCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 bg-white flex items-start gap-3 ${accent}`}>
      <span className="text-2xl leading-none mt-0.5">{icon}</span>
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="mt-1 text-xl font-extrabold text-slate-900">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
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
              sub={stats.cancellationRate !== null ? `${stats.cancellationRate}% tasa` : "esta semana"}
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

          {/* ROI de Fyllio */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">ROI de Fyllio</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <RoiCard
                icon="⏱"
                label="Tiempo ahorrado en gestión"
                value={stats.timeSavedMinByWhatsapp >= 60
                  ? `${(stats.timeSavedMinByWhatsapp / 60).toFixed(1)} h`
                  : `${stats.timeSavedMinByWhatsapp} min`}
                sub={`${stats.activeSessions} conversaciones automatizadas × 5 min`}
                accent="border-violet-200"
              />
              <RoiCard
                icon="💶"
                label="Ingresos recuperados (lista espera)"
                value={`€${stats.estimatedWaitlistRevenue}`}
                sub={`${stats.waitlist.booked} citas confirmadas × €60 ticket medio`}
                accent="border-emerald-200"
              />
              <RoiCard
                icon="📋"
                label="Lista de espera activa"
                value={String(stats.waitlist.active)}
                sub={`${stats.waitlist.offered} contactados · ${stats.waitlist.booked} confirmados`}
                accent="border-sky-200"
              />
            </div>
          </div>

          {/* Evolución vs semana anterior */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Evolución vs semana anterior</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-slate-500 font-medium">Citas esta semana</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-slate-900">{stats.weekAppointments}</span>
                  <Delta delta={stats.weekAppointmentsDelta} />
                </div>
                <p className="text-xs text-slate-400">vs {stats.lastWeekAppointments} la semana pasada</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-slate-500 font-medium">Cancelaciones</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-slate-900">{stats.weekCancellations}</span>
                  <Delta delta={stats.weekCancellationsDelta} invert />
                </div>
                <p className="text-xs text-slate-400">vs {stats.lastWeekCancellations} la semana pasada</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-slate-500 font-medium">Tasa cancelación</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-slate-900">
                    {stats.cancellationRate !== null ? `${stats.cancellationRate}%` : "—"}
                  </span>
                </div>
                <p className="text-xs text-slate-400">esta semana</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-slate-500 font-medium">Sesiones WhatsApp</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-slate-900">{stats.activeSessions}</span>
                </div>
                <p className="text-xs text-slate-400">activas ahora</p>
              </div>
            </div>
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
