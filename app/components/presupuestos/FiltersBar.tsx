"use client";

// Filtros del tablero de Presupuestos.
//
// Coherencia de kanban (2026-07-27): misma anatomía que Leads — una fila con
// buscador y lo mínimo que no se puede deducir del tablero. Se retiraron:
//   · el select de Estado (filtrar por estado en un tablero DE estados es
//     redundante con las columnas, y su "hint inteligente" no hacía otra cosa),
//   · Tipo paciente y Tipo visita (los mismos campos que salieron de la card
//     por ruido: no cambian ninguna decisión de la coordinadora),
//   · el hint "Canal detectado", que anunciaba una detección que no filtraba nada.
// El período vive en el control único RangoTemporal, junto a este bloque.

import { useEffect, useRef, useState, useCallback } from "react";
import type { Doctor, UserSession } from "../../lib/presupuestos/types";
import { Euro, ICON_STROKE } from "../icons";
import { cargarJSON, traeLista } from "../../lib/fetch-json";
import { eur } from "../shared/Cifra";

export type Filters = {
  doctor: string;
  q: string;
};

export const EMPTY_FILTERS: Filters = { doctor: "", q: "" };

/** Buscar "1200" busca por importe: el buscador lo dice en vez de callárselo. */
function importeBuscado(q: string): number | null {
  const t = q.trim().toLowerCase();
  if (!t) return null;
  const numStr = t.replace(/[€$.,\s]/g, "");
  if (/^\d+$/.test(numStr) && numStr.length >= 2) return parseInt(numStr, 10);
  return null;
}

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

  const importe = importeBuscado(filters.q);

  // Doctores: para coordinadora, los de su clínica; para admin, todos (la
  // clínica vive en el ClinicContext del GlobalHeader).
  //
  // Este `?? []` con catch mudo era una de las SIETE deudas que el guardián no
  // veía (solo reconocía `const d = await res.json()`, no `.then((d) => …)`).
  // Si la petición falla, el filtro se queda con "Todos los doctores" y punto:
  // la coordinadora concluye que la clínica no tiene doctores.
  const [errorDoctores, setErrorDoctores] = useState(false);
  const cargarDoctores = useCallback(() => {
    const url = new URL("/api/presupuestos/doctores", location.href);
    if (user.rol === "encargada_ventas" && user.clinica) {
      url.searchParams.set("clinica", user.clinica);
    }
    setErrorDoctores(false);
    cargarJSON<{ doctores: Doctor[] }>(url.toString(), { validar: traeLista("doctores") })
      .then((d) => setDoctores(d.doctores))
      .catch(() => setErrorDoctores(true));
  }, [user.rol, user.clinica]);
  useEffect(cargarDoctores, [cargarDoctores]);

  const updateImmediate = useCallback(
    (key: keyof Filters, value: string) => {
      const next = { ...filtersRef.current, [key]: value };
      setFilters(next);
      filtersRef.current = next;
      onFiltersChange(next);
    },
    [onFiltersChange],
  );

  // Búsqueda con debounce — 200 ms
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
    [onFiltersChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        placeholder="Buscar paciente, tratamiento, importe…"
        value={filters.q}
        onChange={(e) => updateSearch(e.target.value)}
        className="flex-1 min-w-[180px] max-w-sm rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      />

      <select
        value={filters.doctor}
        onChange={(e) => updateImmediate("doctor", e.target.value)}
        className={`rounded-full border px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${
          filters.doctor
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)]"
        }`}
      >
        <option value="">Todos los doctores</option>
        {doctores.map((d) => (
          <option key={d.id} value={d.nombre}>
            {d.nombre}
          </option>
        ))}
      </select>

      {errorDoctores && (
        <span className="text-[11px] text-[var(--color-danger)]">
          No se pudo cargar la lista de doctores.{" "}
          <button type="button" onClick={cargarDoctores} className="font-semibold underline">
            Reintentar
          </button>
        </span>
      )}

      {importe != null && (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium">
          <Euro size={12} strokeWidth={ICON_STROKE} aria-hidden />
          Buscando por importe ≈ {eur(importe)}
        </span>
      )}
    </div>
  );
}
