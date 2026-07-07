"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Doctor, UserSession } from "../../lib/presupuestos/types";
import { Card } from "../ui/Card";
import { X, Euro, Tag, Megaphone, ICON_STROKE } from "../icons";

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
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap border ${
            active === p
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-border)]"
              : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)]"
          }`}
        >
          {PRESET_LABELS[p]}
        </button>
      ))}
      <span className="text-[var(--color-muted)] text-xs select-none px-0.5">|</span>
      <input
        type="date"
        value={fechaDesde}
        onChange={(e) => onChange(e.target.value, fechaHasta)}
        className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] w-[120px]"
      />
      <span className="text-[var(--color-muted)] text-[11px]">→</span>
      <input
        type="date"
        value={fechaHasta}
        onChange={(e) => onChange(fechaDesde, e.target.value)}
        className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] w-[120px]"
      />
      {hasCustomDates && active === "personalizado" && (
        <button
          onClick={() => onChange("", "")}
          className="text-[var(--color-muted)] hover:text-rose-500 transition-colors px-1"
          title="Limpiar fechas"
          aria-label="Limpiar fechas"
        >
          <X size={12} strokeWidth={ICON_STROKE} aria-hidden />
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
  const [doctores, setDoctores] = useState<Doctor[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Smart hint — shown below search field
  const pattern = detectPattern(filters.q);

  // Sprint 13.1 Bloque 2 — el state `clinicas` y su carga han sido
  // eliminados; la clinica vive solo en ClinicContext (GlobalHeader).

  // Load doctors. Para coord usamos su clinica fija; para admin no
  // pre-filtramos por clinica (el panel de clinica vive arriba).
  useEffect(() => {
    const url = new URL("/api/presupuestos/doctores", location.href);
    if (user.rol === "encargada_ventas" && user.clinica) {
      url.searchParams.set("clinica", user.clinica);
    }
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setDoctores(d.doctores ?? []))
      .catch(() => {});
  }, [user.rol, user.clinica]);

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
    <Card padding="sm" className="space-y-2">
      {/* Search */}
      <div className="relative">
        <input
          type="search"
          placeholder="Buscar paciente, tratamiento, importe…"
          value={filters.q}
          onChange={(e) => updateSearch(e.target.value)}
          className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm placeholder-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)]"
        />
        {/* Smart hint */}
        {pattern && (
          <div className="mt-1.5 flex items-center gap-2">
            {pattern.kind === "amount" && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium">
                <Euro size={12} strokeWidth={ICON_STROKE} aria-hidden />
                Buscando por importe ≈ €{pattern.value.toLocaleString("es-ES")}
              </span>
            )}
            {pattern.kind === "estado" && (
              <button
                onClick={() => applyPattern(pattern)}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold hover:bg-[var(--color-accent-soft)] transition-colors"
              >
                <Tag size={12} strokeWidth={ICON_STROKE} aria-hidden />
                Filtrar por estado: {pattern.label} →
              </button>
            )}
            {pattern.kind === "origen" && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium">
                <Megaphone size={12} strokeWidth={ICON_STROKE} aria-hidden />
                Canal detectado: {pattern.label}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-2 gap-y-2 items-center">
        {/* Sprint 13.1 Bloque 2 — Dropdown clínica local eliminado.
            Clínica se filtra exclusivamente desde el GlobalHeader
            (ClinicContext es único punto de verdad). */}

        {/* Doctor */}
        <select
          value={filters.doctor}
          onChange={(e) => updateImmediate("doctor", e.target.value)}
          className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] ${filters.doctor ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold" : "border-[var(--color-border)] text-[var(--color-foreground)]"}`}
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
          className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] ${filters.estado ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold" : "border-[var(--color-border)] text-[var(--color-foreground)]"}`}
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
          className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] ${filters.tipoPaciente ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold" : "border-[var(--color-border)] text-[var(--color-foreground)]"}`}
        >
          <option value="">Tipo paciente</option>
          <option value="Privado">Privado</option>
          <option value="Adeslas">Adeslas</option>
        </select>

        {/* Tipo visita */}
        <select
          value={filters.tipoVisita}
          onChange={(e) => updateImmediate("tipoVisita", e.target.value)}
          className={`rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] ${filters.tipoVisita ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold" : "border-[var(--color-border)] text-[var(--color-foreground)]"}`}
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
            className="text-xs px-2.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"
          >
            Limpiar filtros
          </button>
        )}
      </div>
    </Card>
  );
}
