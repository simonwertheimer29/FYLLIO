"use client";

// F3 (fase F) — LA CAMPANA: las alertas dejan de ser ventana. Interrumpen,
// no se visitan (dictado): badge con el número de situaciones activas, y al
// pulsar, desplegable con las alarmas y sus acciones — Avisar (WhatsApp a la
// coordinadora, cooldown 2 h) y Posponer hasta mañana. Mismo API y mismas
// reglas que tenía /alertas; solo cambia la superficie.
//
// Admin only (como era la ventana). El recuento se carga al montar y se
// refresca cada 5 min y al abrir — el cálculo es en vivo y no puede correr
// en cada render.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { eur } from "../shared/Cifra";
import { Bell, ICON_STROKE } from "../icons";

type Tipo =
  | "leads" | "presupuestos" | "citados" | "asistencias" | "automatizaciones"
  | "cobro_vence_3d" | "cobro_vencido_7d" | "pendiente_alto_estancado";

type AlertaFila = {
  clinicaId: string;
  clinicaNombre: string;
  counts: Record<Tipo, number>;
  importes: Partial<Record<Tipo, number>>;
  cooldowns: Partial<Record<Tipo, { untilMs: number } | null>>;
  pospuesta: Partial<Record<Tipo, { ocultaHasta: string; por: string | null } | null>>;
};

const TIPO_LABEL: Record<Tipo, string> = {
  leads: "Leads sin gestionar",
  presupuestos: "Presupuestos sin seguimiento",
  citados: "Citados no asistidos",
  asistencias: "Asistencias sin cerrar",
  automatizaciones: "Automatizaciones con error",
  cobro_vence_3d: "Liquidaciones a punto de vencer",
  cobro_vencido_7d: "Liquidaciones vencidas",
  pendiente_alto_estancado: "Presupuestos altos estancados",
};

/** El orden por daño de la ventana vieja: primero con €, luego urgencia fija. */
const PRIORIDAD: Tipo[] = [
  "cobro_vencido_7d", "cobro_vence_3d", "pendiente_alto_estancado",
  "leads", "asistencias", "presupuestos", "citados", "automatizaciones",
];

type Situacion = { fila: AlertaFila; tipo: Tipo; n: number; importe: number | null; enCooldown: boolean };

function aplanar(alertas: AlertaFila[]): { activas: Situacion[]; pospuestas: number } {
  const activas: Situacion[] = [];
  let pospuestas = 0;
  for (const fila of alertas) {
    for (const tipo of PRIORIDAD) {
      const n = fila.counts[tipo] ?? 0;
      if (n <= 0) continue;
      if (fila.pospuesta[tipo]) {
        pospuestas++;
        continue;
      }
      activas.push({
        fila, tipo, n,
        importe: fila.importes[tipo] ?? null,
        enCooldown: (fila.cooldowns[tipo]?.untilMs ?? 0) > Date.now(),
      });
    }
  }
  activas.sort((a, b) => (b.importe ?? -1) - (a.importe ?? -1) || PRIORIDAD.indexOf(a.tipo) - PRIORIDAD.indexOf(b.tipo));
  return { activas, pospuestas };
}

export function CampanaAlertas() {
  const [alertas, setAlertas] = useState<AlertaFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await cargarJSON<{ alertas: AlertaFila[] }>("/api/alertas");
      setAlertas(d.alertas);
      setError(null);
    } catch (e) {
      // Conservar lo último bueno (§10): el badge no se borra por un fallo
      // de red — el error se enseña al abrir.
      setError(mensajeDeError(e));
    }
  }, []);

  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 5 * 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  // Cerrar al pinchar fuera.
  useEffect(() => {
    if (!abierta) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierta(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [abierta]);

  const { activas, pospuestas } = alertas ? aplanar(alertas) : { activas: [], pospuestas: 0 };

  async function accion(s: Situacion, tipo: "enviar" | "posponer") {
    const clave = `${s.fila.clinicaId}:${s.tipo}:${tipo}`;
    if (ocupada) return;
    setOcupada(clave);
    try {
      await cargarJSON(`/api/alertas/${tipo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicaId: s.fila.clinicaId, tipoAlerta: s.tipo }),
      });
      toast.success(tipo === "enviar" ? "Aviso enviado a la coordinadora" : "Pospuesta hasta mañana");
      await cargar();
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setOcupada(null);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Alertas${activas.length ? ` — ${activas.length} activas` : ""}`}
        onClick={() => {
          setAbierta((v) => !v);
          if (!abierta) void cargar();
        }}
        className="relative rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)]"
      >
        <Bell size={16} strokeWidth={ICON_STROKE} aria-hidden />
        {activas.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[9.5px] font-bold tabular-nums text-white">
            {activas.length}
          </span>
        )}
      </button>

      {abierta && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[22rem] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          <div className="border-b border-[var(--color-border)] px-3 py-2">
            <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">
              {activas.length === 0 ? "Sin urgencias pendientes" : `${activas.length} ${activas.length === 1 ? "situación activa" : "situaciones activas"}`}
            </p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {error && (
              <p className="px-2 py-1.5 text-[12px] text-[var(--color-danger)]">
                No se pudieron actualizar las alertas. {error}
              </p>
            )}
            {alertas == null && !error && (
              <div className="m-2 h-10 animate-pulse rounded-md bg-[var(--color-surface-muted)]" />
            )}
            {activas.map((s) => (
              <div key={`${s.fila.clinicaId}:${s.tipo}`} className="rounded-lg px-2 py-2 hover:bg-[var(--color-surface-muted)]">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-[12.5px] font-medium text-[var(--color-foreground)]">
                    {TIPO_LABEL[s.tipo]}
                  </p>
                  {s.importe != null && (
                    <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[var(--color-danger)]">
                      {eur(s.importe)}
                    </span>
                  )}
                </div>
                <p className="text-[11.5px] text-[var(--color-muted)]">
                  {s.fila.clinicaNombre} · {s.n} {s.n === 1 ? "caso" : "casos"}
                </p>
                <div className="mt-1 flex gap-1.5">
                  <button
                    type="button"
                    disabled={s.enCooldown || ocupada != null}
                    onClick={() => accion(s, "enviar")}
                    className="rounded-lg border border-[var(--color-border)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface)] disabled:opacity-50"
                  >
                    {s.enCooldown ? "Avisada" : "Avisar"}
                  </button>
                  <button
                    type="button"
                    disabled={ocupada != null}
                    onClick={() => accion(s, "posponer")}
                    className="rounded-lg px-2 py-0.5 text-[11.5px] text-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-50"
                  >
                    Posponer
                  </button>
                </div>
              </div>
            ))}
            {alertas != null && activas.length === 0 && !error && (
              <p className="px-2 py-3 text-center text-[12px] text-[var(--color-muted)]">
                Nada urgente ahora mismo.
              </p>
            )}
          </div>
          {pospuestas > 0 && (
            <p className="border-t border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-muted)]">
              {pospuestas} {pospuestas === 1 ? "pospuesta" : "pospuestas"} hasta mañana.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
