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

// ─── Period preset selector ────────────────────────────────────────────────────

type Preset = "todo" | "mes" | "3m" | "6m" | "anio";
const PRESET_LABELS: Record<Preset, string> = {
  todo: "Todo",
  mes: "Este mes",
  "3m": "3 meses",
  "6m": "6 meses",
  anio: "Este año",
};

function computePresetDates(p: Preset): { desde: string; hasta: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);
  if (p === "todo") return { desde: "", hasta: "" };
  if (p === "mes") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { desde: fmt(start), hasta: today };
  }
  if (p === "3m") {
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return { desde: fmt(start), hasta: today };
  }
  if (p === "6m") {
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return { desde: fmt(start), hasta: today };
  }
  // anio
  return { desde: `${now.getFullYear()}-01-01`, hasta: today };
}

function detectPreset(desde: string, hasta: string): Preset | "personalizado" | null {
  if (!desde && !hasta) return "todo";
  // Check if it matches a known preset (approximate)
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);
  if (hasta === today) {
    if (desde === fmt(new Date(now.getFullYear(), now.getMonth(), 1))) return "mes";
    if (desde === fmt(new Date(now.getFullYear(), now.getMonth() - 2, 1))) return "3m";
    if (desde === fmt(new Date(now.getFullYear(), now.getMonth() - 5, 1))) return "6m";
    if (desde === `${now.getFullYear()}-01-01`) return "anio";
  }
  return "personalizado";
}

function PeriodPreset({
  fechaDesde, fechaHasta, onChange,
}: {
  fechaDesde: string;
  fechaHasta: string;
  onChange: (desde: string, hasta: string) => void;
}) {
  const active = detectPreset(fechaDesde, fechaHasta);
  const [showCustom, setShowCustom] = useState(active === "personalizado");

  return (
    <div className="space-y-1.5">
      <div className="flex rounded-xl overflow-hidden border border-slate-200 text-[11px]">
        {(["todo", "mes", "3m", "6m", "anio"] as Preset[]).map((p) => (
          <button
            key={p}
            onClick={() => {
              setShowCustom(false);
              const { desde, hasta } = computePresetDates(p);
              onChange(desde, hasta);
            }}
            className={`px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
              active === p
                ? "bg-violet-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
        <button
          onClick={() => {
            setShowCustom(true);
            if (active !== "personalizado") onChange("", "");
          }}
          className={`px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap border-l border-slate-200 ${
            active === "personalizado" || showCustom
              ? "bg-violet-600 text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Personalizado
        </button>
      </div>
      {(showCustom || active === "personalizado") && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => onChange(e.target.value, fechaHasta)}
            className="rounded-xl border border-violet-300 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => onChange(fechaDesde, e.target.value)}
            className="rounded-xl border border-violet-300 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>
      )}
    </div>
  );
}

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
            className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 ${filters.clinica ? "border-violet-400 bg-violet-50 text-violet-700 font-semibold" : "border-slate-200 text-slate-700"}`}
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
          className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 ${filters.doctor ? "border-violet-400 bg-violet-50 text-violet-700 font-semibold" : "border-slate-200 text-slate-700"}`}
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
          className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 ${filters.tipoPaciente ? "border-violet-400 bg-violet-50 text-violet-700 font-semibold" : "border-slate-200 text-slate-700"}`}
        >
          <option value="">Tipo paciente</option>
          <option value="Privado">Privado</option>
          <option value="Adeslas">Adeslas</option>
        </select>

        {/* Tipo visita */}
        <select
          value={filters.tipoVisita}
          onChange={(e) => updateImmediate("tipoVisita", e.target.value)}
          className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 ${filters.tipoVisita ? "border-violet-400 bg-violet-50 text-violet-700 font-semibold" : "border-slate-200 text-slate-700"}`}
        >
          <option value="">Tipo visita</option>
          <option value="Primera Visita">1ª Visita</option>
          <option value="Paciente con Historia">Con Historia</option>
        </select>

        {/* Período */}
        <PeriodPreset
          fechaDesde={filters.fechaDesde}
          fechaHasta={filters.fechaHasta}
          onChange={(desde, hasta) => {
            const next = { ...filtersRef.current, fechaDesde: desde, fechaHasta: hasta };
            setFilters(next);
            filtersRef.current = next;
            onFiltersChange(next);
          }}
        />

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
