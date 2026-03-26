"use client";

import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { KpiData, UserSession } from "../../lib/presupuestos/types";
import { ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";

// ─── Header block ─────────────────────────────────────────────────────────────

function HeaderBlock({
  title, main, sub1, sub2,
}: {
  title: string; main: string; sub1?: string; sub2?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">{title}</p>
      <p className="text-3xl font-extrabold text-slate-900 leading-tight">{main}</p>
      {sub1 && <p className="text-xs text-slate-500 mt-1.5">{sub1}</p>}
      {sub2 && <p className="text-xs text-slate-500 mt-0.5">{sub2}</p>}
    </div>
  );
}

// ─── Comparación card ─────────────────────────────────────────────────────────

function ComparacionCard({
  label, actual, anterior, diff: _diff, diffPct,
}: {
  label: string; actual: number; anterior: number; diff: number; diffPct: number;
}) {
  const up = diffPct >= 0;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 flex items-center justify-between gap-3">
      <div>
        <p className="text-[11px] font-medium text-slate-500 mb-0.5">{label}</p>
        <p className="text-xl font-extrabold text-slate-900">{actual}</p>
        <p className="text-[10px] text-slate-400">anterior: {anterior}</p>
      </div>
      <div
        className={`text-sm font-bold px-2.5 py-1 rounded-xl shrink-0 ${
          actual === 0 && anterior === 0
            ? "text-slate-400 bg-slate-50"
            : up
            ? "text-emerald-700 bg-emerald-50"
            : "text-rose-700 bg-rose-50"
        }`}
      >
        {actual === 0 && anterior === 0 ? "—" : `${up ? "↑" : "↓"} ${Math.abs(diffPct)}%`}
      </div>
    </div>
  );
}

// ─── Segment table ────────────────────────────────────────────────────────────

function SegmentTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; total: number; aceptados: number; tasa: number }[];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
        {title}
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100">
            {["Segmento", "Total", "Aceptados", "Tasa"].map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
              <td className="px-3 py-2.5 font-medium text-slate-800">{r.label}</td>
              <td className="px-3 py-2.5 text-slate-600">{r.total}</td>
              <td className="px-3 py-2.5 font-semibold text-emerald-700">{r.aceptados}</td>
              <td className="px-3 py-2.5">
                <span className="font-bold text-slate-900">{r.tasa}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function KpiView({ user }: { user: UserSession }) {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicas, setClinicas] = useState<string[]>([]);
  const [filterClinica, setFilterClinica] = useState(
    user.rol === "encargada_ventas" && user.clinica ? user.clinica : ""
  );
  const [filterDoctor, setFilterDoctor] = useState("");

  // Load clinicas (manager only)
  useEffect(() => {
    if (user.rol !== "manager_general") return;
    fetch("/api/presupuestos/clinicas")
      .then((r) => r.json())
      .then((d) => setClinicas(d.clinicas ?? []))
      .catch(() => {});
  }, [user.rol]);

  // Load KPIs
  useEffect(() => {
    setLoading(true);
    const url = new URL("/api/presupuestos/kpis", location.href);
    if (user.rol === "encargada_ventas" && user.clinica) {
      url.searchParams.set("clinica", user.clinica);
    } else if (filterClinica) {
      url.searchParams.set("clinica", filterClinica);
    }
    if (filterDoctor) url.searchParams.set("doctor", filterDoctor);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => { setKpis(d.kpis); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user, filterClinica, filterDoctor]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-2xl bg-slate-100" />)}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-slate-100" />)}
        </div>
        <div className="h-64 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (!kpis) return <p className="text-sm text-slate-500">Error al cargar KPIs</p>;

  const {
    resumen, comparacion, porDoctor, porTratamiento,
    porTipoPaciente, porTipoVisita, tendenciaMensual,
  } = kpis;

  // Derive doctor list from loaded kpis for filter
  const doctorOpciones = porDoctor.map((d) => d.doctor);

  const segmentoPaciente = porTipoPaciente.map((d) => ({
    label: d.tipo, total: d.total, aceptados: d.aceptados, tasa: d.tasa,
  }));
  const segmentoVisita = porTipoVisita.map((d) => ({
    label: d.tipo === "Primera Visita" ? "1ª Visita" : "Con Historia",
    total: d.total, aceptados: d.aceptados, tasa: d.tasa,
  }));
  const segmentoTratamiento = porTratamiento.slice(0, 8).map((t) => ({
    label: t.grupo, total: t.total, aceptados: t.aceptados, tasa: t.tasa,
  }));

  function downloadCsv() {
    const rows = [
      ["Doctor", "Especialidad", "Total", "1ª Visita", "Con Historia", "Aceptados", "%"],
      ...porDoctor.map((d) => [
        d.doctor, d.especialidad, d.total, d.primeraVisita, d.conHistoria, d.aceptados, d.tasa + "%",
      ]),
    ];
    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "kpis_presupuestos.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">

      {/* Filters */}
      {(user.rol === "manager_general" || doctorOpciones.length > 0) && (
        <div className="flex flex-wrap gap-2 items-center">
          {user.rol === "manager_general" && (
            <select
              value={filterClinica}
              onChange={(e) => setFilterClinica(e.target.value)}
              className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="">Todas las clínicas</option>
              {clinicas.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          {doctorOpciones.length > 1 && (
            <select
              value={filterDoctor}
              onChange={(e) => setFilterDoctor(e.target.value)}
              className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="">Todos los doctores</option>
              {doctorOpciones.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* 3-block header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <HeaderBlock
          title="Presupuestos ofrecidos"
          main={String(resumen.total)}
          sub1={`1ª Visita: ${resumen.primeraVisita}`}
          sub2={`Con Historia: ${resumen.conHistoria}`}
        />
        <HeaderBlock
          title="Tasa de aceptación"
          main={`${resumen.tasaAceptacion}%`}
          sub1={`${resumen.aceptados} aceptados de ${resumen.total}`}
          sub2={
            comparacion.mesActual.anterior > 0
              ? `${comparacion.mesActual.diffPct >= 0 ? "↑" : "↓"} ${Math.abs(
                  comparacion.mesActual.diffPct
                )}% vs mes anterior`
              : undefined
          }
        />
        <HeaderBlock
          title="Presupuestos activos"
          main={`€${resumen.importeActivos.toLocaleString("es-ES")}`}
          sub1="Interesado + En Duda + En Negociación"
        />
      </div>

      {/* Comparación temporal */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ComparacionCard label="Este mes vs mes anterior" {...comparacion.mesActual} />
        <ComparacionCard label="Este trimestre vs anterior" {...comparacion.trimestre} />
        <ComparacionCard label="Este año vs año anterior" {...comparacion.anio} />
      </div>

      {/* AreaChart — evolución mensual */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-900 mb-4">Evolución mensual (últimos 12 meses)</p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart
            data={tendenciaMensual}
            margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradAceptados" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                fontSize: "12px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              }}
              labelStyle={{ fontWeight: 700, color: "#0f172a" }}
            />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            <Area
              type="monotone"
              dataKey="total"
              name="Ofrecidos"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#gradTotal)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
            <Area
              type="monotone"
              dataKey="aceptados"
              name="Aceptados"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#gradAceptados)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Aceptación por segmento */}
      <div>
        <p className="text-sm font-bold text-slate-900 mb-3">Aceptación por segmento</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SegmentTable title="Tipo de paciente" rows={segmentoPaciente} />
          <SegmentTable title="Tipo de visita" rows={segmentoVisita} />
          <SegmentTable title="Por tratamiento" rows={segmentoTratamiento} />
        </div>
      </div>

      {/* Tabla por doctor */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-900">Por doctor</p>
          <button
            onClick={downloadCsv}
            className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Descargar CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                {["Doctor", "Especialidad", "Total", "1ª", "Hist.", "Acept.", "%"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porDoctor.map((d) => (
                <tr
                  key={d.doctor}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50"
                  style={{
                    background:
                      (ESPECIALIDAD_COLOR[d.especialidad as keyof typeof ESPECIALIDAD_COLOR] ??
                        "#f8fafc") + "28",
                  }}
                >
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
