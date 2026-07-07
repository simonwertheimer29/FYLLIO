"use client";

// app/components/layout/ClinicSelector.tsx
//
// Selector global Sprint 7 Fase 4 — consume ClinicContext.
// Reglas:
//  - admin: "Todas las clínicas" (null) + lista de clínicas activas.
//  - coord con 1 clínica: etiqueta fija no-desplegable con su nombre.
//  - coord con 2+ clínicas: dropdown con solo sus clínicas (sin "Todas").

import { useClinic } from "../../lib/context/ClinicContext";

const TODAS = "__all__";

export function ClinicSelector() {
  const { selectedClinicaId, setSelectedClinicaId, clinicasSelectables, session, isHydrated } =
    useClinic();

  const isAdmin = session.rol === "admin";

  // Coord con una única clínica: pildora fija, sin dropdown.
  if (!isAdmin && clinicasSelectables.length === 1) {
    const only = clinicasSelectables[0]!;
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-foreground)] px-3 py-1.5 text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
        {only.nombre}
      </span>
    );
  }

  // Antes de hidratar (SSR / primer render cliente): placeholder estable.
  if (!isHydrated) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-muted)]">
        Cargando…
      </span>
    );
  }

  const currentValue = selectedClinicaId ?? TODAS;

  function onChange(v: string) {
    if (v === TODAS) {
      setSelectedClinicaId(null);
    } else {
      setSelectedClinicaId(v);
    }
  }

  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">Clínica</span>
      <select
        value={currentValue}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-semibold text-[var(--color-foreground)] max-w-[260px] truncate"
      >
        {isAdmin && <option value={TODAS}>Todas las clínicas</option>}
        {clinicasSelectables.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}
