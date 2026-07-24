"use client";

// Bloque 2 (2026-07-23) — Dashboard de MANAGER. Responde, en orden:
//   1. ¿Dónde pierdo dinero ahora?   → franja "Hoy" (riesgo + logros)
//   2. ¿Cómo va el negocio?          → números grandes con delta mensual
//   3. ¿Qué clínica sube y cuál baja?→ tabla comparativa ordenable
//   4. ¿Progresamos?                 → € aceptado por mes (6 meses)
//
// El dashboard INFORMA, nunca ejecuta: todo clic navega a colas/fichas.
// Todo el cálculo vive en el servidor (lib/dashboard-red — las MISMAS
// funciones de las colas); aquí solo presentación. La home de la
// coordinadora (Actuar hoy) no se toca. El viejo CommandCenterView dejó
// de montarse aquí (era su último consumidor — retirada anotada en MEJORAS).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { UserSession } from "../../lib/presupuestos/types";
import type { DashboardRed, CifraDelta, ClinicaFila } from "../../lib/dashboard-red";
import { useClinic } from "../../lib/context/ClinicContext";
import { openCopilot } from "../../components/copilot/openCopilot";
import { ErrorState } from "../../components/ui/Feedback";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  CircleDollarSign,
  CheckCircle2,
  ChevronRight,
  BarChart3,
  Building2,
  Activity,
  ICON_STROKE,
} from "../../components/icons";

const eur = (n: number) =>
  n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (yyyyMm: string) => {
  const m = Number(yyyyMm.slice(5, 7));
  return `${MESES_CORTOS[m - 1] ?? yyyyMm} ${yyyyMm.slice(2, 4)}`;
};

// ─── Delta ↑↓ vs mes anterior ───────────────────────────────────────────
function Delta({ d, formato }: { d: CifraDelta; formato?: (n: number) => string }) {
  if (d.previo === 0 && d.valor === 0) return null;
  if (d.previo === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--color-muted)]" title="Sin datos del mes anterior para comparar">
        <Minus size={10} strokeWidth={ICON_STROKE} aria-hidden /> nuevo
      </span>
    );
  }
  const pct = Math.round(((d.valor - d.previo) / d.previo) * 100);
  const sube = pct > 0;
  const igual = pct === 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums ${
        igual
          ? "text-[var(--color-muted)]"
          : sube
            ? "text-emerald-600 dark:text-emerald-300"
            : "text-rose-600 dark:text-rose-300"
      }`}
      title={`Mes anterior: ${formato ? formato(d.previo) : d.previo.toLocaleString("es-ES")}`}
    >
      {igual ? (
        <Minus size={10} strokeWidth={ICON_STROKE} aria-hidden />
      ) : sube ? (
        <TrendingUp size={10} strokeWidth={ICON_STROKE} aria-hidden />
      ) : (
        <TrendingDown size={10} strokeWidth={ICON_STROKE} aria-hidden />
      )}
      {igual ? "=" : `${sube ? "+" : ""}${pct}%`}
    </span>
  );
}

function Cifra({
  label,
  valor,
  delta,
  formato,
  destacada,
}: {
  label: string;
  valor: string;
  delta?: CifraDelta;
  formato?: (n: number) => string;
  destacada?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-muted)]">{label}</p>
      <p
        className={`font-display font-bold tabular-nums text-[var(--color-foreground)] ${
          destacada ? "text-2xl" : "text-xl"
        }`}
      >
        {valor}
        {delta && (
          <span className="ml-1.5 align-middle">
            <Delta d={delta} formato={formato} />
          </span>
        )}
      </p>
    </div>
  );
}

// ─── Título-pregunta de sección: el esqueleto escaneable de la página ───
function TituloSeccion({
  icono,
  children,
}: {
  icono: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2.5 font-display text-lg lg:text-xl font-semibold tracking-tight text-[var(--color-foreground)] mb-4">
      <span className="text-[var(--color-muted)]">{icono}</span>
      {children}
    </h2>
  );
}

// ─── Vista ──────────────────────────────────────────────────────────────
type OrdenClinicas = "tendencia" | "conversion" | "aceptado" | "pendiente";

export function RedView({ user: _user }: { user: UserSession }) {
  const router = useRouter();
  const { setSelectedClinicaId } = useClinic();
  const [data, setData] = useState<DashboardRed | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [orden, setOrden] = useState<OrdenClinicas>("tendencia");

  const load = useCallback(() => {
    setLoadError(false);
    fetch("/api/red/dashboard")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setData(d))
      .catch(() => setLoadError(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const clinicasOrdenadas = useMemo(() => {
    const filas = [...(data?.clinicas ?? [])];
    if (orden === "tendencia") filas.sort((a, b) => (a.tendenciaPct ?? Infinity) - (b.tendenciaPct ?? Infinity));
    if (orden === "conversion") filas.sort((a, b) => (b.conversionPct ?? -1) - (a.conversionPct ?? -1));
    if (orden === "aceptado") filas.sort((a, b) => b.aceptadoMes - a.aceptadoMes);
    if (orden === "pendiente") filas.sort((a, b) => b.pendiente - a.pendiente);
    return filas;
  }, [data, orden]);

  function irAClinica(c: ClinicaFila) {
    // "Detalle de clínica" = fijar su ámbito en el selector global y abrir
    // KPIs: todo el producto queda filtrado a esa clínica.
    setSelectedClinicaId(c.id);
    router.push("/kpis");
  }

  if (loadError) {
    return (
      <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)] p-6">
        <div className="max-w-5xl mx-auto">
          <ErrorState detail="El dashboard no está disponible ahora mismo." onRetry={load} />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)] p-6">
        <div className="max-w-5xl mx-auto space-y-4 animate-pulse">
          <div className="h-24 rounded-2xl bg-[var(--color-surface-muted)]" />
          <div className="h-40 rounded-2xl bg-[var(--color-surface-muted)]" />
          <div className="h-48 rounded-2xl bg-[var(--color-surface-muted)]" />
          <div className="h-56 rounded-2xl bg-[var(--color-surface-muted)]" />
        </div>
      </div>
    );
  }

  const { hoy, negocio, progreso } = data;
  const conv = negocio.presupuestos.conversionMes;

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)]">
      <div className="max-w-screen-2xl mx-auto p-4 lg:p-8">
        <header className="flex items-start justify-between gap-3 flex-wrap mb-6">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">Red</h1>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">Dónde pierdes dinero, cómo va el negocio y qué clínica necesita atención</p>
          </div>
          <button
            type="button"
            onClick={() => {
              const resumen = [
                `Riesgo hoy: ${hoy.riesgo.map((r) => `${r.importe != null ? eur(r.importe) + " en " : r.n + " "}${r.label}`).join(" · ") || "nada"}`,
                `Funcionando: ${hoy.exitos.map((e) => `${e.dato} ${e.label}`).join(" · ") || "sin cambios destacables"}`,
                `Aceptado mes: ${eur(negocio.presupuestos.aceptadosImporteMes.valor)} (prev ${eur(negocio.presupuestos.aceptadosImporteMes.previo)})`,
                `Cobrado mes: ${eur(negocio.cobros.cobradoMes.valor)} · pendiente ${eur(negocio.cobros.pendiente)} · vencido ${eur(negocio.cobros.vencido)}`,
                `Conversión presupuestos: ${conv.pct ?? "—"}% (prev ${conv.pctPrevio ?? "—"}%)`,
              ].join("\n");
              openCopilot({
                context: { kind: "red_admin", summary: resumen },
                initialAssistantMessage: "He visto el dashboard de la red. ¿Qué punto quieres que analicemos?",
              });
            }}
            className="fyllio-ia-gradient text-xs font-medium px-3 py-2 rounded-md hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
          >
            <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden /> Analiza el mes
          </button>
        </header>

        {/* Dos columnas ~60/40 en desktop; una columna en móvil con el orden
            riesgo → funcionando → negocio → clínicas → progreso. */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8 items-start">
          {/* ══ COLUMNA IZQUIERDA ══ */}
          <div className="lg:col-span-3 space-y-10">
            {/* ── 1 · ¿DÓNDE PIERDES DINERO HOY? ── */}
            <section>
              <TituloSeccion icono={<CircleDollarSign size={20} strokeWidth={ICON_STROKE} aria-hidden />}>
                ¿Dónde pierdes dinero hoy?
              </TituloSeccion>
              {hoy.riesgo.length === 0 ? (
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 flex items-center gap-2.5">
                  <CheckCircle2 size={18} strokeWidth={ICON_STROKE} className="text-[var(--color-success)] shrink-0" aria-hidden />
                  <p className="text-sm font-semibold text-[var(--color-foreground)]">
                    Nada en riesgo hoy — las colas están al día.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] p-2 sm:p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {hoy.riesgo.map((r) => (
                      <Link
                        key={r.tipo}
                        href={r.href}
                        className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5 flex items-center justify-between gap-3 hover:border-[var(--color-danger)]/50 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="font-display text-2xl font-bold tabular-nums text-[var(--color-foreground)]">
                            {r.importe != null ? eur(r.importe) : r.n}
                          </p>
                          <p className="text-xs text-[var(--color-muted)] mt-0.5">{r.label}</p>
                        </div>
                        <ChevronRight
                          size={16}
                          strokeWidth={ICON_STROKE}
                          className="text-[var(--color-muted)] group-hover:text-[var(--color-danger)] shrink-0 transition-colors"
                          aria-hidden
                        />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* ── 2 · QUÉ ESTÁ FUNCIONANDO ── */}
            <section>
              <TituloSeccion icono={<TrendingUp size={20} strokeWidth={ICON_STROKE} aria-hidden />}>
                Qué está funcionando
              </TituloSeccion>
              {hoy.exitos.length === 0 ? (
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
                  <p className="text-sm text-[var(--color-muted)]">Sin cambios destacables esta semana.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--color-success)]/25 bg-[var(--color-success-soft)] p-2 sm:p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {hoy.exitos.map((e) => (
                      <div
                        key={e.tipo}
                        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5"
                      >
                        <p className="font-display text-2xl font-bold tabular-nums text-[var(--color-foreground)]">{e.dato}</p>
                        <p className="text-xs text-[var(--color-muted)] mt-0.5">{e.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* ── 3 · EL NEGOCIO ── */}
            <section>
              <TituloSeccion icono={<BarChart3 size={20} strokeWidth={ICON_STROKE} aria-hidden />}>
                El negocio
              </TituloSeccion>
              <div className="space-y-8">
                <div className="border-l-2 border-[var(--color-accent)] pl-4 lg:pl-5">
                  <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-3">Leads</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Cifra label="Nuevos (mes)" valor={String(negocio.leads.nuevosMes.valor)} delta={negocio.leads.nuevosMes} />
                    <Cifra label="En seguimiento" valor={String(negocio.leads.enSeguimiento)} />
                    <Cifra label="Citados (mes)" valor={String(negocio.leads.citadosMes.valor)} delta={negocio.leads.citadosMes} />
                    <Cifra
                      label="Conversión del mes"
                      valor={negocio.leads.conversionMes.pct != null ? `${negocio.leads.conversionMes.pct}%` : "—"}
                      delta={
                        negocio.leads.conversionMes.pct != null && negocio.leads.conversionMes.pctPrevio != null
                          ? { valor: negocio.leads.conversionMes.pct, previo: negocio.leads.conversionMes.pctPrevio }
                          : undefined
                      }
                    />
                  </div>
                </div>
                <div className="border-l-2 border-[var(--color-accent)] pl-4 lg:pl-5">
                  <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-3">
                    Presupuestos
                    {negocio.presupuestos.perdidosSinFecha > 0 && (
                      <span className="ml-2 text-[10px] font-normal text-[var(--color-muted)]" title="Perdidos antiguos sin registro de fecha en el historial — no se atribuyen a ningún mes">
                        +{negocio.presupuestos.perdidosSinFecha} perdido{negocio.presupuestos.perdidosSinFecha === 1 ? "" : "s"} sin fecha
                      </span>
                    )}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Cifra
                      label="Presentados (mes)"
                      valor={`${negocio.presupuestos.presentadosMes.valor} · ${eur(negocio.presupuestos.presentadosImporteMes.valor)}`}
                      delta={negocio.presupuestos.presentadosMes}
                    />
                    <Cifra
                      label="Aceptados (mes)"
                      valor={`${negocio.presupuestos.aceptadosMes.valor} · ${eur(negocio.presupuestos.aceptadosImporteMes.valor)}`}
                      delta={negocio.presupuestos.aceptadosImporteMes}
                      formato={eur}
                    />
                    <Cifra
                      label="Perdidos (mes)"
                      valor={`${negocio.presupuestos.perdidosMes.valor} · ${eur(negocio.presupuestos.perdidosImporteMes.valor)}`}
                      delta={negocio.presupuestos.perdidosMes}
                    />
                    <Cifra
                      label="Conversión presentado→aceptado"
                      valor={conv.pct != null ? `${conv.pct}%` : "—"}
                      delta={conv.pct != null && conv.pctPrevio != null ? { valor: conv.pct, previo: conv.pctPrevio } : undefined}
                      destacada
                    />
                  </div>
                </div>
                <div className="border-l-2 border-[var(--color-accent)] pl-4 lg:pl-5">
                  <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-3">Cobros</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Cifra label="Cobrado (mes)" valor={eur(negocio.cobros.cobradoMes.valor)} delta={negocio.cobros.cobradoMes} formato={eur} />
                    <Cifra label="Pendiente" valor={eur(negocio.cobros.pendiente)} />
                    <Cifra label="Vencido" valor={eur(negocio.cobros.vencido)} />
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* ══ COLUMNA DERECHA (pendiente de rediseño tras el checkpoint) ══ */}
          <div className="lg:col-span-2 space-y-10">
        {/* ── 4 · CLÍNICAS ────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="px-5 pt-4 pb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Clínicas</h2>
            <p className="text-[10px] text-[var(--color-muted)]">mes actual · clic en columna para ordenar</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left font-semibold px-5 py-2">Clínica</th>
                  {(
                    [
                      ["conversion", "Conversión"],
                      ["aceptado", "€ aceptado"],
                      ["pendiente", "€ pendiente"],
                      ["tendencia", "Tendencia"],
                    ] as Array<[OrdenClinicas, string]>
                  ).map(([k, l]) => (
                    <th key={k} className="text-right font-semibold px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setOrden(k)}
                        className={`hover:text-[var(--color-foreground)] ${orden === k ? "text-[var(--color-accent)]" : ""}`}
                      >
                        {l}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clinicasOrdenadas.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => irAClinica(c)}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-muted)] cursor-pointer"
                  >
                    <td className="px-5 py-2.5 font-semibold text-[var(--color-foreground)]">{c.nombre}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-foreground)]">
                      {c.conversionPct != null ? `${c.conversionPct}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-foreground)]">{eur(c.aceptadoMes)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-muted)]">{eur(c.pendiente)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {c.tendenciaPct == null ? (
                        <span className="text-[var(--color-muted)]" title="Sin € aceptado el mes anterior para comparar">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
                            c.tendenciaPct < 0
                              ? "text-rose-600 dark:text-rose-300"
                              : c.tendenciaPct > 0
                                ? "text-emerald-600 dark:text-emerald-300"
                                : "text-[var(--color-muted)]"
                          }`}
                        >
                          {c.tendenciaPct < 0 ? (
                            <TrendingDown size={12} strokeWidth={ICON_STROKE} aria-hidden />
                          ) : c.tendenciaPct > 0 ? (
                            <TrendingUp size={12} strokeWidth={ICON_STROKE} aria-hidden />
                          ) : (
                            <Minus size={12} strokeWidth={ICON_STROKE} aria-hidden />
                          )}
                          {c.tendenciaPct > 0 ? "+" : ""}
                          {c.tendenciaPct}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {clinicasOrdenadas.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-[var(--color-muted)]">
                      Sin clínicas visibles en tu sesión.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 4 · PROGRESO ────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">€ aceptado por mes</h2>
          <p className="text-[10px] text-[var(--color-muted)] mb-3">Últimos 6 meses</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={progreso.map((p) => ({ ...p, label: mesLabel(p.mes) }))} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                />
                <Tooltip
                  formatter={(v) => [eur(Number(v)), "Aceptado"]}
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    fontSize: 12,
                    color: "var(--color-foreground)",
                  }}
                  cursor={{ fill: "var(--color-surface-muted)" }}
                />
                <Bar dataKey="importe" fill="var(--color-accent)" radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}
