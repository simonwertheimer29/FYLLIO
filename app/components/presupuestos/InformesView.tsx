"use client";

import { useState, useMemo, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { UserSession } from "../../lib/presupuestos/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MES_LABEL = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function getYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getLast12Months(): { value: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = getYYYYMM(d);
    const label = `${MES_LABEL[d.getMonth()]} ${d.getFullYear()}`;
    return { value, label };
  });
}

function getPrevYYYYMM(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return getYYYYMM(d);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type InformeData = {
  informe: string;
  generadoEn: string;
  mes: string;
  clinica: string;
  datosUsados: {
    total: number;
    aceptados: number;
    perdidos: number;
    activos: number;
    tasa: number;
    importeTotal: number;
    importePipeline: number;
    porDoctor?: { doctor: string; total: number; aceptados: number; tasa: number }[];
    porOrigen?: { origen: string; count: number }[];
    porMotivo?: { motivo: string; count: number }[];
    privados?: { total: number; tasa: number };
    adeslas?: { total: number; tasa: number };
    tendenciaMensual?: { mes: string; label: string; total: number; aceptados: number }[];
    porClinica?: { clinica: string; total: number; aceptados: number; importeTotal: number; tasa: number }[];
    abTonos?: { tono: string; mensajes: number; aceptados: number; tasa: number }[];
  };
};

type KpisMes = {
  total: number;
  aceptados: number;
  tasa: number;
  importe: number;
};

// ─── Forecasting logic ───────────────────────────────────────────────────────

function calcularForecasting(
  kpisMeses: Map<string, KpisMes>,
  tasaEsperada: number // 0–100
): { mes: string; label: string; importeProyectado: number; confianza: 3 | 2 | 1 }[] {
  const now = new Date();
  const result = [];

  // Últimos 3 meses completos para la estimación principal
  const last3 = Array.from({ length: 3 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i - 1, 1);
    return getYYYYMM(d);
  });

  // Fallback: últimos 12 meses si los 3 más recientes no tienen datos suficientes
  const allMeses = Array.from(kpisMeses.keys());
  const totalPresupuestosTodos = allMeses.reduce((s, m) => s + (kpisMeses.get(m)?.total ?? 0), 0);
  const mesesConDatos = allMeses.filter((m) => (kpisMeses.get(m)?.total ?? 0) > 0).length;

  let avgTotal = last3.reduce((s, mes) => s + (kpisMeses.get(mes)?.total ?? 0), 0) / 3;
  // Si los últimos 3 meses no tienen datos, usar promedio de todos los meses con datos
  if (avgTotal === 0 && mesesConDatos > 0) {
    avgTotal = totalPresupuestosTodos / mesesConDatos;
  }

  // Importe promedio por presupuesto aceptado (€/aceptado)
  const importeYAceptados = allMeses.reduce(
    (acc, m) => {
      const k = kpisMeses.get(m);
      if (k && k.aceptados > 0) {
        acc.importe += k.importe;
        acc.aceptados += k.aceptados;
      }
      return acc;
    },
    { importe: 0, aceptados: 0 }
  );
  const avgImporteUnit =
    importeYAceptados.aceptados > 0
      ? importeYAceptados.importe / importeYAceptados.aceptados
      : 2500; // fallback €2500 por aceptado si no hay histórico

  const baseImporte = avgTotal * (tasaEsperada / 100) * avgImporteUnit;

  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const mes = getYYYYMM(d);
    const label = `${MES_LABEL[d.getMonth()]} ${d.getFullYear()}`;
    const confianza = i === 0 ? 3 : i === 1 ? 2 : 1;
    const decay = i === 0 ? 1 : i === 1 ? 0.9 : 0.75;
    const importeProyectado = Math.round(baseImporte * decay);

    result.push({ mes, label, importeProyectado, confianza: confianza as 3 | 2 | 1 });
  }

  return result;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfianzaBar({ nivel }: { nivel: 3 | 2 | 1 }) {
  const labels: Record<number, string> = { 3: "Alta", 2: "Media", 1: "Baja" };
  const colors: Record<number, string> = {
    3: "bg-emerald-500",
    2: "bg-amber-400",
    1: "bg-slate-300",
  };
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`w-3 h-2 rounded-sm ${n <= nivel ? colors[nivel] : "bg-slate-100"}`}
          />
        ))}
      </div>
      <span className="text-[10px] text-slate-400">{labels[nivel]}</span>
    </div>
  );
}

function ForecastCard({
  mes, label, importeProyectado, confianza, tasaEsperada,
}: {
  mes: string; label: string; importeProyectado: number; confianza: 3 | 2 | 1; tasaEsperada: number;
}) {
  const now = new Date();
  const isCurrent = mes === getYYYYMM(now);
  return (
    <div className={`rounded-2xl border p-5 ${isCurrent ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          {isCurrent && <p className="text-[10px] text-violet-600 font-medium">Mes actual</p>}
        </div>
        <ConfianzaBar nivel={confianza} />
      </div>
      <p className={`text-2xl font-extrabold ${isCurrent ? "text-violet-800" : "text-slate-800"}`}>
        €{importeProyectado.toLocaleString("es-ES")}
      </p>
      <p className="text-[11px] text-slate-400 mt-1">Con tasa esperada {tasaEsperada}%</p>
    </div>
  );
}

function InformeCard({
  informe, generadoEn, clinica, loading, error, onGenerar, onRegenerar, onDownloadPdf, onDownloadPpt, downloading,
}: {
  informe: InformeData | null;
  generadoEn?: string;
  clinica: string;
  loading: boolean;
  error: string | null;
  onGenerar: () => void;
  onRegenerar: () => void;
  onDownloadPdf?: () => void;
  onDownloadPpt?: () => void;
  downloading?: "pdf" | "ppt" | null;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 flex flex-col items-center justify-center gap-3 min-h-[200px]">
        <div className="w-8 h-8 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
        <p className="text-sm text-slate-500">Generando informe con IA...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-700 mb-1">Error al generar informe</p>
        <p className="text-xs text-rose-600">{error}</p>
        <button
          onClick={onGenerar}
          className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!informe) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 flex flex-col items-center justify-center gap-4">
        <p className="text-3xl">📊</p>
        <div className="text-center">
          <p className="font-semibold text-slate-700 mb-1">Informe narrativo</p>
          <p className="text-sm text-slate-400">
            Genera un análisis mensual con IA basado en los datos reales de{" "}
            <span className="font-medium">{clinica}</span>.
          </p>
        </div>
        <button
          onClick={onGenerar}
          className="px-5 py-2.5 rounded-2xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors"
        >
          Generar con IA
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Informe narrativo</p>
          {informe.generadoEn && (
            <p className="text-[10px] text-slate-400 mt-0.5">
              Generado el {new Date(informe.generadoEn).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onRegenerar}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Regenerar
          </button>
          {onDownloadPdf && (
            <button
              onClick={onDownloadPdf}
              disabled={downloading === "pdf"}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5"
            >
              {downloading === "pdf" ? (
                <><span className="w-3 h-3 rounded-full border border-slate-400 border-t-transparent animate-spin inline-block" /> Generando…</>
              ) : "↓ PDF"}
            </button>
          )}
          {onDownloadPpt && (
            <button
              onClick={onDownloadPpt}
              disabled={downloading === "ppt"}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5"
            >
              {downloading === "ppt" ? (
                <><span className="w-3 h-3 rounded-full border border-slate-400 border-t-transparent animate-spin inline-block" /> Generando…</>
              ) : "↓ PPT"}
            </button>
          )}
        </div>
      </div>

      {/* KPI summary row */}
      {informe.datosUsados && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: "Total", value: String(informe.datosUsados.total) },
            { label: "Aceptados", value: `${informe.datosUsados.aceptados} (${informe.datosUsados.tasa}%)` },
            { label: "Importe", value: `€${informe.datosUsados.importeTotal.toLocaleString("es-ES")}` },
            { label: "Pipeline", value: `€${informe.datosUsados.importePipeline.toLocaleString("es-ES")}` },
          ].map((item) => (
            <div key={item.label} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-0.5">{item.label}</p>
              <p className="text-sm font-bold text-slate-800">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Narrative */}
      <div
        className="text-slate-700 leading-relaxed prose-sm"
        style={{ fontSize: 15, lineHeight: 1.8 }}
      >
        <ReactMarkdown
          allowedElements={["p", "strong", "em", "br"]}
          unwrapDisallowed
          components={{
            p: ({ children }) => <p className="mt-4 first:mt-0">{children}</p>,
            strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
          }}
        >
          {informe.informe}
        </ReactMarkdown>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InformesView({ user }: { user: UserSession }) {
  const meses = useMemo(() => getLast12Months(), []);
  const [selectedMes, setSelectedMes] = useState(meses[1]?.value ?? meses[0].value); // previous month by default
  const [selectedClinica, setSelectedClinica] = useState("todas");
  const [clinicas, setClinicas] = useState<string[]>([]);

  const [informe, setInforme] = useState<InformeData | null>(null);
  const [loadingInforme, setLoadingInforme] = useState(false);
  const [downloading, setDownloading] = useState<"pdf" | "ppt" | null>(null);
  const [errorInforme, setErrorInforme] = useState<string | null>(null);

  // Forecast state
  const [tasaEsperada, setTasaEsperada] = useState(25); // default 25%
  const [kpisMeses, setKpisMeses] = useState(new Map<string, KpisMes>());

  const forecasting = useMemo(
    () => calcularForecasting(kpisMeses, tasaEsperada),
    [kpisMeses, tasaEsperada]
  );

  // Load clinica list and compute kpisMeses from kanban data
  useEffect(() => {
    fetch("/api/presupuestos/kanban")
      .then((r) => r.json())
      .then((d) => {
        const presupuestos: { clinica?: string; fechaPresupuesto: string; estado: string; amount?: number }[] = d.presupuestos ?? [];

        // Build clinica list
        const set = new Set<string>(presupuestos.map((p) => p.clinica ?? "Sin clínica"));
        setClinicas(Array.from(set).sort());

        // Compute kpisMeses for last 12 months
        const now = new Date();
        const map = new Map<string, KpisMes>();
        for (let i = 0; i < 12; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mes = getYYYYMM(d);
          const delMes = presupuestos.filter((p) => p.fechaPresupuesto.startsWith(mes));
          const aceptados = delMes.filter((p) => p.estado === "ACEPTADO");
          const importe = aceptados.reduce((s, p) => s + (p.amount ?? 0), 0);
          const tasa = delMes.length > 0 ? Math.round((aceptados.length / delMes.length) * 100) : 0;
          map.set(mes, { total: delMes.length, aceptados: aceptados.length, tasa, importe });
        }
        setKpisMeses(map);
      })
      .catch(() => {});
  }, []);

  // Reset informe when filters change
  useEffect(() => {
    setInforme(null);
    setErrorInforme(null);
  }, [selectedMes, selectedClinica]);

  async function generarInforme() {
    setLoadingInforme(true);
    setErrorInforme(null);
    try {
      const res = await fetch("/api/presupuestos/ia/informe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes: selectedMes, clinicaId: selectedClinica }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error desconocido");
      setInforme(data);
    } catch (e: unknown) {
      setErrorInforme(e instanceof Error ? e.message : "Error al generar informe");
    } finally {
      setLoadingInforme(false);
    }
  }

  const mesLabel = meses.find((m) => m.value === selectedMes)?.label ?? selectedMes;

  async function downloadDocument(format: "pdf" | "ppt") {
    if (!informe) return;
    setDownloading(format);
    try {
      const endpoint = format === "pdf" ? "/api/informes/generar-pdf" : "/api/informes/generar-ppt";
      const clinicaNombre = selectedClinica === "todas" ? "Todas las clínicas" : selectedClinica;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mes: selectedMes,
          clinica: clinicaNombre,
          informe: informe.informe,
          datos: informe.datosUsados,
          charts: [],
        }),
      });
      if (!res.ok) throw new Error("Error al generar documento");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("Content-Disposition") ?? "";
      const filename = cd.match(/filename="([^"]+)"/)?.[1] ?? `informe.${format}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error descargando documento:", e);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full pb-6">
      {/* Header + filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Mes</label>
          <select
            value={selectedMes}
            onChange={(e) => setSelectedMes(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {meses.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Clínica</label>
          <select
            value={selectedClinica}
            onChange={(e) => setSelectedClinica(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="todas">Todas las clínicas</option>
            {clinicas.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="text-xs text-slate-400 pb-2">
          Informe de{" "}
          <span className="font-semibold text-slate-600">{mesLabel}</span>
          {" · "}
          <span className="font-semibold text-slate-600">
            {selectedClinica === "todas" ? "Todas las clínicas" : selectedClinica}
          </span>
        </div>
      </div>

      {/* AI Informe */}
      <InformeCard
        informe={informe}
        clinica={selectedClinica === "todas" ? "todas las clínicas" : selectedClinica}
        loading={loadingInforme}
        error={errorInforme}
        onGenerar={generarInforme}
        onRegenerar={generarInforme}
        generadoEn={informe?.generadoEn}
        onDownloadPdf={informe ? () => downloadDocument("pdf") : undefined}
        onDownloadPpt={informe ? () => downloadDocument("ppt") : undefined}
        downloading={downloading}
      />

      {/* Forecasting */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Forecasting — próximos 3 meses
          </h2>
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-500">
              Tasa esperada: <span className="font-bold text-slate-700">{tasaEsperada}%</span>
            </label>
            <input
              type="range"
              min={5}
              max={80}
              step={1}
              value={tasaEsperada}
              onChange={(e) => setTasaEsperada(Number(e.target.value))}
              className="w-28 accent-violet-600"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {forecasting.map((f) => (
            <ForecastCard key={f.mes} {...f} tasaEsperada={tasaEsperada} />
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          * Proyección basada en el volumen histórico de los últimos 3 meses y la tasa esperada seleccionada.
          La confianza disminuye para meses más lejanos.
        </p>
      </div>
    </div>
  );
}
