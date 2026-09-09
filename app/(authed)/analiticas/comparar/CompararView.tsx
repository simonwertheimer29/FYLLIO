"use client";
// app/(authed)/analiticas/comparar/CompararView.tsx
//
// «Aceptaba el 40 % y ahora el 52 % desde el día X» — con n, ventana igual y
// aviso de no causalidad (2.6, MEJORAS 181). La persona elige clínica (o red),
// la marca (un hito del historial de configuración o una fecha) y la ventana.
// Lo no comparable se dice con su motivo; nunca un guion que parezca «igual».

import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState } from "../../../components/ui/Feedback";
import { AlertTriangle, RefreshCw, TrendingUp, TrendingDown, Minus, ICON_STROKE } from "../../../components/icons";
import { cargarJSON, mensajeDeError } from "../../../lib/fetch-json";
import { deDiccionario } from "../../../lib/diccionario";
// Del módulo PURO, nunca de `diarias.ts`: aquello arrastraría pg al navegador
// (a583fb1 rompió el build de Vercel por esto).
import { ETIQUETA_METRICA, SENTIDO, UNIDAD, type Metrica } from "../../../lib/metricas/definiciones";

type Ventana = { desde: string; hasta: string; dias: number; diasConDato: number; valor: number | null; n: number };
type Comparacion = {
  metrica: Metrica;
  agregacion: "suma" | "mediana_ponderada";
  antes: Ventana;
  despues: Ventana;
  delta: number | null;
  deltaPct: number | null;
  comparable: boolean;
  motivo: string | null;
  definicionV: number | null;
};
type Hito = { dia: string; campo: string; etiqueta: string; antes: string | null; despues: string | null; actor: string | null };
type Respuesta = {
  clinicas: { id: string; nombre: string }[];
  puedeRed: boolean;
  clinicaId: string;
  marca: string;
  dias: number;
  d: number;
  comparaciones: Comparacion[];
  sinDespues: boolean;
  hitos: Hito[];
  aviso: string;
  hoy: string;
};

const fmtN = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const fmtDec = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
const fmtEur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtUsd = new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function formatear(metrica: Metrica, v: number | null): string {
  if (v == null) return "—";
  const u = deDiccionario(UNIDAD, metrica, "n", "comparar.unidad");
  if (u === "eur") return fmtEur.format(v);
  if (u === "usd") return fmtUsd.format(v);
  if (u === "min") return `${fmtDec.format(v)} min`;
  if (u === "ms") return `${fmtN.format(v)} ms`;
  return fmtN.format(v);
}

function fechaCorta(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export function CompararView() {
  const [clinicaId, setClinicaId] = useState<string | null>(null);
  const [marca, setMarca] = useState<string | null>(null);
  const [dias, setDias] = useState<7 | 14 | 28>(14);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ dias: String(dias) });
      if (clinicaId) qs.set("clinicaId", clinicaId);
      if (marca) qs.set("marca", marca);
      const r = await cargarJSON<Respuesta>(`/api/metricas/antes-despues?${qs.toString()}`, {
        validar: (d) => Array.isArray((d as Respuesta)?.comparaciones) && Array.isArray((d as Respuesta)?.clinicas),
      });
      setDatos(r);
      // El servidor resuelve los defaults (clínica, marca): se fijan para que
      // los controles enseñen lo mismo que se ha calculado.
      if (!clinicaId) setClinicaId(r.clinicaId);
      if (!marca) setMarca(r.marca);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [clinicaId, marca, dias]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const comparables = useMemo(() => datos?.comparaciones.filter((c) => c.comparable) ?? [], [datos]);
  const noComparables = useMemo(() => datos?.comparaciones.filter((c) => !c.comparable) ?? [], [datos]);

  return (
    <div className="max-w-5xl space-y-5 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-geist-sans)] text-xl font-semibold text-[var(--color-foreground)]">Antes y después</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]" title="Cada cifra lleva sus casos (n) y sus días con dato; si no hay suficiente, se dice.">
            La misma clínica, los mismos días antes y después de un cambio.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void cargar()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
        >
          <RefreshCw size={14} strokeWidth={ICON_STROKE} className={cargando ? "animate-spin" : ""} />
          Actualizar
        </button>
      </header>

      {error && <ErrorState title="No se pudo calcular la comparación" detail={error} onRetry={() => void cargar()} />}

      {datos && (
        <>
          <section className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
              Clínica
              <select
                value={clinicaId ?? datos.clinicaId}
                onChange={(e) => setClinicaId(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-foreground)]"
              >
                {datos.puedeRed && <option value="red">Toda la red</option>}
                {datos.clinicas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
              Día del cambio (la marca)
              <input
                type="date"
                value={marca ?? datos.marca}
                max={datos.hoy}
                onChange={(e) => e.target.value && setMarca(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-foreground)]"
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
              Ventana
              <div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 text-sm">
                {([7, 14, 28] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDias(d)}
                    className={`rounded-md px-3 py-1 ${dias === d ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}
                  >
                    {d} días
                  </button>
                ))}
              </div>
            </div>
            {datos.hitos.length > 0 && (
              <div className="basis-full">
                <div className="mb-1 text-xs text-[var(--color-muted)]">Cambios registrados (pulsa uno para usarlo como marca)</div>
                <div className="flex flex-wrap gap-1.5">
                  {datos.hitos.slice(0, 8).map((h) => (
                    <button
                      key={`${h.dia}-${h.campo}`}
                      type="button"
                      onClick={() => setMarca(h.dia)}
                      title={h.actor ? `Por ${h.actor}` : undefined}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${
                        (marca ?? datos.marca) === h.dia
                          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                          : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
                      }`}
                    >
                      {fechaCorta(h.dia)} · {h.etiqueta}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <p className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-foreground)]">
            <AlertTriangle size={16} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
            <span>{datos.aviso}</span>
          </p>

          {datos.sinDespues ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted)]">
              Todavía no hay ni un día completo después del {fechaCorta(datos.marca)}: no hay «después» que comparar. Vuelve
              mañana o elige una marca anterior.
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--color-muted)]">
                Ventana real: <span className="font-medium text-[var(--color-foreground)]">{datos.d} días</span> a cada lado del{" "}
                {fechaCorta(datos.marca)}
                {datos.d < datos.dias ? ` (pediste ${datos.dias}; aún no han pasado tantos después del cambio, así que las dos ventanas se acortan)` : ""}.
                Las medianas se promedian ponderando por sus casos.
              </p>

              <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="px-3 py-2 font-medium">Métrica</th>
                      <th className="px-3 py-2 font-medium text-right">Antes</th>
                      <th className="px-3 py-2 font-medium text-right">Después</th>
                      <th className="px-3 py-2 font-medium text-right">Cambio</th>
                      <th className="px-3 py-2 font-medium text-right">Casos (n)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparables.map((c) => {
                      const sentido = deDiccionario(SENTIDO, c.metrica, "neutro", "comparar.sentido");
                      const mejora = c.delta == null || c.delta === 0 || sentido === "neutro" ? null : (c.delta > 0) === (sentido === "mas_mejor");
                      const color = mejora == null ? "text-[var(--color-foreground)]" : mejora ? "text-[var(--color-success)]" : "text-[var(--color-danger)]";
                      const Icono = c.delta == null || c.delta === 0 ? Minus : c.delta > 0 ? TrendingUp : TrendingDown;
                      return (
                        <tr key={c.metrica} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="px-3 py-2 text-[var(--color-foreground)]">
                            {deDiccionario(ETIQUETA_METRICA, c.metrica, c.metrica, "comparar.metrica")}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[var(--color-foreground)]">{formatear(c.metrica, c.antes.valor)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[var(--color-foreground)]">{formatear(c.metrica, c.despues.valor)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${color}`}>
                            <span className="inline-flex items-center gap-1">
                              <Icono size={14} strokeWidth={ICON_STROKE} aria-hidden />
                              {c.delta == null ? "—" : `${c.delta > 0 ? "+" : ""}${formatear(c.metrica, c.delta)}`}
                              {c.deltaPct != null && <span className="text-xs text-[var(--color-muted)]">({c.deltaPct > 0 ? "+" : ""}{fmtDec.format(c.deltaPct)} %)</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-xs text-[var(--color-muted)]">
                            {fmtN.format(c.antes.n)} → {fmtN.format(c.despues.n)}
                          </td>
                        </tr>
                      );
                    })}
                    {comparables.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-sm text-[var(--color-muted)]">
                          Ninguna métrica es comparable con esta marca y ventana. Abajo, por qué.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {noComparables.length > 0 && (
                <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
                  <summary className="cursor-pointer text-[var(--color-foreground)]">
                    {noComparables.length} métrica{noComparables.length === 1 ? "" : "s"} sin comparación honesta
                  </summary>
                  <ul className="mt-2 space-y-1 text-[var(--color-muted)]">
                    {noComparables.map((c) => (
                      <li key={c.metrica}>
                        <span className="text-[var(--color-foreground)]">
                          {deDiccionario(ETIQUETA_METRICA, c.metrica, c.metrica, "comparar.metrica")}
                        </span>
                        : {c.motivo} · antes {c.antes.diasConDato}/{c.antes.dias} días con dato, después {c.despues.diasConDato}/{c.despues.dias}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
