"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Cell, ReferenceLine, ResponsiveContainer, Tooltip,
  LineChart, Line,
} from "recharts";
import type { NoShowsUserSession, NoShowKpiData, WeeklyTrend } from "../../lib/no-shows/types";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type KpiTab = "general" | "clinica" | "doctor" | "tratamiento" | "ingresos" | "reputacion" | "ia";

type DocData = { nombre: string; tasa: number; total: number; noShows: number };

type KpiResponse = NoShowKpiData & {
  isDemo?:    boolean;
  byDoctor?:  DocData[];
};

type ChatMsg = { role: "user" | "assistant"; content: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(euros: number): string {
  return `€${euros.toLocaleString("es-ES")}`;
}

// ─── Reusable: MiniBar horizontal ────────────────────────────────────────────

function MiniBar({
  label, tasa, sector, maxTasa,
}: { label: string; tasa: number; sector: number; maxTasa: number }) {
  const pct  = maxTasa > 0 ? (tasa / maxTasa) * 100 : 0;
  const over = tasa > sector;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 shrink-0 truncate" style={{ minWidth: 100, maxWidth: 130 }}>
        {label}
      </span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-red-400" : "bg-cyan-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold shrink-0 w-10 text-right ${over ? "text-red-600" : "text-slate-600"}`}>
        {(tasa * 100).toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Reusable: Stat card ─────────────────────────────────────────────────────

function StatCard({ label, value, color = "text-slate-800" }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-center py-3 rounded-xl bg-white border border-slate-200">
      <p className={`text-xl font-extrabold leading-none ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-400 mt-1">{label}</p>
    </div>
  );
}

// ─── Tab: GENERAL ─────────────────────────────────────────────────────────────

function TabGeneral({ data }: { data: KpiResponse }) {
  const tasaPct     = (data.tasa * 100).toFixed(1);
  const sectorPct   = (data.tasaSector * 100).toFixed(0);
  const mejorSector = data.tasa < data.tasaSector;
  const diffPts     = Math.abs(data.tasa - data.tasaSector) * 100;

  return (
    <div className="space-y-4">
      {/* 3 stat cards */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="Tasa no-show"
          value={`${tasaPct}%`}
          color={mejorSector ? "text-green-700" : "text-red-700"}
        />
        <StatCard label="Citas" value={data.totalCitas} />
        <StatCard label="No-shows" value={data.totalNoShows} color="text-red-700" />
      </div>

      {/* vs Sector */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">vs Media del Sector</p>
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-extrabold ${mejorSector ? "text-green-700" : "text-red-700"}`}>
            {tasaPct}%
          </div>
          <div className="flex-1">
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden relative">
              <div
                className={`h-full rounded-full ${mejorSector ? "bg-green-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(100, (data.tasa / (data.tasaSector * 1.5)) * 100)}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-slate-400"
                style={{ left: `${(data.tasaSector / (data.tasaSector * 1.5)) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
              <span>0%</span>
              <span>Sector {sectorPct}%</span>
            </div>
          </div>
        </div>
        <p className={`text-xs font-semibold ${mejorSector ? "text-green-700" : "text-red-700"}`}>
          {mejorSector
            ? `✓ ${diffPts.toFixed(1)} puntos por debajo de la media del sector`
            : `⚠ ${diffPts.toFixed(1)} puntos por encima de la media del sector`}
        </p>
      </div>

      {/* Tendencia 8 semanas — Recharts BarChart */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tendencia 8 semanas</p>
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={data.weeklyTrend} margin={{ top: 10, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 8, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip
              formatter={(v: any) => [`${(Number(v) * 100).toFixed(1)}%`, "Tasa"]}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <ReferenceLine
              y={data.tasaSector}
              stroke="#94a3b8"
              strokeDasharray="3 3"
              label={{ value: `sector ${sectorPct}%`, fill: "#94a3b8", fontSize: 8, position: "insideTopRight" }}
            />
            <Bar dataKey="tasa" radius={[2, 2, 0, 0]}>
              {data.weeklyTrend.map((entry: WeeklyTrend) => (
                <Cell
                  key={entry.week}
                  fill={entry.tasa > data.tasaSector ? "#EF4444" : "#06B6D4"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex gap-4 text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-cyan-500" />Bajo sector
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-red-400" />Sobre sector
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: CLÍNICA ─────────────────────────────────────────────────────────────

function TabClinica({ data, isManager }: { data: KpiResponse; isManager: boolean }) {
  if (!isManager) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Solo disponible para managers</p>
      </div>
    );
  }
  if (!data.byClinica || data.byClinica.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Sin datos suficientes por clínica</p>
      </div>
    );
  }
  const maxTasa = Math.max(...data.byClinica.map((c) => c.tasa));
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ranking por clínica</p>
      <div className="space-y-2">
        {data.byClinica.map((c) => (
          <MiniBar key={c.clinica} label={c.clinica} tasa={c.tasa} sector={data.tasaSector} maxTasa={maxTasa} />
        ))}
      </div>
    </div>
  );
}

// ─── Tab: DOCTOR ──────────────────────────────────────────────────────────────

function TabDoctor({ data }: { data: KpiResponse }) {
  const docs = data.byDoctor;
  if (!docs || docs.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Sin datos de médico disponibles</p>
        <p className="text-xs text-slate-300 mt-1">Asegúrate de que el campo "Médico" esté rellenado en Airtable</p>
      </div>
    );
  }
  const maxTasa = Math.max(...docs.map((d) => d.tasa));
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Por médico (top 5)</p>
        <div className="space-y-2">
          {docs.map((d) => (
            <MiniBar key={d.nombre} label={d.nombre} tasa={d.tasa} sector={data.tasaSector} maxTasa={maxTasa} />
          ))}
        </div>
      </div>
      {/* Detail table */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <div className="divide-y divide-slate-50">
          <div className="flex gap-2 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase">
            <span className="flex-1">Médico</span>
            <span className="w-14 text-right">Citas</span>
            <span className="w-14 text-right">No-shows</span>
            <span className="w-12 text-right">Tasa</span>
          </div>
          {docs.map((d) => (
            <div key={d.nombre} className="flex items-center gap-2 py-2 text-xs">
              <span className="flex-1 text-slate-700 truncate">{d.nombre}</span>
              <span className="w-14 text-right text-slate-500">{d.total}</span>
              <span className="w-14 text-right text-slate-500">{d.noShows}</span>
              <span className={`w-12 text-right font-semibold ${d.tasa > data.tasaSector ? "text-red-600" : "text-green-700"}`}>
                {(d.tasa * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: TRATAMIENTO ────────────────────────────────────────────────────────

function TabTratamiento({ data }: { data: KpiResponse }) {
  if (!data.byTreatment || data.byTreatment.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Sin datos suficientes por tratamiento</p>
      </div>
    );
  }
  const maxTasa = Math.max(...data.byTreatment.map((t) => t.tasa));
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Por tratamiento (top 5)</p>
      <div className="space-y-2">
        {data.byTreatment.map((t) => (
          <MiniBar key={t.treatment} label={t.treatment} tasa={t.tasa} sector={data.tasaSector} maxTasa={maxTasa} />
        ))}
      </div>
    </div>
  );
}

// ─── Tab: INGRESOS ────────────────────────────────────────────────────────────

function ContextCard({ real, baseline, delta, prevIngresos }: {
  real: number; baseline: number; delta: number; prevIngresos: number;
}) {
  const isMoreActivity = real > prevIngresos;
  const isDeltaPos     = delta > 0;

  if (!isDeltaPos) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-1">
        <p className="text-sm font-bold text-red-800">⚠️ La tasa de no-show aumentó este mes</p>
        <p className="text-xs text-red-700 leading-relaxed">
          La proyección sin Fyllio ({fmt(baseline)}) supera los ingresos reales ({fmt(real)}).
          Revisa las alertas y aumenta la gestión preventiva.
        </p>
      </div>
    );
  }
  if (!isMoreActivity) {
    return (
      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 space-y-1">
        <p className="text-sm font-bold text-cyan-800">✨ Fyllio recuperó {fmt(delta)} en un mes con menos actividad</p>
        <p className="text-xs text-cyan-700 leading-relaxed">
          Los ingresos totales son menores que el mes anterior, pero sin Fyllio habrían sido {fmt(delta)} menos.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-green-200 bg-green-50 p-4 space-y-1">
      <p className="text-sm font-bold text-green-800">🎉 Mejor mes: ingresos arriba y Fyllio recuperó {fmt(delta)}</p>
      <p className="text-xs text-green-700 leading-relaxed">
        Los ingresos superan el mes anterior ({fmt(prevIngresos)}) y Fyllio evitó perder {fmt(delta)} respecto a la tasa histórica.
      </p>
    </div>
  );
}

function TabIngresos({ data }: { data: KpiResponse }) {
  const ir = data.ingresosRecuperados;
  if (!ir) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Sin datos de ingresos disponibles</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ContextCard
        real={ir.ingresosReales}
        baseline={ir.baselineProjection}
        delta={ir.delta}
        prevIngresos={ir.mesAnteriorIngresos}
      />
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Ingresos reales"   value={fmt(ir.ingresosReales)}             />
        <StatCard label="Sin Fyllio (15%)"  value={fmt(ir.baselineProjection)}  color="text-slate-400" />
        <StatCard
          label="Recuperado"
          value={fmt(Math.abs(ir.delta))}
          color={ir.delta >= 0 ? "text-green-700" : "text-red-700"}
        />
      </div>
      {/* Recharts LineChart */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ingresos últimos 12 meses</p>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={ir.monthlyData} margin={{ top: 8, right: 4, left: -10, bottom: 0 }}>
            <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={2} />
            <YAxis
              tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 8, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              formatter={(v: any, name: any) => [fmt(Number(v)), name === "real" ? "Real" : "Sin Fyllio"]}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Line type="monotone" dataKey="real"     stroke="#0891b2" strokeWidth={2} dot={{ r: 2 }} name="real" />
            <Line type="monotone" dataKey="baseline" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="baseline" />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-4 text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 border-b-2 border-cyan-600" />Real
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 border-b-2 border-dashed border-slate-400" />Sin Fyllio
          </span>
        </div>
      </div>
      <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-500 space-y-0.5">
        <p>
          <span className="font-semibold text-slate-600">Tasa pre-Fyllio:</span>{" "}
          {(ir.tasaPreFyllio * 100).toFixed(0)}% — configurable en Config.
        </p>
        <p>Ingreso por cita estimado en €85. Los ingresos reales incluyen citas completadas.</p>
      </div>
    </div>
  );
}

// ─── Tab: REPUTACIÓN (demo) ────────────────────────────────────────────────────

const DEMO_REP = {
  rating:  4.2,
  total:   87,
  distribution: [
    { stars: 5, count: 52 },
    { stars: 4, count: 26 },
    { stars: 3, count: 7  },
    { stars: 2, count: 1  },
    { stars: 1, count: 1  },
  ],
  alertas: [
    { stars: 2, text: "Esperé más de 45 minutos y nadie me informó del retraso.", date: "ayer"        },
    { stars: 2, text: "No me llegó el recordatorio y no pude cancelar a tiempo.", date: "hace 3 días" },
  ],
  respuestaSugerida:
    "Estimado paciente, lamentamos mucho tu experiencia. La puntualidad y la comunicación son valores fundamentales para nosotros. Hemos tomado nota de tu comentario para mejorar nuestros procesos. Si lo deseas, nos encantaría contactarte directamente para compensar este inconveniente. Un cordial saludo.",
};

function TabReputacion() {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState(DEMO_REP.respuestaSugerida);

  return (
    <div className="space-y-4">
      {/* Demo notice */}
      <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-2 text-xs text-violet-700">
        <span className="font-semibold">Vista previa</span> — Conéctate a la tabla "Valoraciones" para datos reales.
      </div>

      {/* Rating global */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 flex items-center gap-4">
        <div className="text-center">
          <p className="text-4xl font-extrabold text-slate-800 leading-none">{DEMO_REP.rating}</p>
          <p className="text-yellow-400 text-lg mt-0.5">{"★".repeat(4)}☆</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{DEMO_REP.total} reseñas</p>
        </div>
        <div className="flex-1 space-y-1.5">
          {DEMO_REP.distribution.map((d) => {
            const pct = Math.round((d.count / DEMO_REP.total) * 100);
            return (
              <div key={d.stars} className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400 shrink-0 w-3">{d.stars}</span>
                <span className="text-yellow-400 text-[9px] shrink-0">★</span>
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${d.stars >= 4 ? "bg-green-400" : d.stars === 3 ? "bg-amber-400" : "bg-red-400"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[9px] text-slate-400 shrink-0 w-7 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alertas */}
      <div className="rounded-2xl bg-white border border-red-100 p-4 space-y-2">
        <p className="text-xs font-semibold text-red-700 uppercase tracking-wider">
          ⚠️ Alertas — {DEMO_REP.alertas.length} reseñas ≤ 2 estrellas
        </p>
        {DEMO_REP.alertas.map((a, i) => (
          <div key={i} className="rounded-xl bg-red-50 border border-red-100 p-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-red-400 text-sm">{"★".repeat(a.stars)}{"☆".repeat(5 - a.stars)}</span>
              <span className="text-[10px] text-slate-400">· Google · {a.date}</span>
            </div>
            <p className="text-xs text-slate-600 leading-snug">"{a.text}"</p>
          </div>
        ))}
      </div>

      {/* Reply generator */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-700">Respuesta sugerida (Google)</p>
          <button
            onClick={() => setShowReply((v) => !v)}
            className="text-xs font-semibold text-violet-600 hover:text-violet-800 transition-colors"
          >
            {showReply ? "Cerrar" : "✦ Generar respuesta"}
          </button>
        </div>
        {showReply && (
          <>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={4}
              className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-300 resize-none"
            />
            <button
              onClick={() => { navigator.clipboard.writeText(replyText).catch(() => {}); }}
              className="text-xs font-semibold text-white bg-slate-700 hover:bg-slate-800 px-3 py-1.5 rounded-lg transition-colors"
            >
              Copiar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tab: ASISTENTE IA ────────────────────────────────────────────────────────

function TabIA({ data, period, clinicaFilter }: { data: KpiResponse; period: string; clinicaFilter: string }) {
  const [msgs,    setMsgs]    = useState<ChatMsg[]>([]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput("");
    setMsgs((prev) => [...prev, { role: "user", content: trimmed }]);
    setLoading(true);
    try {
      const res = await fetch("/api/no-shows/ia/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mensaje: trimmed,
          contexto: {
            tasa:         data.tasa,
            totalCitas:   data.totalCitas,
            totalNoShows: data.totalNoShows,
            tasaSector:   data.tasaSector,
            clinica:      clinicaFilter || undefined,
            periodo:      period === "month" ? "30 días" : "90 días",
            byDayOfWeek:  data.byDayOfWeek,
            byTreatment:  data.byTreatment,
            weeklyTrend:  data.weeklyTrend,
          },
        }),
      });
      const d = await res.json();
      setMsgs((prev) => [
        ...prev,
        { role: "assistant", content: d.respuesta || d.error || "Sin respuesta" },
      ]);
    } catch {
      setMsgs((prev) => [
        ...prev,
        { role: "assistant", content: "Error de red. Inténtalo de nuevo." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white border border-slate-200 flex flex-col" style={{ minHeight: 380 }}>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 320 }}>
        {msgs.length === 0 && (
          <div className="text-center py-8 space-y-1">
            <p className="text-2xl">✦</p>
            <p className="text-sm font-semibold text-slate-700">Asistente IA</p>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Pregunta sobre tus datos de no-shows: tendencias, tratamientos, días de riesgo…
            </p>
            <div className="flex flex-col gap-1 mt-3">
              {[
                "¿Qué día tiene más no-shows?",
                "¿Cómo está mi tasa vs el sector?",
                "¿Qué tratamiento tiene mayor riesgo?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="text-xs text-violet-600 hover:text-violet-800 transition-colors"
                >
                  → {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-slate-800 text-white rounded-br-sm"
                  : "bg-slate-50 border border-slate-200 text-slate-700 rounded-bl-sm"
              }`}
            >
              {m.role === "assistant" && <span className="text-violet-500 font-bold mr-1">✦</span>}
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-violet-400 animate-pulse">
              ✦ Pensando…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Pregunta sobre tus datos…"
          className="flex-1 text-xs rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-300"
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 px-3 py-2 rounded-xl transition-colors"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

// ─── Tab strip ────────────────────────────────────────────────────────────────

const TABS: { id: KpiTab; label: string }[] = [
  { id: "general",      label: "General"    },
  { id: "clinica",      label: "Clínica"    },
  { id: "doctor",       label: "Doctor"     },
  { id: "tratamiento",  label: "Trat."      },
  { id: "ingresos",     label: "Ingresos"   },
  { id: "reputacion",   label: "Reput."     },
  { id: "ia",           label: "IA ✦"       },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function KpiView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";

  const [activeTab, setActiveTab]       = useState<KpiTab>("general");
  const [period, setPeriod]             = useState<"month" | "quarter">("month");
  const [data, setData]                 = useState<KpiResponse | null>(null);
  const [loading, setLoading]           = useState(true);
  const [clinicaFilter, setClinica]     = useState("");

  const load = useCallback(async (p: string, clinica?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/kpis", location.href);
      url.searchParams.set("period", p);
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(period, clinicaFilter || undefined); }, [load, period, clinicaFilter]);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full max-w-2xl">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
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

  const clinicas = isManager && data.byClinica
    ? [...new Set(data.byClinica.map((c) => c.clinica))].sort()
    : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 max-w-2xl w-full mx-auto">
      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* Controls: period + clinic filter */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1">
            {(["month", "quarter"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`text-xs px-3 py-1.5 rounded-xl border font-semibold transition-colors ${
                  period === p
                    ? "bg-cyan-600 text-white border-cyan-600"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {p === "month" ? "30 días" : "Trimestre"}
              </button>
            ))}
          </div>
          {/* Quick summary */}
          <p className="text-xs text-slate-400">
            {data.totalNoShows} no-shows · {(data.tasa * 100).toFixed(1)}%
          </p>
        </div>

        {isManager && clinicas.length > 1 && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinica(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <option value="">Todas las clínicas</option>
            {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Tab strip — horizontal scroll */}
      <div className="rounded-2xl bg-white border border-slate-200 p-1.5">
        <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`text-xs px-3 py-2 rounded-xl font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
                activeTab === t.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "general"     && <TabGeneral     data={data} />}
      {activeTab === "clinica"     && <TabClinica     data={data} isManager={isManager} />}
      {activeTab === "doctor"      && <TabDoctor      data={data} />}
      {activeTab === "tratamiento" && <TabTratamiento data={data} />}
      {activeTab === "ingresos"    && <TabIngresos    data={data} />}
      {activeTab === "reputacion"  && <TabReputacion  />}
      {activeTab === "ia"          && (
        <TabIA data={data} period={period} clinicaFilter={clinicaFilter} />
      )}
    </div>
  );
}
