"use client";

// LOS DESCARTES DEL REVISOR, POR CLÍNICA (auditoría 2026-09-05, MEJORAS 151).
//
// Es el termómetro del generador: cada borrador que el juez tira lleva su
// motivo persistido desde el 14-08, y hasta hoy nadie lo miraba. Sube
// «económica» en una clínica → publicó algo que el juez no ve o el prompt
// inventa; sube «agenda» → el generador derivó; sube «el revisor no
// respondió» → la API va lenta. Un número por clínica y motivo, 30 días.

import { useCallback, useEffect, useState } from "react";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { ErrorState } from "../ui/Feedback";
import { ShieldCheck, ICON_STROKE } from "../icons";
import type { DescartesClinica } from "../../api/agente/descartes/route";

const MOTIVO: Record<string, string> = {
  clinica: "Hecho clínico",
  economica: "Condición económica",
  datos_sensibles: "Dato de salud no pedido",
  promesa: "Promesa sin entrega",
  agenda: "Agenda (huecos o reserva)",
  sin_categoria: "Sin categoría",
  juez_no_respondio: "Revisor sin respuesta",
};

export function DescartesJuezPanel() {
  const [datos, setDatos] = useState<{ dias: number; clinicas: DescartesClinica[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setDatos(await cargarJSON<{ dias: number; clinicas: DescartesClinica[] }>("/api/agente/descartes?dias=30"));
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header className="mb-3">
        <p className="fyllio-label flex items-center gap-1.5 text-[var(--color-muted)]">
          <ShieldCheck size={13} strokeWidth={ICON_STROKE} aria-hidden />
          Descartes del revisor · últimos {datos?.dias ?? 30} días
        </p>
        <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
          Borradores del agente que el revisor tiró y sustituyó por la respuesta neutra. Si sube en una
          clínica, algo de su configuración o del prompt se ha torcido.
        </p>
      </header>
      {error ? (
        <ErrorState detail={`Los descartes no se pudieron leer. ${error}`} onRetry={cargar} />
      ) : !datos ? (
        <div className="fyllio-skeleton h-16" />
      ) : datos.clinicas.length === 0 ? (
        <p className="text-[13px] text-[var(--color-muted)]">Sin turnos evaluados en este periodo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                <th className="py-1.5 pr-3">Clínica</th>
                <th className="py-1.5 pr-3 text-right tabular-nums">Turnos</th>
                <th className="py-1.5 pr-3 text-right tabular-nums">Descartes</th>
                <th className="py-1.5">Por motivo</th>
              </tr>
            </thead>
            <tbody>
              {datos.clinicas.map((c) => {
                const pct = c.turnos > 0 ? Math.round((c.descartes / c.turnos) * 100) : 0;
                return (
                  <tr key={c.clinicaId ?? "sin"} className="border-t border-[var(--color-border)]">
                    <td className="py-2 pr-3 font-medium text-[var(--color-foreground)]">
                      {c.clinicaNombre ?? (c.clinicaId ? c.clinicaId : "Sin clínica")}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-muted)]">{c.turnos}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${pct >= 20 ? "text-[var(--color-danger)]" : "text-[var(--color-foreground)]"}`}>
                      {c.descartes} <span className="font-normal text-[var(--color-muted)]">({pct} %)</span>
                    </td>
                    <td className="py-2">
                      <span className="flex flex-wrap gap-1">
                        {Object.entries(c.porMotivo)
                          .sort((a, b) => b[1] - a[1])
                          .map(([m, n]) => (
                            <span
                              key={m}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[11px] text-[var(--color-muted)]"
                            >
                              {MOTIVO[m] ?? m} <span className="tabular-nums font-semibold text-[var(--color-foreground)]">{n}</span>
                            </span>
                          ))}
                        {c.descartes === 0 && <span className="text-[11px] text-[var(--color-muted)]">—</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
