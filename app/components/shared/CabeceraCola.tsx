"use client";

// LA CABECERA DE SEGUIMIENTO (delta P1, 18-08). Sustituye al banner de
// «{N} pendientes · {M} atendidos · 13% del plan de hoy» — el % era una
// métrica inventada: nadie fijó un plan. Aquí solo HECHOS de la cola:
// dinero parado (presupuestos que esperan a una persona), desglose por
// cohorte, leads contados (no valorados — no llevan importe en datos) y la
// antigüedad del caso más viejo, que es la presión real.
//
// Se alimenta sola de /api/seguimiento/resumen: la cola de tres cohortes se
// resuelve en el servidor y las dos pestañas comparten la misma cabecera.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ICON_STROKE } from "../icons";
import { cargarJSON } from "../../lib/fetch-json";
import { eur } from "./Cifra";

type Resumen = {
  dineroParado: number;
  leadsSinImporte: number;
  masViejoDias: number | null;
  porCohorte: Record<string, number>;
  totalCasos: number;
};

const ETIQUETAS: Array<[string, string]> = [
  ["necesita_respuesta", "necesitan respuesta"],
  ["listos_para_cerrar", "listos para cerrar"],
  ["fuera_de_plazo", "fuera de plazo"],
];

export function CabeceraCola() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setResumen(await cargarJSON<Resumen>("/api/seguimiento/resumen"));
      setError(false);
    } catch {
      // Conservar lo último bueno + señal honesta (§10).
      setError(true);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="rounded-2xl bg-[var(--color-accent-soft)] border border-[var(--color-border)] p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="fyllio-label text-[var(--color-accent)]">Parado esperándote</p>
          {resumen ? (
            <>
              <h2 className="font-display text-4xl font-bold mt-2 tracking-tight tabular-nums text-[var(--color-foreground)]">
                {eur(resumen.dineroParado)}
                {resumen.leadsSinImporte > 0 && (
                  <span className="ml-2 text-xl font-semibold text-[var(--color-muted)]">
                    + {resumen.leadsSinImporte} lead{resumen.leadsSinImporte !== 1 ? "s" : ""}
                  </span>
                )}
              </h2>
              <p className="text-sm text-[var(--color-muted)] mt-1 tabular-nums">
                {ETIQUETAS.filter(([k]) => (resumen.porCohorte[k] ?? 0) > 0)
                  .map(([k, l]) => `${resumen.porCohorte[k]} ${l}`)
                  .join(" · ") || "Nada esperando a una persona ahora mismo"}
              </p>
              {resumen.masViejoDias != null && resumen.totalCasos > 0 && (
                <p className="text-sm text-[var(--color-muted)] mt-1 tabular-nums">
                  El caso más viejo lleva{" "}
                  <span className="font-semibold text-[var(--color-foreground)]">
                    {resumen.masViejoDias === 0 ? "menos de un día" : `${resumen.masViejoDias} día${resumen.masViejoDias !== 1 ? "s" : ""}`}
                  </span>{" "}
                  esperando.
                </p>
              )}
            </>
          ) : (
            <div className="mt-2 h-10 w-56 animate-pulse rounded-md bg-[var(--color-surface)]" />
          )}
          {error && (
            <p className="text-sm text-[var(--color-danger)] mt-1">
              No se pudo actualizar{resumen ? " — cifras anteriores en pantalla" : ""}.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={cargar}
          disabled={cargando}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
        >
          <RefreshCw size={12} strokeWidth={ICON_STROKE} className={cargando ? "animate-spin" : ""} />
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>
    </div>
  );
}
