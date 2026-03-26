"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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

  // Debounce timer for search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track latest filters for debounced callback
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Load clinicas (manager only)
  useEffect(() => {
    if (user.rol !== "manager_general") return;
    fetch("/api/presupuestos/clinicas")
      .then((r) => r.json())
      .then((d) => setClinicas(d.clinicas ?? []))
      .catch(() => {});
  }, [user.rol]);

  // Load doctors when clinica changes
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

  // Immediate update for non-search fields
  const updateImmediate = useCallback(
    (key: keyof Filters, value: string) => {
      const next = { ...filtersRef.current, [key]: value };
      setFilters(next);
      filtersRef.current = next;
      onFiltersChange(next);
    },
    [onFiltersChange]
  );

  // Debounced update for search field
  const updateSearch = useCallback(
    (value: string) => {
      setFilters((prev) => {
        const next = { ...prev, q: value };
        filtersRef.current = next;
        return next;
      });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFiltersChange({ ...filtersRef.current });
      }, 300);
    },
    [onFiltersChange]
  );

  const reset = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setFilters(EMPTY_FILTERS);
    filtersRef.current = EMPTY_FILTERS;
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
        onChange={(e) => updateSearch(e.target.value)}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
      />

      <div className="flex flex-wrap gap-2 items-end">
        {/* Clínica (solo manager) */}
        {user.rol === "manager_general" && (
          <select
            value={filters.clinica}
            onChange={(e) => updateImmediate("clinica", e.target.value)}
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
          onChange={(e) => updateImmediate("doctor", e.target.value)}
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
          onChange={(e) => updateImmediate("tipoPaciente", e.target.value)}
          className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          <option value="">Tipo paciente</option>
          <option value="Privado">Privado</option>
          <option value="Adeslas">Adeslas</option>
        </select>

        {/* Tipo visita */}
        <select
          value={filters.tipoVisita}
          onChange={(e) => updateImmediate("tipoVisita", e.target.value)}
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
            onChange={(e) => updateImmediate("fechaDesde", e.target.value)}
            className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="date"
            value={filters.fechaHasta}
            onChange={(e) => updateImmediate("fechaHasta", e.target.value)}
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
