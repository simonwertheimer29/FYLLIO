"use client";

import { useEffect, useState, useCallback } from "react";
import type { Doctor, UserSession } from "../../lib/presupuestos/types";

export type Filters = {
  clinica: string;
  doctor: string;
  tipoPaciente: string;
  tipoVisita: string;
  fechaDesde: string;
  fechaHasta: string;
  q: string;
};

const EMPTY_FILTERS: Filters = {
  clinica: "",
  doctor: "",
  tipoPaciente: "",
  tipoVisita: "",
  fechaDesde: "",
  fechaHasta: "",
  q: "",
};

export default function FiltersBar({
  user,
  onFiltersChange,
}: {
  user: UserSession;
  onFiltersChange: (f: Filters) => void;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [clinicas, setClinicas] = useState<string[]>([]);
  const [doctores, setDoctores] = useState<Doctor[]>([]);

  // Cargar clínicas (solo manager)
  useEffect(() => {
    if (user.rol !== "manager_general") return;
    fetch("/api/presupuestos/clinicas")
      .then((r) => r.json())
      .then((d) => setClinicas(d.clinicas ?? []))
      .catch(() => {});
  }, [user.rol]);

  // Cargar doctores
  useEffect(() => {
    const url = new URL("/api/presupuestos/doctores", location.href);
    if (user.rol === "encargada_ventas" && user.clinica) {
      url.searchParams.set("clinica", user.clinica);
    } else if (filters.clinica) {
      url.searchParams.set("clinica", filters.clinica);
    }
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setDoctores(d.doctores ?? []))
      .catch(() => {});
  }, [filters.clinica, user.rol, user.clinica]);

  const update = useCallback(
    (key: keyof Filters, value: string) => {
      const next = { ...filters, [key]: value };
      setFilters(next);
      onFiltersChange(next);
    },
    [filters, onFiltersChange]
  );

  const reset = () => {
    setFilters(EMPTY_FILTERS);
    onFiltersChange(EMPTY_FILTERS);
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
      {/* Search */}
      <input
        type="search"
        placeholder="Buscar paciente o tratamiento…"
        value={filters.q}
        onChange={(e) => update("q", e.target.value)}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
      />

      <div className="flex flex-wrap gap-2 items-end">
        {/* Clínica (solo manager) */}
        {user.rol === "manager_general" && (
          <select
            value={filters.clinica}
            onChange={(e) => update("clinica", e.target.value)}
            className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            <option value="">Todas las clínicas</option>
            {clinicas.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {/* Doctor */}
        <select
          value={filters.doctor}
          onChange={(e) => update("doctor", e.target.value)}
          className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          <option value="">Todos los doctores</option>
          {doctores.map((d) => (
            <option key={d.id} value={d.nombre}>{d.nombre}</option>
          ))}
        </select>

        {/* Tipo paciente */}
        <select
          value={filters.tipoPaciente}
          onChange={(e) => update("tipoPaciente", e.target.value)}
          className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          <option value="">Tipo paciente</option>
          <option value="Privado">Privado</option>
          <option value="Adeslas">Adeslas</option>
        </select>

        {/* Tipo visita */}
        <select
          value={filters.tipoVisita}
          onChange={(e) => update("tipoVisita", e.target.value)}
          className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          <option value="">Tipo visita</option>
          <option value="Primera Visita">1ª Visita</option>
          <option value="Paciente con Historia">Con Historia</option>
        </select>

        {/* Fechas */}
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={filters.fechaDesde}
            onChange={(e) => update("fechaDesde", e.target.value)}
            className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="date"
            value={filters.fechaHasta}
            onChange={(e) => update("fechaHasta", e.target.value)}
            className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        {hasActiveFilters && (
          <button
            onClick={reset}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50"
          >
            Limpiar filtros
          </button>
        )}
      </div>
    </div>
  );
}
