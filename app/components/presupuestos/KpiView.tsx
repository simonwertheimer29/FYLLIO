"use client";

import { useEffect, useState, useRef } from "react";
import type { TonosStats } from "../../api/presupuestos/tonos-stats/route";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { KpiData, UserSession } from "../../lib/presupuestos/types";
import { ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";

type SubTab = "general" | "tarifas" | "paciente" | "tratamientos" | "doctores" | "benchmark" | "ia";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "tarifas", label: "Tarifas" },
  { id: "paciente", label: "Tipo Paciente" },
  { id: "tratamientos", label: "Tratamientos" },
  { id: "doctores", label: "Doctores" },
  { id: "benchmark", label: "Benchmark" },
  { id: "ia", label: "Motor IA" },
];

const MES_LABEL = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function formatMesLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${MES_LABEL[m - 1]} ${y}`;
}

function getLast12Months(): { mes: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { mes, label: formatMesLabel(mes) };
  });
}

// ─── Shared components ────────────────────────────────────────────────────────

function HeaderBlock({ title, main, sub1, sub2, highlight }: {
  title: string; main: string; sub1?: string; sub2?: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 ${highlight ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">{title}</p>
      <p className={`text-3xl font-extrabold leading-tight ${highlight ? "text-violet-800" : "text-slate-900"}`}>{main}</p>
      {sub1 && <p className="text-xs text-slate-500 mt-1.5">{sub1}</p>}
      {sub2 && <p className="text-xs text-slate-500 mt-0.5">{sub2}</p>}
    </div>
  );
}

function TrendBadge({ curr, prev, unit = "" }: { curr: number; prev: number; unit?: string }) {
  if (prev === 0 && curr === 0) return <span className="text-xs text-slate-400">—</span>;
  const diff = curr - prev;
  const pct = prev > 0 ? Math.round((diff / prev) * 100) : 0;
  const up = diff >= 0;
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
      {up ? "↑" : "↓"} {Math.abs(diff)}{unit} ({Math.abs(pct)}%)
    </span>
  );
}

const TOOLTIP_STYLE = {
  borderRadius: "12px", border: "1px solid #e2e8f0",
  fontSize: "12px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
};

// ─── Tab: General ─────────────────────────────────────────────────────────────

function TabGeneral({ kpisMes, kpisPrevMes, kpis, mesLabel }: {
  kpisMes: KpiData; kpisPrevMes: KpiData; kpis: KpiData; mesLabel: string;
}) {
  const { resumen } = kpisMes;
  const prevRes = kpisPrevMes.resumen;
  const ytd = kpis.comparacion.anio.actual;
  const ytdPrev = kpis.comparacion.anio.anterior;

  return (
    <div className="space-y-5">
      {/* Header blocks — datos del mes seleccionado */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <HeaderBlock
          title={`Presupuestos ${mesLabel}`}
          main={String(resumen.total)}
          sub1={`1ª Visita: ${resumen.primeraVisita} · Con Historia: ${resumen.conHistoria}`}
          sub2={resumen.total === 0 ? "Sin presupuestos este mes" : undefined}
        />
        <HeaderBlock
          title="Aceptados"
          main={String(resumen.aceptados)}
          sub1={`${resumen.tasaAceptacion}% de conversión`}
          sub2={`vs mes anterior: ${prevRes.aceptados}`}
        />
        <HeaderBlock
          title="Presupuestos activos"
          main={`€${resumen.importeActivos.toLocaleString("es-ES")}`}
          sub1="En Interesado + En Duda + En Negociación"
        />
        <HeaderBlock
          title={`Este año (${new Date().getFullYear()})`}
          main={String(ytd)}
          highlight
          sub1={`${kpis.comparacion.anio.actual} presupuestos YTD`}
          sub2={ytdPrev > 0 ? `vs año anterior: ${ytdPrev}` : undefined}
        />
      </div>

      {/* Comparación vs mes anterior */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-bold text-slate-700 mb-3">
          {mesLabel} vs mes anterior
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Presupuestos", curr: resumen.total, prev: prevRes.total },
            { label: "Aceptados", curr: resumen.aceptados, prev: prevRes.aceptados },
            { label: "Tasa %", curr: resumen.tasaAceptacion, prev: prevRes.tasaAceptacion, unit: "%" },
            { label: "En juego €", curr: resumen.importeActivos, prev: prevRes.importeActivos, unit: "€" },
          ].map(({ label, curr, prev, unit }) => (
            <div key={label}>
              <p className="text-[10px] text-slate-500 font-medium mb-1">{label}</p>
              <p className="text-lg font-extrabold text-slate-900">{unit === "€" ? `€${curr.toLocaleString("es-ES")}` : `${curr}${unit ?? ""}`}</p>
              <TrendBadge curr={curr} prev={prev} unit={unit === "€" ? "" : (unit ?? "")} />
            </div>
          ))}
        </div>
      </div>

      {/* AreaChart — evolución 12 meses */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-900 mb-1">Evolución mensual (12 meses)</p>
        <p className="text-xs text-slate-400 mb-4">Azul = presupuestos ofrecidos · Verde = aceptados</p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={kpis.tendenciaMensual} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 700 }} />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            <Area type="monotone" dataKey="total" name="Ofrecidos" stroke="#3b82f6" strokeWidth={2} fill="url(#g1)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="aceptados" name="Aceptados" stroke="#22c55e" strokeWidth={2} fill="url(#g2)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Tab: Tarifas ─────────────────────────────────────────────────────────────

function TabTarifas({ kpisMes, kpisPrevMes, kpis, mesLabel }: {
  kpisMes: KpiData; kpisPrevMes: KpiData; kpis: KpiData; mesLabel: string;
}) {
  const privadoMes = kpisMes.porTipoPaciente.find((t) => t.tipo === "Privado");
  const adeslasMes = kpisMes.porTipoPaciente.find((t) => t.tipo === "Adeslas");
  const privadoPrev = kpisPrevMes.porTipoPaciente.find((t) => t.tipo === "Privado");
  const adeslasPrev = kpisPrevMes.porTipoPaciente.find((t) => t.tipo === "Adeslas");

  return (
    <div className="space-y-5">
      {/* Bloques del mes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { tipo: "Privado", mes: privadoMes, prev: privadoPrev, color: "bg-blue-50 border-blue-200" },
          { tipo: "Adeslas", mes: adeslasMes, prev: adeslasPrev, color: "bg-orange-50 border-orange-200" },
        ].map(({ tipo, mes, prev, color }) => (
          <div key={tipo} className={`rounded-2xl border p-5 ${color}`}>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">{tipo} — {mesLabel}</p>
            <p className="text-3xl font-extrabold text-slate-900">{mes?.total ?? 0}</p>
            <p className="text-xs text-slate-600 mt-1">
              {mes?.aceptados ?? 0} aceptados · {mes?.tasa ?? 0}% conversión
            </p>
            {(mes?.importe ?? 0) > 0 && (
              <p className="text-xs font-semibold text-emerald-700 mt-0.5">€{(mes?.importe ?? 0).toLocaleString("es-ES")} aceptado</p>
            )}
            <div className="mt-2">
              <TrendBadge curr={mes?.total ?? 0} prev={prev?.total ?? 0} />
            </div>
          </div>
        ))}
      </div>

      {/* Evolución 12 meses — 4 barras: ofrecido/aceptado por tarifa */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-900 mb-1">Evolución mensual por tarifa (12 meses)</p>
        <p className="text-xs text-slate-400 mb-4">Barras claras = ofrecidos · Barras oscuras = aceptados</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={kpis.tendenciaPorTarifa} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barGap={1} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            <Bar dataKey="privado" name="Privado ofrecido" fill="#93c5fd" radius={[3, 3, 0, 0]} />
            <Bar dataKey="privadoAcept" name="Privado aceptado" fill="#2563eb" radius={[3, 3, 0, 0]} />
            <Bar dataKey="adeslas" name="Adeslas ofrecido" fill="#fed7aa" radius={[3, 3, 0, 0]} />
            <Bar dataKey="adeslasAcept" name="Adeslas aceptado" fill="#ea580c" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla resumen — todos los meses */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">Resumen por tarifa — {mesLabel}</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              {["Tarifa", "Ofrecidos", "Aceptados", "Tasa conv.", "€ Aceptado", "vs mes ant."].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kpisMes.porTipoPaciente.map((t) => {
              const p = kpisPrevMes.porTipoPaciente.find((x) => x.tipo === t.tipo);
              return (
                <tr key={t.tipo} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{t.tipo}</td>
                  <td className="px-4 py-3 text-slate-700">{t.total}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">{t.aceptados}</td>
                  <td className="px-4 py-3 font-bold text-slate-900">{t.tasa}%</td>
                  <td className="px-4 py-3 text-slate-700">€{t.importe.toLocaleString("es-ES")}</td>
                  <td className="px-4 py-3"><TrendBadge curr={t.total} prev={p?.total ?? 0} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Tipo Paciente ───────────────────────────────────────────────────────

function TabPaciente({ kpisMes, kpisPrevMes, kpis, mesLabel }: {
  kpisMes: KpiData; kpisPrevMes: KpiData; kpis: KpiData; mesLabel: string;
}) {
  const tipoLabel = (t: string) => t === "Primera Visita" ? "1ª Visita (Nuevo)" : "Con Historia (Recurrente)";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {kpisMes.porTipoVisita.map((t) => {
          const prev = kpisPrevMes.porTipoVisita.find((x) => x.tipo === t.tipo);
          return (
            <div key={t.tipo} className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">{tipoLabel(t.tipo)} — {mesLabel}</p>
              <p className="text-3xl font-extrabold text-slate-900">{t.total}</p>
              <p className="text-xs text-slate-500 mt-1">{t.aceptados} aceptados · {t.tasa}% conversión</p>
              {t.importe > 0 && <p className="text-xs font-semibold text-emerald-700 mt-0.5">€{t.importe.toLocaleString("es-ES")} aceptado</p>}
              <div className="mt-2"><TrendBadge curr={t.total} prev={prev?.total ?? 0} /></div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-900 mb-1">Evolución mensual por tipo de paciente (12 meses)</p>
        <p className="text-xs text-slate-400 mb-4">Violeta = 1ª Visita (nuevos) · Cyan = Con Historia (recurrentes)</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={kpis.tendenciaPorVisita} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barGap={1} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            <Bar dataKey="primera" name="1ª Visita ofrecido" fill="#c4b5fd" radius={[3, 3, 0, 0]} />
            <Bar dataKey="primeraAcept" name="1ª Visita aceptado" fill="#7c3aed" radius={[3, 3, 0, 0]} />
            <Bar dataKey="historia" name="Con Historia ofrecido" fill="#a5f3fc" radius={[3, 3, 0, 0]} />
            <Bar dataKey="historiaAcept" name="Con Historia aceptado" fill="#0891b2" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">Resumen por tipo de paciente — {mesLabel}</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              {["Tipo", "Ofrecidos", "Aceptados", "Tasa conv.", "€ Aceptado", "vs mes ant."].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kpisMes.porTipoVisita.map((t) => {
              const prev = kpisPrevMes.porTipoVisita.find((x) => x.tipo === t.tipo);
              return (
                <tr key={t.tipo} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{tipoLabel(t.tipo)}</td>
                  <td className="px-4 py-3 text-slate-700">{t.total}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">{t.aceptados}</td>
                  <td className="px-4 py-3 font-bold text-slate-900">{t.tasa}%</td>
                  <td className="px-4 py-3 text-slate-700">€{t.importe.toLocaleString("es-ES")}</td>
                  <td className="px-4 py-3"><TrendBadge curr={t.total} prev={prev?.total ?? 0} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Tratamientos ────────────────────────────────────────────────────────

function TabTratamientos({ kpisMes, kpis, mesLabel }: { kpisMes: KpiData; kpis: KpiData; mesLabel: string }) {
  const top8 = [...kpisMes.porTratamiento].sort((a, b) => b.tasa - a.tasa).slice(0, 8);
  const top8HistAll = [...kpis.porTratamiento].sort((a, b) => b.tasa - a.tasa).slice(0, 8);

  return (
    <div className="space-y-5">
      {/* Bar chart this month */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-900 mb-1">Top 8 tratamientos — tasa de conversión en {mesLabel}</p>
        <p className="text-xs text-slate-400 mb-4">Ordenados de mayor a menor tasa de aceptación</p>
        {top8.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">Sin datos para este mes</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={top8} layout="vertical" margin={{ top: 4, right: 40, left: 100, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} unit="%" />
              <YAxis type="category" dataKey="grupo" tick={{ fontSize: 10, fill: "#475569" }} axisLine={false} tickLine={false} width={100} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, "Tasa"]} />
              <Bar dataKey="tasa" name="Tasa %" fill="#7c3aed" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table this month */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">Tratamientos — {mesLabel}</p>
        {kpisMes.porTratamiento.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-400">Sin datos para este mes</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                {["Tratamiento", "Ofrecidos", "Aceptados", "Tasa", "€ Aceptado"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpisMes.porTratamiento.map((t) => (
                <tr key={t.grupo} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{t.grupo}</td>
                  <td className="px-4 py-3 text-slate-700">{t.total}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">{t.aceptados}</td>
                  <td className="px-4 py-3 font-bold text-slate-900">{t.tasa}%</td>
                  <td className="px-4 py-3 text-slate-700">€{t.importe.toLocaleString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Historical top 8 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-900 mb-4">Top 8 tratamientos — histórico (todos los tiempos)</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={top8HistAll} layout="vertical" margin={{ top: 4, right: 40, left: 100, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} unit="%" />
            <YAxis type="category" dataKey="grupo" tick={{ fontSize: 10, fill: "#475569" }} axisLine={false} tickLine={false} width={100} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, "Tasa"]} />
            <Bar dataKey="tasa" name="Tasa %" fill="#0891b2" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Tab: Doctores ────────────────────────────────────────────────────────────

function TabDoctores({ kpisMes, kpisPrevMes, kpis, mesLabel }: {
  kpisMes: KpiData; kpisPrevMes: KpiData; kpis: KpiData; mesLabel: string;
}) {
  const [evolDoctor, setEvolDoctor] = useState<string | null>(null);
  const [evolData, setEvolData] = useState<KpiData | null>(null);

  function downloadCsv() {
    const rows = [
      ["Doctor", "Especialidad", "Este mes", "Aceptados", "Tasa%", "vs prev mes"],
      ...kpisMes.porDoctor.map((d) => {
        const p = kpisPrevMes.porDoctor.find((x) => x.doctor === d.doctor);
        return [d.doctor, d.especialidad, d.total, d.aceptados, d.tasa + "%", (p ? d.total - p.total : 0)];
      }),
    ];
    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "kpis_doctores.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function loadDoctorEvol(doctor: string) {
    if (evolDoctor === doctor) { setEvolDoctor(null); setEvolData(null); return; }
    try {
      const url = new URL("/api/presupuestos/kpis", location.href);
      url.searchParams.set("doctor", doctor);
      const res = await fetch(url.toString());
      const d = await res.json();
      setEvolDoctor(doctor);
      setEvolData(d.kpis ?? null);
    } catch { /* ignore */ }
  }

  const prevMap = new Map(kpisPrevMes.porDoctor.map((d) => [d.doctor, d]));

  return (
    <div className="space-y-5">
      {/* Visual doctor cards — comparativa */}
      {kpisMes.porDoctor.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-bold text-slate-900 mb-1">Comparativa de doctores — {mesLabel}</p>
          <p className="text-xs text-slate-400 mb-4">Ordenados por tasa de aceptación</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[...kpisMes.porDoctor].sort((a, b) => b.tasa - a.tasa).map((d) => {
              const prev = prevMap.get(d.doctor);
              const espColor = ESPECIALIDAD_COLOR[d.especialidad as keyof typeof ESPECIALIDAD_COLOR] ?? "#e2e8f0";
              return (
                <div
                  key={d.doctor}
                  onClick={() => loadDoctorEvol(d.doctor)}
                  className="rounded-xl border border-slate-200 p-4 cursor-pointer hover:shadow-md transition-shadow"
                  style={{ background: espColor + "18" }}
                >
                  <div className="flex items-start justify-between gap-1 mb-2">
                    <p className="text-xs font-bold text-slate-900 leading-tight">{d.doctor}</p>
                    {prev && <TrendBadge curr={d.total} prev={prev.total} />}
                  </div>
                  <span
                    className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mb-3 inline-block"
                    style={{ background: espColor, color: "#1e293b" }}
                  >
                    {d.especialidad}
                  </span>
                  {/* Tasa grande */}
                  <p className="text-3xl font-extrabold text-slate-900 mt-1">{d.tasa}%</p>
                  <p className="text-[10px] text-slate-400 mb-2">tasa aceptación</p>
                  {/* Progress bar */}
                  <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2">
                    <div
                      className="h-1.5 rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${d.tasa}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-600">
                    {d.aceptados} aceptados / {d.total} totales
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabla comparativa */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900">Tabla de doctores — {mesLabel}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Clic en un doctor para ver su evolución</p>
          </div>
          <button onClick={downloadCsv} className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">CSV</button>
        </div>
        {kpisMes.porDoctor.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-400">Sin datos para este mes</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                {["Doctor", "Especialidad", "Ofrecidos", "Aceptados", "Tasa", "vs mes ant."].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpisMes.porDoctor.map((d) => {
                const prev = prevMap.get(d.doctor);
                const isSelected = evolDoctor === d.doctor;
                return (
                  <>
                    <tr
                      key={d.doctor}
                      onClick={() => loadDoctorEvol(d.doctor)}
                      className={`border-b border-slate-50 cursor-pointer transition-colors ${isSelected ? "bg-violet-50" : "hover:bg-slate-50"}`}
                      style={{ background: isSelected ? undefined : (ESPECIALIDAD_COLOR[d.especialidad as keyof typeof ESPECIALIDAD_COLOR] ?? "#f8fafc") + "18" }}
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                        <span className="mr-1 text-[10px] text-slate-400">{isSelected ? "▼" : "▶"}</span>
                        {d.doctor}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{d.especialidad}</td>
                      <td className="px-3 py-2.5 text-slate-700">{d.total}</td>
                      <td className="px-3 py-2.5 font-semibold text-emerald-700">{d.aceptados}</td>
                      <td className="px-3 py-2.5 font-bold text-slate-900">{d.tasa}%</td>
                      <td className="px-3 py-2.5"><TrendBadge curr={d.total} prev={prev?.total ?? 0} /></td>
                    </tr>
                    {isSelected && evolData && (
                      <tr key={`${d.doctor}-evol`}>
                        <td colSpan={6} className="px-4 py-4 bg-violet-50 border-b border-violet-100">
                          <p className="text-xs font-bold text-violet-700 mb-3">Evolución 12 meses — {d.doctor}</p>
                          <ResponsiveContainer width="100%" height={160}>
                            <AreaChart data={evolData.tendenciaMensual} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                              <defs>
                                <linearGradient id="gd1" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.15} />
                                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#ede9fe" />
                              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#8b5cf6" }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 9, fill: "#8b5cf6" }} axisLine={false} tickLine={false} allowDecimals={false} />
                              <Tooltip contentStyle={{ ...TOOLTIP_STYLE, background: "#faf5ff" }} />
                              <Area type="monotone" dataKey="total" name="Ofrecidos" stroke="#7c3aed" strokeWidth={2} fill="url(#gd1)" dot={false} />
                              <Area type="monotone" dataKey="aceptados" name="Aceptados" stroke="#22c55e" strokeWidth={2} fill="none" dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Historical comparison table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">Histórico total — todos los tiempos</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                {["Doctor", "Especialidad", "Total", "1ª Visita", "Con Hist.", "Aceptados", "Tasa"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpis.porDoctor.map((d) => (
                <tr key={d.doctor} className="border-b border-slate-50 last:border-0 hover:bg-slate-50"
                  style={{ background: (ESPECIALIDAD_COLOR[d.especialidad as keyof typeof ESPECIALIDAD_COLOR] ?? "#f8fafc") + "28" }}>
                  <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">{d.doctor}</td>
                  <td className="px-3 py-2.5 text-slate-600">{d.especialidad}</td>
                  <td className="px-3 py-2.5 text-slate-700">{d.total}</td>
                  <td className="px-3 py-2.5 text-slate-700">{d.primeraVisita}</td>
                  <td className="px-3 py-2.5 text-slate-700">{d.conHistoria}</td>
                  <td className="px-3 py-2.5 font-semibold text-emerald-700">{d.aceptados}</td>
                  <td className="px-3 py-2.5 font-bold text-slate-900">{d.tasa}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Benchmark ───────────────────────────────────────────────────────────

const ORIGEN_COLORS = ["#7c3aed","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#94a3b8"];

function TabBenchmark({ kpis, isManager }: { kpis: KpiData; isManager: boolean }) {
  const origenData = kpis.porOrigenLead ?? [];
  const motivoData = kpis.porMotivoPerdida ?? [];
  const clinicaData = kpis.porClinica ?? [];
  const totalPerdidos = motivoData.reduce((s, m) => s + m.count, 0);

  return (
    <div className="space-y-8">

      {/* ── Sección 1: Origen del lead ── */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          Conversión por origen de lead
          <span className="text-[10px] font-normal text-slate-400">todos los tiempos</span>
        </h3>

        {origenData.filter((o) => o.origen !== "sin_origen").length === 0 ? (
          <p className="text-xs text-slate-400 italic">Sin datos de origen. Empieza a registrar el canal al crear presupuestos.</p>
        ) : (
          <>
            {/* Cards */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {origenData.filter((o) => o.origen !== "sin_origen").map((o, i) => (
                <div key={o.origen} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ORIGEN_COLORS[i % ORIGEN_COLORS.length] }} />
                    <p className="text-[10px] font-bold text-slate-500 uppercase truncate">{o.label}</p>
                  </div>
                  <p className="text-2xl font-extrabold text-slate-900">{o.tasa}%</p>
                  <p className="text-[10px] text-slate-500 mt-1">{o.aceptados}/{o.total} aceptados</p>
                  {o.importe > 0 && <p className="text-[10px] text-violet-600 font-semibold mt-0.5">€{o.importe.toLocaleString("es-ES")}</p>}
                </div>
              ))}
            </div>

            {/* Bar chart */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase mb-3">Tasa de conversión %</p>
              <ResponsiveContainer width="100%" height={Math.max(180, origenData.filter((o) => o.origen !== "sin_origen").length * 44)}>
                <BarChart
                  layout="vertical"
                  data={origenData.filter((o) => o.origen !== "sin_origen")}
                  margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v}%`, "Tasa"]} />
                  <Bar dataKey="tasa" radius={[0, 6, 6, 0]} fill="#7c3aed" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-500">Origen</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Ofrecidos</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Aceptados</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Tasa</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-slate-500">€</th>
                  </tr>
                </thead>
                <tbody>
                  {origenData.map((o, i) => (
                    <tr key={o.origen} className={i % 2 === 0 ? "" : "bg-slate-50"}>
                      <td className="px-4 py-2 font-medium text-slate-700">{o.label}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{o.total}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{o.aceptados}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`font-bold ${o.tasa >= 50 ? "text-emerald-700" : o.tasa >= 25 ? "text-amber-700" : "text-rose-600"}`}>
                          {o.tasa}%
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600">
                        {o.importe > 0 ? `€${o.importe.toLocaleString("es-ES")}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Sección 2: Clínicas (solo manager) ── */}
      {isManager && clinicaData.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Comparativa de clínicas</h3>
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-500">#</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500">Clínica</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Total</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Aceptados</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Tasa</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-500">€ aceptado</th>
                </tr>
              </thead>
              <tbody>
                {clinicaData.map((c, i) => (
                  <tr key={c.clinica} className={i % 2 === 0 ? "" : "bg-slate-50"}>
                    <td className="px-4 py-2.5">
                      {i === 0 ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">#1</span>
                      ) : i === 1 ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">#2</span>
                      ) : i === 2 ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600">#3</span>
                      ) : (
                        <span className="text-[10px] text-slate-400">#{i + 1}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-700">{c.clinica}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{c.total}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{c.aceptados}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`font-bold ${c.tasa >= 50 ? "text-emerald-700" : c.tasa >= 25 ? "text-amber-700" : "text-rose-600"}`}>
                        {c.tasa}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {c.importe > 0 ? `€${c.importe.toLocaleString("es-ES")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sección 3: Motivos de pérdida ── */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          Motivos de pérdida
          {totalPerdidos > 0 && (
            <span className="text-[10px] font-normal text-slate-400">{totalPerdidos} perdidos</span>
          )}
        </h3>

        {motivoData.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Sin presupuestos perdidos registrados.</p>
        ) : (
          <>
            {/* Bar chart */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <ResponsiveContainer width="100%" height={Math.max(160, motivoData.length * 44)}>
                <BarChart
                  layout="vertical"
                  data={motivoData}
                  margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [v, "Casos"]} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-500">Motivo</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Casos</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-slate-500">%</th>
                  </tr>
                </thead>
                <tbody>
                  {motivoData.map((m, i) => (
                    <tr key={m.motivo} className={i % 2 === 0 ? "" : "bg-slate-50"}>
                      <td className="px-4 py-2 font-medium text-slate-700">{m.label}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{m.count}</td>
                      <td className="px-4 py-2 text-right font-bold text-rose-600">{m.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

    </div>
  );
}

// ─── Tab: Motor IA ───────────────────────────────────────────────────────────

const TONO_META: Record<string, { label: string; color: string; textColor: string; hex: string }> = {
  directo:  { label: "Directo",  color: "bg-slate-100",   textColor: "text-slate-700", hex: "#64748b" },
  empatico: { label: "Empático", color: "bg-violet-50",   textColor: "text-violet-700", hex: "#7c3aed" },
  urgencia: { label: "Urgencia", color: "bg-rose-50",     textColor: "text-rose-700",   hex: "#e11d48" },
};

function TabMotorIA({ stats, loading, isDemo }: {
  stats: TonosStats | null;
  loading: boolean;
  isDemo: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-24 rounded-2xl bg-slate-100" />
        <div className="h-40 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center">
        <p className="text-sm font-semibold text-slate-500">Sin datos de Motor IA todavía</p>
        <p className="text-xs text-slate-400 mt-1">
          Los datos aparecen cuando se envían mensajes con el generador IA y los presupuestos se resuelven (Aceptado / Perdido).
        </p>
      </div>
    );
  }

  // Best tono
  const tonos = ["directo", "empatico", "urgencia"] as const;
  const bestTono = tonos.reduce<string | null>((best, t) => {
    const tasa = stats[t].tasa;
    if (tasa == null) return best;
    if (best == null) return t;
    return (stats[t].tasa! > (stats[best as keyof TonosStats]?.tasa ?? -1)) ? t : best;
  }, null);

  const total = tonos.reduce((s, t) => s + stats[t].contactados, 0);
  const totalAcep = tonos.reduce((s, t) => s + stats[t].aceptados, 0);
  const tasaGlobal = total > 0 ? Math.round((totalAcep / total) * 100) : null;

  return (
    <div className="space-y-5">
      {isDemo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          Datos de demostración — conecta Airtable para datos reales.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Mensajes IA enviados</p>
          <p className="text-3xl font-extrabold text-slate-900">{total}</p>
          <p className="text-xs text-slate-400 mt-1">contactos con motor IA</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Tasa global IA</p>
          <p className="text-3xl font-extrabold text-slate-900">{tasaGlobal != null ? `${tasaGlobal}%` : "—"}</p>
          <p className="text-xs text-slate-400 mt-1">{totalAcep} aceptados de {total}</p>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
          <p className="text-[11px] font-semibold text-violet-400 uppercase tracking-wide mb-2">Mejor tono ★</p>
          <p className="text-3xl font-extrabold text-violet-800">
            {bestTono ? TONO_META[bestTono].label : "—"}
          </p>
          <p className="text-xs text-violet-500 mt-1">
            {bestTono && stats[bestTono as keyof TonosStats].tasa != null
              ? `${stats[bestTono as keyof TonosStats].tasa}% de conversión`
              : "Sin datos suficientes"}
          </p>
        </div>
      </div>

      {/* Per-tono table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
          A/B por tono — histórico acumulado
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              {["Tono", "Mensajes enviados", "Presup. aceptados", "Tasa conv.", ""].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tonos.map((tono) => {
              const s = stats[tono];
              const meta = TONO_META[tono];
              const isBest = bestTono === tono;
              return (
                <tr key={tono} className={`border-b border-slate-50 last:border-0 ${isBest ? "bg-violet-50" : "hover:bg-slate-50"}`}>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color} ${meta.textColor}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 font-semibold">{s.contactados}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">{s.aceptados}</td>
                  <td className="px-4 py-3">
                    {s.tasa != null ? (
                      <span className={`font-extrabold text-sm ${s.tasa >= 40 ? "text-emerald-700" : s.tasa >= 20 ? "text-amber-700" : "text-rose-600"}`}>
                        {s.tasa}%
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[10px]">Insuf. datos (&lt;10)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isBest && s.tasa != null && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">★ Mejor</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[10px] text-slate-400 border-t border-slate-50">
          Se necesitan al menos 10 mensajes por tono para calcular la tasa. Los presupuestos pueden haber recibido mensajes de más de un tono.
        </p>
      </div>

      {/* Bar chart */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-900 mb-4">Conversión por tono</p>
        <div className="space-y-3">
          {tonos.map((tono) => {
            const s = stats[tono];
            const meta = TONO_META[tono];
            const pct = s.tasa ?? 0;
            return (
              <div key={tono} className="flex items-center gap-3">
                <span className={`text-[10px] font-bold w-16 shrink-0 ${meta.textColor}`}>{meta.label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-3 rounded-full transition-all"
                    style={{ width: `${pct}%`, background: meta.hex }}
                  />
                </div>
                <span className="text-xs font-bold text-slate-700 w-12 text-right shrink-0">
                  {s.tasa != null ? `${s.tasa}%` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main KpiView ─────────────────────────────────────────────────────────────

export default function KpiView({ user, showBenchmark = true }: { user: UserSession; showBenchmark?: boolean }) {
  const now = new Date();
  const defaultMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [kpisMes, setKpisMes] = useState<KpiData | null>(null);
  const [kpisPrevMes, setKpisPrevMes] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicas, setClinicas] = useState<string[]>([]);
  const [filterClinica, setFilterClinica] = useState(
    user.rol === "encargada_ventas" && user.clinica ? user.clinica : ""
  );
  const [filterDoctor, setFilterDoctor] = useState("");
  const [filterMes, setFilterMes] = useState(defaultMes);
  const [subTab, setSubTab] = useState<SubTab>("general");
  const meses = getLast12Months();

  // Motor IA tab state
  const [tonosStats, setTonosStats] = useState<TonosStats | null>(null);
  const [tonosLoading, setTonosLoading] = useState(false);
  const [tonosIsDemo, setTonosIsDemo] = useState(false);
  const tonosFetchedRef = useRef(false);

  useEffect(() => {
    if (user.rol !== "manager_general") return;
    fetch("/api/presupuestos/clinicas")
      .then((r) => r.json())
      .then((d) => setClinicas(d.clinicas ?? []))
      .catch(() => {});
  }, [user.rol]);

  // Lazy fetch for Motor IA tab — only once
  useEffect(() => {
    if (subTab !== "ia" || tonosFetchedRef.current) return;
    tonosFetchedRef.current = true;
    setTonosLoading(true);
    const url = new URL("/api/presupuestos/tonos-stats", location.href);
    const clinicaVal = user.rol === "encargada_ventas" && user.clinica ? user.clinica : filterClinica;
    if (clinicaVal) url.searchParams.set("clinica", clinicaVal);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => {
        setTonosStats(d.stats ?? null);
        setTonosIsDemo(d.isDemo ?? false);
      })
      .catch(() => {})
      .finally(() => setTonosLoading(false));
  }, [subTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    const url = new URL("/api/presupuestos/kpis", location.href);
    if (user.rol === "encargada_ventas" && user.clinica) url.searchParams.set("clinica", user.clinica);
    else if (filterClinica) url.searchParams.set("clinica", filterClinica);
    if (filterDoctor) url.searchParams.set("doctor", filterDoctor);
    url.searchParams.set("mes", filterMes);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => {
        setKpis(d.kpis ?? null);
        setKpisMes(d.kpisMes ?? null);
        setKpisPrevMes(d.kpisPrevMes ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user, filterClinica, filterDoctor, filterMes]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-4 gap-3">{[1,2,3,4].map((i) => <div key={i} className="h-28 rounded-2xl bg-slate-100" />)}</div>
        <div className="h-64 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (!kpis || !kpisMes || !kpisPrevMes) return <p className="text-sm text-slate-500">Error al cargar KPIs</p>;

  const mesLabel = formatMesLabel(filterMes);
  const doctorOpciones = kpis.doctores;
  const isManager = user.rol === "manager_general";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {user.rol === "manager_general" && (
          <select value={filterClinica} onChange={(e) => setFilterClinica(e.target.value)}
            className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 ${filterClinica ? "border-violet-400 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-700"}`}>
            <option value="">Todas las clínicas</option>
            {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {doctorOpciones.length > 1 && (
          <select value={filterDoctor} onChange={(e) => setFilterDoctor(e.target.value)}
            className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 ${filterDoctor ? "border-violet-400 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-700"}`}>
            <option value="">Todos los doctores</option>
            {doctorOpciones.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {/* Mes selector */}
        <select value={filterMes} onChange={(e) => setFilterMes(e.target.value)}
          className="rounded-xl border border-violet-400 bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700 font-semibold focus:outline-none focus:ring-2 focus:ring-violet-300">
          {meses.map(({ mes, label }) => (
            <option key={mes} value={mes}>{label}</option>
          ))}
        </select>
      </div>

      {/* Sub-tabs */}
      <div className="bg-white border-b border-slate-200 -mx-4 px-4">
        <div className="flex gap-0">
          {SUB_TABS.filter((t) => (showBenchmark || t.id !== "benchmark")).map((t) => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                subTab === t.id ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {subTab === "general" && <TabGeneral kpisMes={kpisMes} kpisPrevMes={kpisPrevMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "tarifas" && <TabTarifas kpisMes={kpisMes} kpisPrevMes={kpisPrevMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "paciente" && <TabPaciente kpisMes={kpisMes} kpisPrevMes={kpisPrevMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "tratamientos" && <TabTratamientos kpisMes={kpisMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "doctores" && <TabDoctores kpisMes={kpisMes} kpisPrevMes={kpisPrevMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "benchmark" && <TabBenchmark kpis={kpis} isManager={isManager} />}
      {subTab === "ia" && <TabMotorIA stats={tonosStats} loading={tonosLoading} isDemo={tonosIsDemo} />}
    </div>
  );
}
