"use client";

import { useEffect, useState } from "react";
import type { Doctor, Presupuesto, UserSession } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, ESPECIALIDAD_COLOR, ESTADOS_ACEPTADOS } from "../../lib/presupuestos/colors";
import PatientDrawer from "./PatientDrawer";

type PeriodoFiltro = "all" | "month" | "prevMonth" | "3months" | "custom";

const PERIODO_LABEL: Record<PeriodoFiltro, string> = {
  all: "Todo",
  month: "Este mes",
  prevMonth: "Mes anterior",
  "3months": "3 meses",
  custom: "Personalizado",
};

function isoToYYYYMM(iso: string) {
  return iso.slice(0, 7);
}

function filterByPeriod(p: Presupuesto, periodo: PeriodoFiltro, customDesde?: string, customHasta?: string): boolean {
  if (periodo === "all") return true;
  if (periodo === "custom") {
    if (customDesde && p.fechaPresupuesto < customDesde) return false;
    if (customHasta && p.fechaPresupuesto > customHasta) return false;
    return true;
  }
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const m = isoToYYYYMM(p.fechaPresupuesto);
  if (periodo === "month") return m === thisMonth;
  if (periodo === "prevMonth") return m === prevMonth;
  if (periodo === "3months") {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return new Date(p.fechaPresupuesto) >= cutoff;
  }
  return true;
}

const PAGE_SIZE = 25;

export default function DoctorView({ user }: { user: UserSession }) {
  const [doctores, setDoctores] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<string>("");
  const [allPresupuestos, setAllPresupuestos] = useState<Presupuesto[]>([]);
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("all");
  const [customDesde, setCustomDesde] = useState("");
  const [customHasta, setCustomHasta] = useState("");
  const [page, setPage] = useState(0);
  const [drawerPresupuesto, setDrawerPresupuesto] = useState<Presupuesto | null>(null);

  useEffect(() => {
    const url = new URL("/api/presupuestos/doctores", location.href);
    if (user.rol === "encargada_ventas" && user.clinica) {
      url.searchParams.set("clinica", user.clinica);
    }
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => {
        setDoctores(d.doctores ?? []);
        if (d.doctores?.length) setSelectedDoctor(d.doctores[0].nombre);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!selectedDoctor) return;
    const url = new URL("/api/presupuestos/kanban", location.href);
    url.searchParams.set("doctor", selectedDoctor);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => { setAllPresupuestos(d.presupuestos ?? []); setPage(0); })
      .catch(() => setAllPresupuestos([]));
  }, [selectedDoctor]);

  // Reset page when period changes
  useEffect(() => { setPage(0); }, [periodo]);

  const doctor = doctores.find((d) => d.nombre === selectedDoctor);
  const presupuestos = allPresupuestos.filter((p) => filterByPeriod(p, periodo, customDesde, customHasta));

  const aceptados = presupuestos.filter((p) => ESTADOS_ACEPTADOS.includes(p.estado));
  const tasa = presupuestos.length > 0
    ? Math.round((aceptados.length / presupuestos.length) * 100)
    : 0;
  const importeTotal = aceptados.reduce((s, p) => s + (p.amount ?? 0), 0);
  const tiemposDecierre = aceptados.filter((p) => p.daysSince > 0).map((p) => p.daysSince);
  const tiempoMedio = tiemposDecierre.length
    ? Math.round(tiemposDecierre.reduce((s, d) => s + d, 0) / tiemposDecierre.length)
    : 0;

  const paginated = presupuestos.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(presupuestos.length / PAGE_SIZE);

  // Sync drawer presupuesto with latest data
  function handleDrawerEstadoChange(id: string) {
    setAllPresupuestos((prev) => {
      const updated = prev.find((p) => p.id === id);
      if (updated && drawerPresupuesto?.id === id) {
        setDrawerPresupuesto(updated);
      }
      return prev;
    });
  }

  return (
    <div className="space-y-5">
      {/* Doctor selector + period filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs font-semibold text-slate-500">Doctor:</label>
        <select
          value={selectedDoctor}
          onChange={(e) => setSelectedDoctor(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          {doctores.map((d) => (
            <option key={d.id} value={d.nombre}>{d.nombre} — {d.especialidad}</option>
          ))}
        </select>
        {doctor && (
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: ESPECIALIDAD_COLOR[doctor.especialidad], color: "#1e293b" }}
          >
            {doctor.especialidad}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Period filter */}
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex rounded-xl overflow-hidden border border-slate-200 text-xs">
            {(["all", "month", "prevMonth", "3months", "custom"] as PeriodoFiltro[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
                  periodo === p
                    ? "bg-violet-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                } ${p !== "all" ? "border-l border-slate-200 first:border-0" : ""}`}
              >
                {PERIODO_LABEL[p]}
              </button>
            ))}
          </div>
          {periodo === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customDesde}
                onChange={(e) => { setCustomDesde(e.target.value); setPage(0); }}
                className="rounded-xl border border-violet-300 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
              <span className="text-xs text-slate-400">–</span>
              <input
                type="date"
                value={customHasta}
                onChange={(e) => { setCustomHasta(e.target.value); setPage(0); }}
                className="rounded-xl border border-violet-300 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total", value: String(presupuestos.length) },
          { label: "Aceptados", value: String(aceptados.length) },
          { label: "% Aceptación", value: `${tasa}%` },
          { label: "€ Aceptado", value: `€${importeTotal.toLocaleString("es-ES")}` },
          { label: "Días medio cierre", value: tiempoMedio > 0 ? `${tiempoMedio}d` : "—" },
        ].map((m) => (
          <div key={m.label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500 font-medium">{m.label}</p>
            <p className="text-xl font-extrabold text-slate-900 mt-1">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Historial table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <p className="px-4 py-3 text-sm font-bold text-slate-900 border-b border-slate-100">
          Historial ({presupuestos.length})
          {periodo !== "all" && (
            <span className="ml-2 text-[11px] font-normal text-slate-400">
              — {PERIODO_LABEL[periodo]}
            </span>
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                {["Paciente", "Tratamientos", "Importe", "Estado", "Fecha", "Tipo", "Cont."].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-semibold text-slate-400 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {paginated.map((p) => {
                const cfg = ESTADO_CONFIG[p.estado];
                return (
                  <tr
                    key={p.id}
                    onClick={() => setDrawerPresupuesto(p)}
                    className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                      {p.patientName}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[160px] truncate">
                      {p.treatments.join(", ")}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                      {p.amount != null ? `€${p.amount.toLocaleString("es-ES")}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{ background: cfg.hex, color: cfg.textColor }}
                      >
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                      {p.fechaPresupuesto}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                      {p.tipoPaciente ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{p.contactCount}</td>
                  </tr>
                );
              })}
              {presupuestos.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400 text-sm">
                    Sin presupuestos en este período
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Página {page + 1} de {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 disabled:opacity-40"
              >
                ← Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 disabled:opacity-40"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Patient drawer */}
      {drawerPresupuesto && (
        <PatientDrawer
          presupuesto={drawerPresupuesto}
          onClose={() => setDrawerPresupuesto(null)}
          onChangeEstado={(id: string, estado) => {
            setAllPresupuestos((prev) =>
              prev.map((p) => (p.id === id ? { ...p, estado } : p))
            );
            handleDrawerEstadoChange(id);
          }}
        />
      )}
    </div>
  );
}
