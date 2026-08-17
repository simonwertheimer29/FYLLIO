"use client";

// LA COLA DE CASOS DEL AGENTE en Seguimiento (fase B, B2): una LÍNEA por
// caso entregado — paciente · qué quiere · cuánto lleva esperando (las tres
// columnas dictadas) — y al abrirla se despliega LA ficha (el componente
// único). Veinte fichas abiertas no se escanean; veinte líneas sí.
//
// Sección autocontenida: su fetch, su error honesto, su vacío real. Si no
// hay casos entregados, la sección lo dice en una línea y no ocupa más.

import { useCallback, useEffect, useState } from "react";
import { cargarJSON, traeLista, mensajeDeError } from "../../lib/fetch-json";
import { FichaCasoPanel } from "../../components/agente/FichaCasoPanel";
import { ChevronDown, ChevronRight, PauseCircle, Sparkles } from "../../components/icons";
import type { CasoDelAgente } from "../../api/agente/casos/route";

export function CasosDelAgente() {
  const [casos, setCasos] = useState<CasoDelAgente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const d = await cargarJSON<{ casos: CasoDelAgente[] }>("/api/agente/casos", {
        validar: traeLista("casos"),
      });
      setCasos(d.casos);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) {
    return (
      <section className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-[var(--color-danger-soft)] px-4 py-3">
        <p className="text-[13px] font-semibold text-[var(--color-foreground)]">
          La cola del agente no se pudo cargar
        </p>
        <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">{error}</p>
        <button
          type="button"
          onClick={cargar}
          className="mt-1.5 text-[12px] font-semibold text-[var(--color-accent)] hover:underline"
        >
          Reintentar
        </button>
      </section>
    );
  }
  if (casos === null) {
    return <div className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />;
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
        <h2 className="font-display text-[14px] font-semibold text-[var(--color-foreground)]">
          Casos del agente
        </h2>
        <span className="text-[12px] tabular-nums text-[var(--color-muted)]">
          {casos.length === 0 ? "" : casos.length}
        </span>
      </div>

      {casos.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-[var(--color-muted)]">
          Nada entregado pendiente de resolver — el agente sigue trabajando solo.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {casos.map((c) => {
            const estaAbierto = abierto === c.telefono;
            return (
              <li key={c.telefono}>
                <button
                  type="button"
                  onClick={() => setAbierto(estaAbierto ? null : c.telefono)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-muted)]"
                >
                  {estaAbierto ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-muted)]" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)]" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-foreground)]">
                    {c.paciente}
                  </span>
                  <span className="min-w-0 flex-[2] truncate text-[12.5px] text-[var(--color-muted)]">
                    {c.queQuiere}
                  </span>
                  {c.enEspera && (
                    <PauseCircle className="h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" aria-hidden />
                  )}
                  <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-muted)]">
                    {c.edadDias === 0 ? "hoy" : c.edadDias === 1 ? "1 día" : `${c.edadDias} días`}
                  </span>
                </button>
                {estaAbierto && (
                  <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3">
                    <div className="max-w-md">
                      <FichaCasoPanel telefono={c.telefono} modo="seguimiento" />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
