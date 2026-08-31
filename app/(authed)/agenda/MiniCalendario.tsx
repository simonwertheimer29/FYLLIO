"use client";

// G2.7 — el mini calendario del mes (dictado 31-08): saltar a cualquier día
// sin depender de las flechas, como Google. Puro cliente, sin datos: el
// calendario es aritmética (diaSemanaISO + sumaDias de lib compartidas).

import { useState } from "react";
import { sumaDias } from "../../lib/time";
import { diaSemanaISO } from "../../lib/agenda/disponibilidad";
import { ChevronLeft, ChevronRight, ICON_STROKE } from "../../components/icons";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS = ["L", "M", "X", "J", "V", "S", "D"];

const mesDe = (fecha: string) => fecha.slice(0, 7); // YYYY-MM

function sumarMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function MiniCalendario({
  seleccionada,
  hoy,
  onDia,
}: {
  seleccionada: string;
  hoy: string;
  onDia: (fecha: string) => void;
}) {
  const [mes, setMes] = useState(() => mesDe(seleccionada));
  const [y, m] = mes.split("-").map(Number);
  const primerDia = `${mes}-01`;
  // Arranca la cuadrícula en el lunes de la semana del día 1.
  let cursor = sumaDias(primerDia, 1 - diaSemanaISO(primerDia));
  const semanas: string[][] = [];
  for (let s = 0; s < 6; s++) {
    const fila: string[] = [];
    for (let d = 0; d < 7; d++) { fila.push(cursor); cursor = sumaDias(cursor, 1); }
    semanas.push(fila);
    if (cursor.slice(0, 7) > mes && diaSemanaISO(cursor) === 1) break;
  }

  return (
    <div className="w-52 shrink-0">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <p className="text-xs font-semibold text-[var(--color-foreground)]">
          {MESES[m - 1]} {y}
        </p>
        <div className="flex gap-0.5">
          <button type="button" aria-label="Mes anterior" onClick={() => setMes(sumarMes(mes, -1))}
            className="rounded-md p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">
            <ChevronLeft size={13} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
          <button type="button" aria-label="Mes siguiente" onClick={() => setMes(sumarMes(mes, 1))}
            className="rounded-md p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">
            <ChevronRight size={13} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 px-0.5">
        {DIAS.map((d, i) => (
          <span key={i} className="py-0.5 text-center text-[9px] font-medium uppercase text-[var(--color-muted)]">{d}</span>
        ))}
        {semanas.flat().map((f) => {
          const delMes = f.slice(0, 7) === mes;
          const esHoy = f === hoy;
          const esSel = f === seleccionada;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onDia(f)}
              className={`h-6 rounded-full text-center text-[10.5px] [font-variant-numeric:tabular-nums] transition-colors ${
                esSel
                  ? "bg-[var(--color-accent)] font-semibold text-[var(--color-on-accent)]"
                  : esHoy
                    ? "bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent)]"
                    : delMes
                      ? "text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
                      : "text-[var(--color-muted)] opacity-50 hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {Number(f.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
