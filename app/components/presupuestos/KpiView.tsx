"use client";

import { useEffect, useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { KpiData, UserSession } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-1">
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function SmallPie({ data, colors, title }: { data: { name: string; value: number }[]; colors: string[]; title: string }) {
  if (data.every((d) => d.value === 0)) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold text-slate-600 mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${Math.round((percent ?? 0) * 100)}%`} labelLine={false}>
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function downloadCsv(kpis: KpiData) {
  const rows = [
    ["Doctor", "Especialidad", "Total", "1ª Visita", "Con Historia", "Aceptados", "%"],
    ...kpis.porDoctor.map((d) => [
      d.doctor, d.especialidad, d.total, d.primeraVisita, d.conHistoria, d.aceptados, d.tasa + "%",
    ]),
  ];
  const csv = rows.map((r) => r.join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kpis_presupuestos.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function KpiView({ user }: { user: UserSession }) {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = new URL("/api/presupuestos/kpis", location.href);
    if (user.rol === "encargada_ventas" && user.clinica) {
      url.searchParams.set("clinica", user.clinica);
    }
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => { setKpis(d.kpis); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[1,2,3,4,5].map((i) => <div key={i} className="h-24 rounded-2xl bg-slate-100" />)}
        </div>
        <div className="h-56 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (!kpis) return <p className="text-sm text-slate-500">Error al cargar KPIs</p>;

  const { resumen, porEstado, porDoctor, porTratamiento, porTipoPaciente, porTipoVisita } = kpis;

  const estadoChartData = porEstado.map((e) => ({
    name: ESTADO_CONFIG[e.estado].label,
    value: e.count,
  }));
  const estadoColors = porEstado.map((e) => ESTADO_CONFIG[e.estado].hex);

  const aceptVsRest = [
    { name: "Aceptados", value: resumen.aceptados },
    { name: "Pendientes", value: resumen.total - resumen.aceptados - (porEstado.find((e) => e.estado === "RECHAZADO")?.count ?? 0) },
    { name: "Rechazados", value: porEstado.find((e) => e.estado === "RECHAZADO")?.count ?? 0 },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-5">
      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Total presupuestos" value={String(resumen.total)} />
        <StatCard label="Aceptados" value={String(resumen.aceptados)} sub="Finalizado + En Tratamiento" />
        <StatCard label="% Aceptación" value={`${resumen.tasaAceptacion}%`} />
        <StatCard label="€ Importe aceptado" value={`€${resumen.importeAceptado.toLocaleString("es-ES")}`} />
        <StatCard label="Pacientes nuevos" value={String(resumen.pacientesNuevos)} sub="1ª Visita aceptados" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <SmallPie
          title="Distribución por estado"
          data={estadoChartData}
          colors={estadoColors}
        />
        <SmallPie
          title="Aceptados vs Pendientes vs Rechazados"
          data={aceptVsRest}
          colors={["#00B050", "#FF9900", "#FF0000"]}
        />
        <SmallPie
          title="1ª Visita vs Historial"
          data={porTipoVisita.map((d) => ({ name: d.tipo === "Primera Visita" ? "1ª Visita" : "Historial", value: d.count }))}
          colors={["#D9B3E0", "#BDD7EE"]}
        />
        <SmallPie
          title="Privado vs Adeslas"
          data={porTipoPaciente.map((d) => ({ name: d.tipo, value: d.count }))}
          colors={["#94a3b8", "#BDD7EE"]}
        />
        <SmallPie
          title="Distribución por tratamiento"
          data={porTratamiento.slice(0, 6).map((d) => ({ name: d.grupo, value: d.total }))}
          colors={["#9DC3E6", "#C6EFCE", "#E2AFCF", "#D9B3E0", "#BDD7EE", "#FFFF00"]}
        />
      </div>

      {/* Tabla doctores */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-900">Por doctor</p>
          <button
            onClick={() => downloadCsv(kpis)}
            className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            📥 Descargar CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                {["Doctor", "Especialidad", "Total", "1ª", "Hist.", "Acept.", "%"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porDoctor.map((d) => (
                <tr
                  key={d.doctor}
                  className="border-b border-slate-50 hover:bg-slate-50"
                  style={{ background: ESPECIALIDAD_COLOR[d.especialidad as keyof typeof ESPECIALIDAD_COLOR] + "33" }}
                >
                  <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{d.doctor}</td>
                  <td className="px-3 py-2 text-slate-600">{d.especialidad}</td>
                  <td className="px-3 py-2 text-slate-700">{d.total}</td>
                  <td className="px-3 py-2 text-slate-700">{d.primeraVisita}</td>
                  <td className="px-3 py-2 text-slate-700">{d.conHistoria}</td>
                  <td className="px-3 py-2 font-semibold text-emerald-700">{d.aceptados}</td>
                  <td className="px-3 py-2 font-bold text-slate-900">{d.tasa}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabla tratamientos */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <p className="px-4 py-3 text-sm font-bold text-slate-900 border-b border-slate-100">
          Por tratamiento
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                {["Tratamiento", "Total", "Aceptados", "%", "€ Importe"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porTratamiento.map((t) => (
                <tr key={t.grupo} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">{t.grupo}</td>
                  <td className="px-3 py-2 text-slate-700">{t.total}</td>
                  <td className="px-3 py-2 font-semibold text-emerald-700">{t.aceptados}</td>
                  <td className="px-3 py-2 font-bold text-slate-900">{t.tasa}%</td>
                  <td className="px-3 py-2 text-slate-700">€{t.importe.toLocaleString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
