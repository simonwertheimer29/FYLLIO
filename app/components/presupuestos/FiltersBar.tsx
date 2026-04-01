"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Doctor, UserSession } from "../../lib/presupuestos/types";

export type Filters = {
  clinica: string;
  doctor: string;
  tipoPaciente: string;
  tipoVisita: string;
  estado: string;
  fechaDesde: string;
  fechaHasta: string;
  q: string;
};

const EMPTY_FILTERS: Filters = {
  clinica: "",
  doctor: "",
  tipoPaciente: "",
  tipoVisita: "",
  estado: "",
  fechaDesde: "",
  fechaHasta: "",
  q: "",
};

// ─── Smart pattern detection ──────────────────────────────────────────────────

type Pattern =
  | { kind: "amount"; value: number }
  | { kind: "estado"; estado: string; label: string }
  | { kind: "origen"; label: string };

const ESTADO_KWS: [string, string, string][] = [
  ["presentado", "PRESENTADO", "Presentado"],
  ["interesado", "INTERESADO", "Interesado"],
  ["duda", "EN_DUDA", "En Duda"],
  ["negoci", "EN_NEGOCIACION", "En Negociación"],
  ["aceptado", "ACEPTADO", "Aceptado"],
  ["perdido", "PERDIDO", "Perdido"],
];

const ORIGEN_KWS: [string, string][] = [
  ["google", "Google Ads"],
  ["seo", "SEO orgánico"],
  ["referido", "Referido"],
  ["redes", "Redes sociales"],
  ["walk", "Walk-in"],
];

function detectPattern(q: string): Pattern | null {
  const t = q.trim().toLowerCase();
  if (!t) return null;
  const numStr = t.replace(/[€$.,\s]/g, "");
  if (/^\d+$/.test(numStr) && numStr.length >= 2) {
    return { kind: "amount", value: parseInt(numStr) };
  }
  for (const [kw, val, label] of ESTADO_KWS) {
    if (t.includes(kw)) return { kind: "estado", estado: val, label };
  }
  for (const [kw, label] of ORIGEN_KWS) {
    if (t.includes(kw)) return { kind: "origen", label };
  }
  return null;
}

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
    return { desde: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), hasta: today };
  }
  if (p === "3m") {
    return { desde: fmt(new Date(now.getFullYear(), now.getMonth() - 2, 1)), hasta: today };
  }
  if (p === "6m") {
    return { desde: fmt(new Date(now.getFullYear(), now.getMonth() - 5, 1)), hasta: today };
  }
  return { desde: `${now.getFullYear()}-01-01`, hasta: today };
}

function detectPreset(desde: string, hasta: string): Preset | "personalizado" | null {
  if (!desde && !hasta) return "todo";
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
  const hasCustomDates = !!(fechaDesde || fechaHasta);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {(["todo", "mes", "3m", "6m", "anio"] as Preset[]).map((p) => (
        <button
          key={p}
          onClick={() => {
            const { desde, hasta } = computePresetDates(p);
            onChange(desde, hasta);
          }}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
            active === p
              ? "bg-violet-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          {PRESET_LABELS[p]}
        </button>
      ))}
      <span className="text-slate-300 text-xs select-none px-0.5">|</span>
      <input
        type="date"
        value={fechaDesde}
        onChange={(e) => onChange(e.target.value, fechaHasta)}
        className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300 w-[120px]"
      />
      <span className="text-slate-400 text-[11px]">→</span>
      <input
        type="date"
        value={fechaHasta}
        onChange={(e) => onChange(fechaDesde, e.target.value)}
        className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300 w-[120px]"
      />
      {hasCustomDates && active === "personalizado" && (
        <button
          onClick={() => onChange("", "")}
          className="text-[11px] text-slate-400 hover:text-rose-500 transition-colors px-1"
          title="Limpiar fechas"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Smart hint — shown below search field
  const pattern = detectPattern(filters.q);

  // Load clinicas (manager only)
  useEffect(() => {
    if (user.rol === "encargada_ventas") return;
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

  const updateImmediate = useCallback(
    (key: keyof Filters, value: string) => {
      const next = { ...filtersRef.current, [key]: value };
      setFilters(next);
      filtersRef.current = next;
      onFiltersChange(next);
    },
    [onFiltersChange]
  );

  // Debounced search — 200ms
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
      }, 200);
    },
    [onFiltersChange]
  );

  // Apply smart pattern — called when user clicks the hint chip
  function applyPattern(p: Pattern) {
    if (p.kind === "estado") {
      const next = { ...filtersRef.current, estado: p.estado, q: "" };
      setFilters(next);
      filtersRef.current = next;
      onFiltersChange(next);
    }
    // amount / origen — just clear the q so the hint disappears (search already fired)
  }

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
      <div className="relative">
        <input
          type="search"
          placeholder="Buscar paciente, tratamiento, importe…"
          value={filters.q}
          onChange={(e) => updateSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        {/* Smart hint */}
        {pattern && (
          <div className="mt-1.5 flex items-center gap-2">
            {pattern.kind === "amount" && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                💰 Buscando por importe ≈ €{pattern.value.toLocaleString("es-ES")}
              </span>
            )}
            {pattern.kind === "estado" && (
              <button
                onClick={() => applyPattern(pattern)}
                className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-semibold hover:bg-violet-100 transition-colors"
              >
                🏷 Filtrar por estado: {pattern.label} →
              </button>
            )}
            {pattern.kind === "origen" && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                📢 Canal detectado: {pattern.label}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-2 gap-y-2 items-center">
        {/* Clínica (manager / admin only) */}
        {user.rol !== "encargada_ventas" && (
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

        {/* Estado */}
        <select
          value={filters.estado}
          onChange={(e) => updateImmediate("estado", e.target.value)}
          className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 ${filters.estado ? "border-violet-400 bg-violet-50 text-violet-700 font-semibold" : "border-slate-200 text-slate-700"}`}
        >
          <option value="">Todos los estados</option>
          <option value="PRESENTADO">Presentado</option>
          <option value="INTERESADO">Interesado</option>
          <option value="EN_DUDA">En Duda</option>
          <option value="EN_NEGOCIACION">En Negociación</option>
          <option value="ACEPTADO">Aceptado</option>
          <option value="PERDIDO">Perdido</option>
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
