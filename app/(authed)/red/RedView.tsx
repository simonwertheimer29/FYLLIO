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
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { UserSession } from "../../lib/presupuestos/types";
import type { DashboardRed, ConversionCohorte, ClinicaFila } from "../../lib/dashboard-red";
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

// `useGrouping` explícito: es-ES omite el separador en los números de cuatro
// cifras, así que en una columna de importes convivían "12.430 €" y "5100 €".
const eur = (n: number) =>
  n.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    useGrouping: true,
  });

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (yyyyMm: string) => {
  const m = Number(yyyyMm.slice(5, 7));
  return `${MESES_CORTOS[m - 1] ?? yyyyMm} ${yyyyMm.slice(2, 4)}`;
};

// ─── Comparación: UNA sola gramática en toda la página ──────────────────
//
// El valor manda y la referencia va detrás, expresada EN LAS MISMAS UNIDADES
// que el valor: «48 (eran 14)» · «12.400 € (eran 9.800 €)» · «33% (era 100%)».
// Antes convivían tres gramáticas —Δ% relativo en los chips, Δ absoluto en
// "pts" en la tabla y Δ% otra vez en Tendencia—, y cuando el chip recibía un
// porcentaje producía un % de un %: 29 vs 67 se pintaba «−57%» con el mismo
// sufijo que un delta de unidades. Nadie podía leer eso bien.
//
// La dirección la dan color y flecha; nunca un segundo número.

type TipoCifra = "numero" | "dinero" | "porcentaje";

const fmtCifra = (n: number, tipo: TipoCifra) =>
  tipo === "dinero" ? eur(n) : tipo === "porcentaje" ? `${n}%` : n.toLocaleString("es-ES");

function Comparativa({
  valor,
  previo,
  tipo,
  /** Sin señal de dirección: la comparación se lee, pero no juzga. */
  neutral,
  /** Métricas donde subir es MALO (perdidos, vencido): el color va al revés.
   *  Sin esto, "7 perdidos, eran 5" se pintaba en verde de subida. */
  subirEsMalo,
  titulo,
}: {
  valor: number;
  previo: number;
  tipo: TipoCifra;
  neutral?: boolean;
  subirEsMalo?: boolean;
  titulo?: string;
}) {
  if (previo === 0 && valor === 0) return null;
  if (previo === 0) {
    return (
      <span
        className="text-[11px] text-[var(--color-muted)]"
        title="El mes anterior no registró nada en este tramo: no hay con qué comparar."
      >
        sin referencia
      </span>
    );
  }
  const sube = valor > previo;
  const igual = valor === previo;
  const verbo = tipo === "numero" && previo === 1 ? "era" : tipo === "porcentaje" ? "era" : "eran";
  // La flecha dice hacia dónde se movió el número; el color, si eso es bueno.
  const bueno = subirEsMalo ? !sube : sube;
  const tono = neutral || igual
    ? "text-[var(--color-muted)]"
    : bueno
      ? "text-[var(--color-success)]"
      : "text-[var(--color-danger)]";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${tono}`}
      title={titulo ?? "Comparado con el mismo tramo del mes anterior (días 1 a hoy)."}
    >
      {neutral || igual ? (
        <Minus size={11} strokeWidth={ICON_STROKE} aria-hidden />
      ) : sube ? (
        <TrendingUp size={11} strokeWidth={ICON_STROKE} aria-hidden />
      ) : (
        <TrendingDown size={11} strokeWidth={ICON_STROKE} aria-hidden />
      )}
      {igual ? "igual que el mes pasado" : `${verbo} ${fmtCifra(previo, tipo)}`}
    </span>
  );
}

/** Comparación imposible todavía: la cohorte del mes sigue decidiéndose. */
function SinComparar({ abiertos, total, unidad }: { abiertos: number; total: number; unidad: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-[var(--color-muted)]"
      title={`Todavía no se puede comparar: ${abiertos} de los ${total} ${unidad} de este mes siguen sin decidirse. Frente a un mes ya cerrado, la caída sería falsa.`}
    >
      <Minus size={11} strokeWidth={ICON_STROKE} aria-hidden />
      aún en juego
    </span>
  );
}

function Cifra({
  label,
  valor,
  /** Segunda magnitud del mismo hecho (el importe de un recuento, el crudo de
   *  un porcentaje). Nunca una comparación. */
  detalle,
  comparacion,
  destacada,
}: {
  label: string;
  valor: string;
  detalle?: string;
  comparacion?: React.ReactNode;
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
      </p>
      {detalle && <p className="text-[11px] tabular-nums text-[var(--color-muted)] mt-0.5">{detalle}</p>}
      {comparacion && <p className="mt-0.5">{comparacion}</p>}
    </div>
  );
}

/** Conversión de cohorte: el porcentaje SIEMPRE enseña su denominador y la
 *  parte que aún no ha decidido. Un número que muestra de dónde sale no puede
 *  mentir, y mientras la cohorte madura no se compara con nada. */
function ConversionCifra({
  label,
  c,
  unidad,
  destacada,
}: {
  label: string;
  c: ConversionCohorte;
  unidad: string;
  destacada?: boolean;
}) {
  const detalle =
    c.pct == null
      ? undefined
      : c.abiertos > 0
        ? `${c.aceptados} de ${c.presentados} · ${c.abiertos} aún sin decidir`
        : `${c.aceptados} de ${c.presentados}`;
  return (
    <Cifra
      label={label}
      valor={c.pct != null ? `${c.pct}%` : "—"}
      detalle={detalle}
      destacada={destacada}
      comparacion={
        c.pct == null || c.pctPrevio == null ? undefined : !c.comparable ? (
          <SinComparar abiertos={c.abiertos} total={c.presentados} unidad={unidad} />
        ) : (
          <Comparativa
            valor={c.pct}
            previo={c.pctPrevio}
            tipo="porcentaje"
            neutral={c.muestraCorta}
            titulo={
              c.muestraCorta
                ? `Muestra corta: ${c.presentados} ${unidad} este mes y ${c.presentadosPrevio} el anterior. El porcentaje se enseña, pero no se lee como señal.`
                : undefined
            }
          />
        )
      }
    />
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
type OrdenClinicas = "tendencia" | "conversion" | "aceptado" | "vencido";

const CAPTION_ORDEN: Record<OrdenClinicas, string> = {
  tendencia: "Ordenadas por evolución del € aceptado, de la mayor caída a la mayor subida.",
  conversion: "Ordenadas por conversión, de mayor a menor.",
  aceptado: "Ordenadas por € aceptado, de mayor a menor.",
  vencido: "Ordenadas por € vencido, de mayor a menor.",
};
/** Los dos órdenes derivados de un ratio mandan al final a las clínicas con
 *  pocos presupuestos: el pie tiene que decirlo o vuelve a mentir. */
const ORDENES_CON_MUESTRA_CORTA: OrdenClinicas[] = ["tendencia", "conversion"];

// Serie visible en la gráfica de progreso.
type SerieProgreso = "total" | "leads" | "presupuestos" | "cobros";
const SERIES: Array<[SerieProgreso, string, boolean]> = [
  // [clave, etiqueta, es dinero]
  ["total", "€ aceptado", true],
  ["leads", "Leads nuevos", false],
  ["presupuestos", "Presupuestos presentados", false],
  ["cobros", "€ cobrado", true],
];

export function RedView({ user: _user }: { user: UserSession }) {
  const router = useRouter();
  const { setSelectedClinicaId } = useClinic();
  const [data, setData] = useState<DashboardRed | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [orden, setOrden] = useState<OrdenClinicas>("tendencia");
  const [serie, setSerie] = useState<SerieProgreso>("total");

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
    // Los órdenes DERIVADOS de un ratio (caída y conversión) mandan al final a
    // las clínicas con muestra corta: un 100% salido de dos presupuestos no
    // puede encabezar el ranking. Los órdenes por importe absoluto no lo
    // necesitan — 4.200 € son 4.200 € vengan de dos casos o de veinte.
    const cortaAlFinal = (a: ClinicaFila, b: ClinicaFila) =>
      a.muestraCorta === b.muestraCorta ? 0 : a.muestraCorta ? 1 : -1;
    if (orden === "tendencia")
      filas.sort((a, b) => cortaAlFinal(a, b) || (a.tendenciaPct ?? Infinity) - (b.tendenciaPct ?? Infinity));
    if (orden === "conversion")
      filas.sort((a, b) => cortaAlFinal(a, b) || (b.conversionPct ?? -1) - (a.conversionPct ?? -1));
    if (orden === "aceptado") filas.sort((a, b) => b.aceptadoMes - a.aceptadoMes);
    if (orden === "vencido") filas.sort((a, b) => b.vencido - a.vencido);
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
  const serieDef = SERIES.find(([k]) => k === serie)!;
  const etiquetaSerie = serieDef[1];
  const esDinero = serieDef[2];

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
                `Riesgo hoy: ${hoy.riesgo.map((r) => `${r.titulo}: ${r.importe != null ? eur(r.importe) + " — " : ""}${r.detalle}`).join(" · ") || "nada"}`,
                `Funcionando: ${hoy.exitos.map((e) => `${e.titulo} (${e.dato}) — ${e.detalle}`).join(" · ") || "sin cambios destacables"}`,
                `Aceptado mes: ${eur(negocio.presupuestos.aceptadosImporteMes.valor)} (prev ${eur(negocio.presupuestos.aceptadosImporteMes.previo)})`,
                `Cobrado mes: ${eur(negocio.cobros.cobradoMes.valor)} · pendiente ${eur(negocio.cobros.pendiente)} · vencido ${eur(negocio.cobros.vencido)}`,
                // El Copilot recibe la MISMA lectura honesta que la pantalla:
                // si la cohorte del mes sigue abierta, no se le da un "cayó".
                `Conversión presupuestos: ${conv.pct ?? "—"}% (${conv.aceptados} de ${conv.presentados} presentados este mes` +
                  (conv.abiertos > 0 ? `, ${conv.abiertos} aún sin decidir` : "") +
                  `). ${
                    conv.comparable
                      ? `El mes anterior fue ${conv.pctPrevio ?? "—"}%.`
                      : "La cohorte de este mes todavía está madurando: no es comparable con el mes anterior."
                  }`,
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
                          {/* Dos niveles: titular (el qué) + detalle (contexto). */}
                          <p className="text-sm font-medium text-[var(--color-foreground)] mt-0.5">{r.titulo}</p>
                          <p className="text-xs text-[var(--color-muted)] mt-0.5">{r.detalle}</p>
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
                        <p className="text-sm font-medium text-[var(--color-foreground)] mt-0.5">{e.titulo}</p>
                        <p className="text-xs text-[var(--color-muted)] mt-0.5">{e.detalle}</p>
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
                    <Cifra
                      label="Nuevos este mes"
                      valor={String(negocio.leads.nuevosMes.valor)}
                      comparacion={<Comparativa valor={negocio.leads.nuevosMes.valor} previo={negocio.leads.nuevosMes.previo} tipo="numero" />}
                    />
                    {/* Misma definición de activo que /seguimiento y que la
                        cabecera del tablero (lib/leads/pipeline). */}
                    <Cifra label="Activos en seguimiento" valor={String(negocio.leads.enSeguimiento)} detalle="ahora mismo" />
                    <Cifra
                      label="Con cita este mes"
                      valor={String(negocio.leads.citadosMes.valor)}
                      comparacion={
                        <Comparativa
                          valor={negocio.leads.citadosMes.valor}
                          previo={negocio.leads.citadosMes.previo}
                          tipo="numero"
                          titulo="Citas agendadas dentro del mes, comparadas con el mes anterior completo (una cita se agenda por adelantado: aquí no se recorta el tramo)."
                        />
                      }
                    />
                    <ConversionCifra
                      label="De los leads del mes, ya convertidos"
                      c={negocio.leads.conversionMes}
                      unidad="leads"
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
                  {/* Cada comparación se refiere SIEMPRE al número grande de su
                      card. Antes dos cards gemelas comparaban cosas distintas
                      —una el recuento, otra el importe— sin que se notara. */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Cifra
                      label="Presentados este mes"
                      valor={String(negocio.presupuestos.presentadosMes.valor)}
                      detalle={eur(negocio.presupuestos.presentadosImporteMes.valor)}
                      comparacion={
                        <Comparativa
                          valor={negocio.presupuestos.presentadosMes.valor}
                          previo={negocio.presupuestos.presentadosMes.previo}
                          tipo="numero"
                        />
                      }
                    />
                    <Cifra
                      label="Aceptados este mes"
                      valor={eur(negocio.presupuestos.aceptadosImporteMes.valor)}
                      detalle={`${negocio.presupuestos.aceptadosMes.valor} presupuesto${negocio.presupuestos.aceptadosMes.valor === 1 ? "" : "s"}`}
                      comparacion={
                        <Comparativa
                          valor={negocio.presupuestos.aceptadosImporteMes.valor}
                          previo={negocio.presupuestos.aceptadosImporteMes.previo}
                          tipo="dinero"
                        />
                      }
                    />
                    <Cifra
                      label="Perdidos este mes"
                      valor={String(negocio.presupuestos.perdidosMes.valor)}
                      detalle={eur(negocio.presupuestos.perdidosImporteMes.valor)}
                      comparacion={
                        <Comparativa
                          valor={negocio.presupuestos.perdidosMes.valor}
                          previo={negocio.presupuestos.perdidosMes.previo}
                          tipo="numero"
                          subirEsMalo
                        />
                      }
                    />
                    <ConversionCifra
                      label="De los presentados, ya aceptados"
                      c={conv}
                      unidad="presupuestos"
                      destacada
                    />
                  </div>
                </div>
                <div className="border-l-2 border-[var(--color-accent)] pl-4 lg:pl-5">
                  <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-3">Cobros</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Cifra
                      label="Cobrado este mes"
                      valor={eur(negocio.cobros.cobradoMes.valor)}
                      comparacion={
                        <Comparativa
                          valor={negocio.cobros.cobradoMes.valor}
                          previo={negocio.cobros.cobradoMes.previo}
                          tipo="dinero"
                        />
                      }
                    />
                    <Cifra label="Pendiente de cobro" valor={eur(negocio.cobros.pendiente)} detalle="firmado y sin cobrar" />
                    <Cifra label="Vencido sin cobrar" valor={eur(negocio.cobros.vencido)} detalle="fuera de plazo" />
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* ══ COLUMNA DERECHA (pendiente de rediseño tras el checkpoint) ══ */}
          <div className="lg:col-span-2 space-y-10">
        {/* ── 4 · TUS CLÍNICAS — orientada a evolución ── */}
        <section>
          <TituloSeccion icono={<Building2 size={20} strokeWidth={ICON_STROKE} aria-hidden />}>
            Tus clínicas
          </TituloSeccion>
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            {/* El pie describe el orden REAL: al reordenar por otra columna,
                "la que más cae va arriba" dejaba de ser cierto. */}
            <p className="px-5 pt-3 pb-2 text-[11px] text-[var(--color-muted)]">
              {CAPTION_ORDEN[orden]}{" "}
              {ORDENES_CON_MUESTRA_CORTA.includes(orden) && clinicasOrdenadas.some((c) => c.muestraCorta)
                ? "Las de pocos presupuestos van al final. "
                : ""}
              Comparadas con el mismo tramo del mes anterior — clic en una clínica para abrir su detalle.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left font-semibold px-5 py-2">Clínica</th>
                    {(
                      [
                        ["conversion", "Conversión", "De los presupuestos presentados este mes, cuántos ya se aceptaron."],
                        ["aceptado", "€ aceptado", "Importe firmado en el mismo tramo del mes."],
                        ["vencido", "€ vencido", "Importe firmado que ya superó su plazo de pago."],
                        ["tendencia", "Evolución €", "Cambio del € aceptado frente al mismo tramo del mes anterior."],
                      ] as Array<[OrdenClinicas, string, string]>
                    ).map(([k, l, ayuda]) => (
                      <th key={k} className="text-right font-semibold px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setOrden(k)}
                          title={ayuda}
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
                        <td className="px-5 py-3 font-semibold text-[var(--color-foreground)]">{c.nombre}</td>
                        {/* El VALOR manda y la referencia va debajo, en las
                            mismas unidades. Fuera los "pts": eran una tercera
                            gramática de delta en la misma pantalla. */}
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span
                            className={`font-semibold ${c.muestraCorta ? "text-[var(--color-muted)]" : "text-[var(--color-foreground)]"}`}
                            title={
                              c.muestraCorta
                                ? `Muestra corta: ${c.presentadosMes} presupuesto${c.presentadosMes === 1 ? "" : "s"} este mes y ${c.presentadosMesPrevio} el anterior. El porcentaje se enseña, pero no se lee como señal.`
                                : undefined
                            }
                          >
                            {c.conversionPct != null ? `${c.conversionPct}%` : "—"}
                          </span>
                          <span className="block text-[10px] text-[var(--color-muted)]">
                            {c.muestraCorta
                              ? `${c.aceptadosMes} de ${c.presentadosMes}`
                              : c.conversionPctPrevio != null
                                ? `era ${c.conversionPctPrevio}%`
                                : "sin referencia"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className="font-semibold text-[var(--color-foreground)]">{eur(c.aceptadoMes)}</span>
                          <span className="block text-[10px] text-[var(--color-muted)]">
                            {c.aceptadoMesPrevio > 0 ? `eran ${eur(c.aceptadoMesPrevio)}` : "sin referencia"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {c.vencido > 0 ? (
                            <span className="font-semibold text-[var(--color-danger)]">{eur(c.vencido)}</span>
                          ) : (
                            <span className="text-[var(--color-muted)]">—</span>
                          )}
                        </td>
                        {/* Δ% de un IMPORTE (no de un porcentaje): comparación
                            legítima y la clave del orden por defecto. Con
                            muestra corta se pinta neutra, no como señal. */}
                        <td className="px-3 py-3 text-right">
                          {c.tendenciaPct == null ? (
                            <span className="text-[var(--color-muted)]" title="El mes anterior no firmó presupuestos: no hay con qué comparar">—</span>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
                                c.muestraCorta || c.tendenciaPct === 0
                                  ? "text-[var(--color-muted)]"
                                  : c.tendenciaPct < 0
                                    ? "text-[var(--color-danger)]"
                                    : "text-[var(--color-success)]"
                              }`}
                              title={
                                c.muestraCorta
                                  ? "Pocos presupuestos en juego: la evolución se enseña, pero no ordena el ranking."
                                  : "Cambio del € aceptado frente al mismo tramo del mes anterior."
                              }
                            >
                              {/* Con muestra corta no se pinta flecha: un icono
                                  de dirección junto a un "-30%" ya con signo se
                                  leía como dos símbolos peleándose. */}
                              {c.muestraCorta ? null : c.tendenciaPct === 0 ? (
                                <Minus size={12} strokeWidth={ICON_STROKE} aria-hidden />
                              ) : c.tendenciaPct < 0 ? (
                                <TrendingDown size={12} strokeWidth={ICON_STROKE} aria-hidden />
                              ) : (
                                <TrendingUp size={12} strokeWidth={ICON_STROKE} aria-hidden />
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
                        No tienes clínicas asignadas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── 5 · PROGRESO — área con degradado + toggles ── */}
        <section>
          <TituloSeccion icono={<Activity size={20} strokeWidth={ICON_STROKE} aria-hidden />}>
            Progreso
          </TituloSeccion>
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <p className="text-[11px] text-[var(--color-muted)]">
                Evolución mensual de los últimos 6 meses.
              </p>
              <div className="flex gap-1 flex-wrap">
                {SERIES.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSerie(k)}
                    className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                      serie === k
                        ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-transparent"
                        : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={progreso.map((p) => ({ ...p, label: mesLabel(p.mes) }))}
                  margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="degradadoProgreso" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                    axisLine={{ stroke: "var(--color-border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                    tickFormatter={(v: number) =>
                      esDinero ? (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)) : String(v)
                    }
                    axisLine={false}
                    tickLine={false}
                    width={34}
                  />
                  <Tooltip
                    formatter={(v) => [esDinero ? eur(Number(v)) : String(v), etiquetaSerie]}
                    contentStyle={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                      color: "var(--color-foreground)",
                    }}
                    cursor={{ stroke: "var(--color-border)" }}
                  />
                  <Area
                    type="monotone"
                    dataKey={serie}
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    fill="url(#degradadoProgreso)"
                    dot={{ r: 2.5, fill: "var(--color-accent)", strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}
