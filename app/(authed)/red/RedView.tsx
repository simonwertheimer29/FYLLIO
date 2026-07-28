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
import Link from "next/link";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { UserSession } from "../../lib/presupuestos/types";
import type {
  DashboardRed,
  ConversionCohorte,
  ClinicaFila,
  EmbudoEtapa,
} from "../../lib/dashboard-red";
import { useClinic } from "../../lib/context/ClinicContext";
import { openCopilot } from "../../components/copilot/openCopilot";
import { ErrorState } from "../../components/ui/Feedback";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { ColaTabs } from "../../components/shared/ColaTabs";
import { Cifra, Comparativa, eur } from "../../components/shared/Cifra";
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
  Filter,
  ICON_STROKE,
} from "../../components/icons";

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (yyyyMm: string) => {
  const m = Number(yyyyMm.slice(5, 7));
  return `${MESES_CORTOS[m - 1] ?? yyyyMm} ${yyyyMm.slice(2, 4)}`;
};

/** Comparación imposible todavía: la cohorte del mes sigue decidiéndose.
 *  Vive aquí y no en el módulo compartido porque es propio de la conversión
 *  por cohorte de este dashboard. */
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
  resumen,
  children,
}: {
  icono: React.ReactNode;
  /** Titular-resumen discreto a la derecha (Σ€ · nº clínicas). Acompaña al
   *  título; nunca compite con él. */
  resumen?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3">
      <h2 className="flex items-center gap-2.5 font-display text-lg lg:text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
        <span className="text-[var(--color-muted)] self-center">{icono}</span>
        {children}
      </h2>
      {resumen && <p className="text-xs text-[var(--color-muted)] tabular-nums">{resumen}</p>}
    </div>
  );
}

// ─── Señales de la franja (riesgo · logros) ─────────────────────────────
//
// Anatomía única: número · titular · contexto en UN renglón visual, card
// horizontal y baja. Dos pesos como máximo por franja: la destacada y el
// resto, uniforme. No hay un tercer tamaño.

type TonoSenal = "riesgo" | "exito";

const COLOR_TONO: Record<TonoSenal, string> = {
  riesgo: "var(--color-danger)",
  exito: "var(--color-success)",
};
const FONDO_TONO: Record<TonoSenal, string> = {
  riesgo: "var(--color-danger-soft)",
  exito: "var(--color-success-soft)",
};

/** Cuenta los cambios REALES del valor entre cargas (nunca dispara al montar).
 *  Se usa como `key` del nodo para re-lanzar el destello: el movimiento señala
 *  que ese dato cambió, no decora.
 *
 *  Ajuste de estado en render — el patrón oficial de React para "reaccionar a
 *  que una prop cambió" sin useEffect (no provoca render en cascada: React
 *  reintenta el mismo componente antes de pintar). */
function useDestello(valor: string): number {
  const [previo, setPrevio] = useState(valor);
  const [cambios, setCambios] = useState(0);
  if (previo !== valor) {
    setPrevio(valor);
    setCambios((c) => c + 1);
  }
  return cambios;
}

function SenalCard({
  tono,
  destacada,
  valor,
  titulo,
  detalle,
  href,
  etiqueta,
}: {
  tono: TonoSenal;
  destacada?: boolean;
  valor: string;
  titulo: string;
  detalle: string;
  href?: string;
  /** Chip que explica POR QUÉ esta card destaca. */
  etiqueta?: string;
}) {
  const cambios = useDestello(valor);
  const color = COLOR_TONO[tono];

  const cuerpo = (
    <Card
      padding="none"
      interactive={!!href}
      className={`relative h-full overflow-hidden ${
        destacada ? "flex items-center gap-4 pl-5 pr-4 py-3.5" : "block pl-4 pr-3 py-3"
      } ${destacada ? "fyllio-pulso-unico" : ""}`}
      style={
        destacada
          ? ({ ["--pulso-color" as string]: color } as React.CSSProperties)
          : undefined
      }
    >
      {/* Borde semántico en TODAS las cards, no solo en la destacada: el resto
          eran blancas y no se leían como parte de su categoría. La superficie
          sigue limpia — el color de bloque lo pone el tinte de la franja. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 ${destacada ? "w-1.5" : "w-1"}`}
        style={{ background: color }}
      />
      <p
        key={cambios}
        className={`font-display font-bold tabular-nums shrink-0 ${
          destacada ? "text-3xl" : "text-xl"
        } ${cambios > 0 ? "fyllio-destello rounded-md" : ""}`}
        style={{ color }}
      >
        {valor}
      </p>
      <div className={destacada ? "min-w-0 flex-1" : "min-w-0 mt-0.5"}>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-[var(--color-foreground)]">{titulo}</p>
          {etiqueta && (
            <span
              className="text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5"
              style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
            >
              {etiqueta}
            </span>
          )}
        </div>
        <p className={`text-xs text-[var(--color-muted)] mt-0.5 ${destacada ? "" : "line-clamp-2"}`}>
          {detalle}
        </p>
      </div>
      {href && destacada && (
        <ChevronRight
          size={16}
          strokeWidth={ICON_STROKE}
          className="text-[var(--color-muted)] shrink-0"
          aria-hidden
        />
      )}
    </Card>
  );

  if (!href) return cuerpo;
  return (
    <Link href={href} className="block h-full rounded-xl focus-visible:outline-none">
      {cuerpo}
    </Link>
  );
}

/** Franja de señales: bloque con el tinte de su categoría, cabecera con el
 *  resumen, destacada arriba y secundarias uniformes en rejilla. */
function FranjaSenales({
  tono,
  icono,
  titulo,
  resumen,
  columnas,
  vacio,
  items,
}: {
  tono: TonoSenal;
  icono: React.ReactNode;
  titulo: string;
  resumen?: React.ReactNode;
  /** Columnas de la rejilla de secundarias. */
  columnas: string;
  vacio: React.ReactNode;
  items: Array<{ clave: string; valor: string; titulo: string; detalle: string; href?: string }>;
}) {
  const color = COLOR_TONO[tono];
  return (
    <section
      className="rounded-2xl p-3 sm:p-4 h-full"
      style={{
        background: FONDO_TONO[tono],
        border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
      }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap px-1 mb-2.5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold tracking-tight text-[var(--color-foreground)]">
          <span style={{ color }} className="self-center">
            {icono}
          </span>
          {titulo}
        </h2>
        {resumen && <p className="text-xs text-[var(--color-muted)] tabular-nums">{resumen}</p>}
      </div>
      {items.length === 0 ? (
        <Card padding="none" className="px-4 py-3">
          {vacio}
        </Card>
      ) : (
        <div className="space-y-2">
          <SenalCard
            tono={tono}
            destacada
            etiqueta={tono === "riesgo" ? "lo más urgente" : "lo que más suma"}
            valor={items[0].valor}
            titulo={items[0].titulo}
            detalle={items[0].detalle}
            href={items[0].href}
          />
          {items.length > 1 && (
            <div className={`grid gap-2 ${columnas}`}>
              {items.slice(1).map((s) => (
                <SenalCard
                  key={s.clave}
                  tono={tono}
                  valor={s.valor}
                  titulo={s.titulo}
                  detalle={s.detalle}
                  href={s.href}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Embudo de conversión ───────────────────────────────────────────────
//
// Cuenta la promesa del producto: dónde se pierde la gente entre que pregunta
// y que firma. Cada etapa es un subconjunto de la anterior, así que las barras
// solo pueden encoger. El acento único pinta las barras; la caída va en gris,
// no en rojo: un embudo SIEMPRE baja, y pintarlo de alarma sería ruido.
function Embudo({ etapas, meses }: { etapas: EmbudoEtapa[]; meses: number }) {
  const base = etapas[0]?.n ?? 0;
  return (
    <div className="space-y-1">
      {etapas.map((e, i) => {
        // Suelo del 1,5% solo para que una etapa con casos no desaparezca del
        // todo; por encima de eso el ancho es proporcional y fiel.
        const ancho = base > 0 ? Math.max((e.n / base) * 100, e.n > 0 ? 1.5 : 0) : 0;
        return (
          <div key={e.clave}>
            {i > 0 && (
              <p className="flex items-center gap-1.5 pl-1 py-1 text-[11px] text-[var(--color-muted)] tabular-nums">
                <TrendingDown size={11} strokeWidth={ICON_STROKE} aria-hidden />
                {e.siguePct == null
                  ? "sin datos de la etapa anterior"
                  : `sigue el ${e.siguePct}% · se pierde el ${100 - e.siguePct}%`}
              </p>
            )}
            {/* La barra es un RELLENO de fondo sobre una pista a ancho
                completo, no una caja que contenga el texto. Con el texto
                dentro hacía falta un ancho mínimo para que se leyera, y ese
                mínimo igualaba visualmente 35 y 7 — la barra desmentía a su
                propio número. Así el ancho es fiel y el texto siempre legible. */}
            <div className="relative rounded-lg overflow-hidden bg-[var(--color-surface-muted)] px-3 py-2">
              <span
                aria-hidden
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${ancho}%`,
                  background: "color-mix(in srgb, var(--color-accent) 28%, transparent)",
                }}
              />
              <div className="relative">
                <p className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-display text-lg font-bold tabular-nums text-[var(--color-foreground)]">
                    {e.n.toLocaleString("es-ES")}
                  </span>
                  <span className="text-xs font-medium text-[var(--color-foreground)]">{e.etiqueta}</span>
                </p>
                <p className="text-[11px] text-[var(--color-muted)]">{e.detalle}</p>
              </div>
            </div>
          </div>
        );
      })}
      <p className="pt-2 text-[11px] text-[var(--color-muted)]">
        Sobre los {base.toLocaleString("es-ES")} leads captados en los últimos {meses} meses, seguidos
        uno a uno hasta donde llegaron. No incluye pacientes que llegaron sin pasar por un lead.
      </p>
    </div>
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

/** Textos de una fila de clínica. Los comparten la tabla (escritorio) y la
 *  lista apilada (móvil): una sola redacción, dos disposiciones. */
function celdasClinica(c: ClinicaFila) {
  return {
    conversion: c.conversionPct != null ? `${c.conversionPct}%` : "—",
    conversionRef: c.muestraCorta
      ? `${c.aceptadosMes} de ${c.presentadosMes}`
      : c.conversionPctPrevio != null
        ? `era ${c.conversionPctPrevio}%`
        : "sin referencia",
    aceptado: eur(c.aceptadoMes),
    aceptadoRef: c.aceptadoMesPrevio > 0 ? `eran ${eur(c.aceptadoMesPrevio)}` : "sin referencia",
    tituloMuestraCorta: c.muestraCorta
      ? `Muestra corta: ${c.presentadosMes} presupuesto${c.presentadosMes === 1 ? "" : "s"} este mes y ${c.presentadosMesPrevio} el anterior. El porcentaje se enseña, pero no se lee como señal.`
      : undefined,
  };
}

/** Evolución del € aceptado: mismo tratamiento en tabla y en móvil. */
function EvolucionClinica({ c }: { c: ClinicaFila }) {
  if (c.tendenciaPct == null) {
    return (
      <span className="text-[var(--color-muted)]" title="El mes anterior no firmó presupuestos: no hay con qué comparar">
        —
      </span>
    );
  }
  const neutra = c.muestraCorta || c.tendenciaPct === 0;
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
        neutra
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
      {/* Con muestra corta no se pinta flecha: un icono de dirección junto a un
          "-30%" ya con signo se leía como dos símbolos peleándose. */}
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
  );
}

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
  // /red SIGUE AL SELECTOR GLOBAL (decisión 2026-07-27). Antes lo ignoraba: el
  // manager cambiaba de clínica y la pantalla no se inmutaba, mientras su
  // propia tabla usaba ese mismo selector para "abrir el detalle".
  const { selectedClinicaId, selectedClinicaNombre, isHydrated, setSelectedClinicaId } = useClinic();
  const [data, setData] = useState<DashboardRed | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [orden, setOrden] = useState<OrdenClinicas>("tendencia");
  const [serie, setSerie] = useState<SerieProgreso>("total");

  const load = useCallback(() => {
    setLoadError(false);
    const qs = selectedClinicaId ? `?clinica=${encodeURIComponent(selectedClinicaId)}` : "";
    fetch(`/api/red/dashboard${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      // No se vacía `data` al recargar: la pantalla no parpadea a esqueleto al
      // cambiar de clínica, y así el destello puede señalar QUÉ cifra cambió.
      .then((d) => setData(d))
      .catch(() => setLoadError(true));
  }, [selectedClinicaId]);
  useEffect(() => {
    // Esperar a la hidratación del contexto: antes de ella selectedClinicaId es
    // null y se pediría la red entera para descartarla al instante siguiente.
    if (!isHydrated) return;
    load();
  }, [load, isHydrated]);

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
    // Clic en una clínica = filtrar el dashboard a ella (y con él, el resto
    // del producto, porque es el selector global). Antes empujaba a /kpis: la
    // comparativa era un enlace de salida en vez de navegación de la pantalla.
    setSelectedClinicaId(c.id);
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
    // La pantalla mantiene su forma mientras carga: las cuatro filas del
    // layout real, con el primitivo Skeleton (shimmer compartido).
    return (
      <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)]">
        <div className="max-w-screen-2xl mx-auto p-4 lg:p-8 space-y-8">
          <Skeleton className="h-8 w-40 rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Skeleton className="h-[220px] lg:col-span-3 rounded-2xl" />
            <Skeleton className="h-[220px] lg:col-span-2 rounded-2xl" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">
            <Skeleton className="h-72 lg:col-span-3 rounded-xl" />
            <Skeleton className="h-72 lg:col-span-2 rounded-xl" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const { hoy, negocio, progreso } = data;
  const conv = negocio.presupuestos.conversionMes;
  // Con una clínica seleccionada, "Tus clínicas" compararía una fila consigo
  // misma: se retira y "El negocio" ocupa la fila entera.
  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;
  const serieDef = SERIES.find(([k]) => k === serie)!;
  const etiquetaSerie = serieDef[1];
  const esDinero = serieDef[2];

  // El último punto es el MES EN CURSO: se pinta, pero punteado y etiquetado.
  // `cerrado` lleva los meses completos y `enCurso` el último tramo — solapan
  // en el penúltimo punto para que las dos líneas se unan sin hueco.
  const ultimo = progreso.length - 1;
  const datosProgreso = progreso.map((p, i) => ({
    ...p,
    label: mesLabel(p.mes) + (i === ultimo ? " · en curso" : ""),
    cerrado: i <= ultimo - 1 ? p[serie] : null,
    enCurso: i >= ultimo - 1 ? p[serie] : null,
  }));

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)]">
      <div className="max-w-screen-2xl mx-auto p-4 lg:p-8">
        <header className="flex items-start justify-between gap-3 flex-wrap mb-6">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
              {clinicaFiltrada ? selectedClinicaNombre : "Red"}
            </h1>
            {/* El titular refleja el ámbito: la pantalla no puede decir "Red"
                mientras enseña los números de una sola clínica. */}
            {clinicaFiltrada ? (
              <p className="text-xs text-[var(--color-muted)] mt-0.5 flex items-center gap-2 flex-wrap">
                Dónde pierde dinero esta clínica y cómo va su negocio
                <button
                  type="button"
                  onClick={() => setSelectedClinicaId(null)}
                  className="font-medium text-[var(--color-accent)] hover:underline"
                >
                  Ver toda la red
                </button>
              </p>
            ) : (
              <p className="text-xs text-[var(--color-muted)] mt-0.5">
                Dónde pierdes dinero, cómo va el negocio y qué clínica necesita atención
              </p>
            )}
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

        {/* Tres filas. En móvil, el mismo orden apilado: riesgo → logros →
            negocio → clínicas → evolución → embudo. */}
        <div className="space-y-8">
          {/* ══ FILA 1 · RIESGO (60%) · LOGROS (40%) ═════════════════════ */}
          {/* Sin items-start: los dos bloques igualan altura y la fila se lee
              como una sola pieza, no como dos cajas desalineadas. */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <FranjaSenales
                tono="riesgo"
                icono={<CircleDollarSign size={18} strokeWidth={ICON_STROKE} aria-hidden />}
                titulo="¿Dónde pierdes dinero hoy?"
                resumen={
                  hoy.riesgo.length > 0 ? (
                    <>
                      <span className="font-semibold text-[var(--color-foreground)]">
                        {eur(hoy.importeEnRiesgo)}
                      </span>{" "}
                      en riesgo
                      {/* Con una sola clínica en pantalla, "· 1 clínica" no
                          informa de nada. */}
                      {!clinicaFiltrada && (
                        <> · {hoy.clinicasEnRiesgo} clínica{hoy.clinicasEnRiesgo === 1 ? "" : "s"}</>
                      )}
                    </>
                  ) : undefined
                }
                columnas="sm:grid-cols-3"
                vacio={
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2
                      size={18}
                      strokeWidth={ICON_STROKE}
                      className="text-[var(--color-success)] shrink-0"
                      aria-hidden
                    />
                    <p className="text-sm font-semibold text-[var(--color-foreground)]">
                      Nada en riesgo hoy — las colas están al día.
                    </p>
                  </div>
                }
                // El orden lo fija el servidor por urgencia de ACCIÓN: la
                // primera es la destacada, no la de más importe.
                items={hoy.riesgo.map((r) => ({
                  clave: r.tipo,
                  valor: r.importe != null ? eur(r.importe) : String(r.n),
                  titulo: r.titulo,
                  detalle: r.detalle,
                  href: r.href,
                }))}
              />
            </div>
            <div className="lg:col-span-2">
              <FranjaSenales
                tono="exito"
                icono={<TrendingUp size={18} strokeWidth={ICON_STROKE} aria-hidden />}
                titulo="Qué está funcionando"
                columnas="sm:grid-cols-2"
                vacio={
                  <p className="text-sm text-[var(--color-muted)]">
                    Sin cambios destacables esta semana.
                  </p>
                }
                items={hoy.exitos.map((e) => ({
                  clave: e.tipo,
                  valor: e.dato,
                  titulo: e.titulo,
                  detalle: e.detalle,
                }))}
              />
            </div>
          </div>

          {/* ══ FILA 2 · EL NEGOCIO (60%) · TUS CLÍNICAS (40%) ═══════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8 items-start">
            <section className={clinicaFiltrada ? "lg:col-span-5" : "lg:col-span-3"}>
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

            {!clinicaFiltrada && (
            <section className="lg:col-span-2">
              <TituloSeccion icono={<Building2 size={20} strokeWidth={ICON_STROKE} aria-hidden />}>
                Tus clínicas
              </TituloSeccion>
              <Card padding="none" className="overflow-hidden">
            {/* El pie describe el orden REAL: al reordenar por otra columna,
                "la que más cae va arriba" dejaba de ser cierto. */}
            <p className="px-5 pt-3 pb-2 text-[11px] text-[var(--color-muted)]">
              {CAPTION_ORDEN[orden]}{" "}
              {ORDENES_CON_MUESTRA_CORTA.includes(orden) && clinicasOrdenadas.some((c) => c.muestraCorta)
                ? "Las de pocos presupuestos van al final. "
                : ""}
              Comparadas con el mismo tramo del mes anterior — clic en una clínica para filtrar el
              dashboard a ella.
            </p>
            {/* Móvil: la misma información apilada. Una tabla de 5 columnas en
                390px recortaba la última sin aviso — y aquí no sobra ninguna. */}
            <ul className="sm:hidden border-t border-[var(--color-border)]">
              {clinicasOrdenadas.map((c) => {
                const t = celdasClinica(c);
                return (
                  <li key={c.id} className="border-b border-[var(--color-border)] last:border-0">
                    <button
                      type="button"
                      onClick={() => irAClinica(c)}
                      className="w-full text-left px-5 py-3 hover:bg-[var(--color-surface-muted)] transition-colors"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-semibold text-[var(--color-foreground)]">{c.nombre}</p>
                        <span className="text-xs shrink-0">
                          <EvolucionClinica c={c} />
                        </span>
                      </div>
                      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums">
                        <div className="flex items-baseline gap-1.5">
                          <dt className="text-[var(--color-muted)]">Conversión</dt>
                          <dd
                            className={c.muestraCorta ? "text-[var(--color-muted)]" : "font-semibold text-[var(--color-foreground)]"}
                            title={t.tituloMuestraCorta}
                          >
                            {t.conversion} <span className="text-[10px] text-[var(--color-muted)] font-normal">{t.conversionRef}</span>
                          </dd>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <dt className="text-[var(--color-muted)]">Aceptado</dt>
                          <dd className="font-semibold text-[var(--color-foreground)]">
                            {t.aceptado} <span className="text-[10px] text-[var(--color-muted)] font-normal">{t.aceptadoRef}</span>
                          </dd>
                        </div>
                        {c.vencido > 0 && (
                          <div className="flex items-baseline gap-1.5">
                            <dt className="text-[var(--color-muted)]">Vencido</dt>
                            <dd className="font-semibold text-[var(--color-danger)]">{eur(c.vencido)}</dd>
                          </div>
                        )}
                      </dl>
                    </button>
                  </li>
                );
              })}
              {clinicasOrdenadas.length === 0 && (
                <li className="px-5 py-6 text-center text-xs text-[var(--color-muted)]">
                  No tienes clínicas asignadas.
                </li>
              )}
            </ul>
            <div className="hidden sm:block overflow-x-auto">
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
                  {clinicasOrdenadas.map((c) => {
                    const t = celdasClinica(c);
                    return (
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
                            title={t.tituloMuestraCorta}
                          >
                            {t.conversion}
                          </span>
                          <span className="block text-[10px] text-[var(--color-muted)]">{t.conversionRef}</span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className="font-semibold text-[var(--color-foreground)]">{t.aceptado}</span>
                          <span className="block text-[10px] text-[var(--color-muted)]">{t.aceptadoRef}</span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {c.vencido > 0 ? (
                            <span className="font-semibold text-[var(--color-danger)]">{eur(c.vencido)}</span>
                          ) : (
                            <span className="text-[var(--color-muted)]">—</span>
                          )}
                        </td>
                        {/* Δ% de un IMPORTE (no de un porcentaje): comparación
                            legítima y la clave del orden por defecto. */}
                        <td className="px-3 py-3 text-right">
                          <EvolucionClinica c={c} />
                        </td>
                      </tr>
                    );
                  })}
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
              </Card>
            </section>
            )}
          </div>

          {/* ══ FILA 3 · EVOLUCIÓN (izq) · EMBUDO (der) ══════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
          <section>
            <TituloSeccion icono={<Activity size={20} strokeWidth={ICON_STROKE} aria-hidden />}>
              Progreso
            </TituloSeccion>
            <Card padding="none" className="p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <p className="text-[11px] text-[var(--color-muted)]">
                Evolución mensual de los últimos 6 meses. El mes en curso va punteado: todavía no ha
                terminado, así que su punto no es comparable con los anteriores.
              </p>
              {/* ColaTabs: el mismo primitivo de pills que filtra las colas —
                  aquí elige la serie. Antes eran pills a medida casi iguales. */}
              <ColaTabs
                tabs={SERIES.map(([k, l]) => ({ id: k, label: l }))}
                active={serie}
                onChange={setSerie}
              />
            </div>
            <div className="h-72 lg:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={datosProgreso}
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
                    filterNull
                    contentStyle={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                      color: "var(--color-foreground)",
                    }}
                    cursor={{ stroke: "var(--color-border)" }}
                  />
                  {/* Dos áreas con el MISMO juego de puntos que su trazo: si el
                      relleno llevara la serie completa y el trazo solo los
                      meses cerrados, las dos curvas `monotone` se calcularían
                      sobre conjuntos distintos y se separarían a la vista. */}
                  <Area
                    type="monotone"
                    dataKey="cerrado"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    fill="url(#degradadoProgreso)"
                    dot={{ r: 2.5, fill: "var(--color-accent)", strokeWidth: 0 }}
                    activeDot={false}
                    connectNulls={false}
                    tooltipType="none"
                    isAnimationActive={false}
                  />
                  {/* Mes en curso: mismo color, trazo punteado y atenuado. Se
                      pinta —no se esconde— para que la tendencia siga leyéndose,
                      pero un mes a medias no puede parecer una caída. */}
                  <Area
                    type="monotone"
                    dataKey="enCurso"
                    stroke="var(--color-accent)"
                    strokeOpacity={0.55}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    fill="url(#degradadoProgreso)"
                    fillOpacity={0.55}
                    dot={{ r: 2.5, fill: "var(--color-accent)", fillOpacity: 0.55, strokeWidth: 0 }}
                    activeDot={false}
                    connectNulls={false}
                    tooltipType="none"
                    isAnimationActive={false}
                  />
                  {/* Serie invisible: da UN valor por mes al tooltip. Las dos
                      áreas se solapan en el mes de unión y, con el tooltip
                      puesto en ellas, ese punto saldría duplicado. */}
                  <Line
                    type="monotone"
                    dataKey={serie}
                    name={etiquetaSerie}
                    stroke="none"
                    dot={false}
                    activeDot={{ r: 4, fill: "var(--color-accent)", strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            </Card>
          </section>

          <section>
            <TituloSeccion icono={<Filter size={20} strokeWidth={ICON_STROKE} aria-hidden />}>
              Dónde se pierde la gente
            </TituloSeccion>
            <Card padding="none" className="p-5">
              <Embudo etapas={data.embudo.etapas} meses={data.embudo.meses} />
            </Card>
          </section>
          </div>
        </div>
      </div>
    </div>
  );
}
