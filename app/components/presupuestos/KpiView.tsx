"use client";

import { Fragment, useEffect, useState, useRef } from "react";
import type { TonosStats } from "../../api/presupuestos/tonos-stats/route";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { KpiData, UserSession } from "../../lib/presupuestos/types";
import {
  COLOR_OFRECIDO, COLOR_ACEPTADO, colorCategoria, pasoAcento,
} from "../shared/paleta-grafica";
import { Card } from "../ui/Card";
import { ErrorState } from "../ui/Feedback";
import { Info, Star, ChevronDown, ChevronRight, ICON_STROKE } from "../icons";
import { Comparativa, eur, type TipoCifra } from "../shared/Cifra";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { textoTasa, notaTasa, type TasaCierre } from "../../lib/presupuestos/tasa";
import { etiquetaTipoVisita } from "../../lib/presupuestos/tipo-visita";
import { type PeriodoKpi } from "../../lib/periodo";

/** El periodo dicho dentro de una frase, no como etiqueta de botón. */
const NOMBRE_EN_FRASE: Record<PeriodoKpi, string> = {
  hoy: "hoy",
  semana: "esta semana",
  mes: "este mes",
  mes_anterior: "el mes pasado",
  trimestre: "este trimestre",
};
import { ColaTabs } from "../shared/ColaTabs";

type SubTab = "general" | "tarifas" | "paciente" | "tratamientos" | "doctores" | "benchmark" | "ia";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "tarifas", label: "Tarifas" },
  { id: "paciente", label: "Tipo Paciente" },
  { id: "tratamientos", label: "Tratamientos" },
  { id: "doctores", label: "Doctores" },
  { id: "benchmark", label: "Comparativa" },
  { id: "ia", label: "Asistente IA" },
];



/** Color de una tasa. Sin decididos NO se juzga: gris, no rojo — "todavía no
 *  se sabe" y "va mal" son cosas distintas. (El umbral en sí sigue sin
 *  declararse en pantalla; eso es del bloque visual.) */
function colorTasa(t: TasaCierre): string {
  if (t.pct == null) return "text-[var(--color-muted)]";
  if (t.pct >= 50) return "text-[var(--color-success)]";
  if (t.pct >= 25) return "text-[var(--color-warning)]";
  return "text-[var(--color-danger)]";
}

// ─── Shared components ────────────────────────────────────────────────────────

function HeaderBlock({ title, main, sub1, sub2, highlight, tooltip }: {
  title: string; main: string; sub1?: string; sub2?: string; highlight?: boolean; tooltip?: string;
}) {
  return (
    <div className={`rounded-xl border p-5 ${highlight ? "border-[var(--color-border)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
      <p className="fyllio-label font-semibold text-[var(--color-muted)] mb-2 flex items-center gap-1">
        {title}
        {tooltip && (
          <span className="cursor-help text-[var(--color-muted)]" title={tooltip}>
            <Info size={12} strokeWidth={ICON_STROKE} aria-hidden />
          </span>
        )}
      </p>
      <p className={`font-display text-4xl font-bold tabular-nums leading-tight ${highlight ? "text-[var(--color-accent)]" : "text-[var(--color-foreground)]"}`}>{main}</p>
      {sub1 && <p className="text-xs text-[var(--color-muted)] mt-1.5">{sub1}</p>}
      {sub2 && <p className="text-xs text-[var(--color-muted)] mt-0.5">{sub2}</p>}
    </div>
  );
}

/**
 * La comparación de esta pantalla ES la del resto del producto.
 *
 * Aquí vivía `TrendBadge`, con las tres cosas que la gramática de `Cifra`
 * prohíbe a la vez: una flecha peleándose con el signo del número, la magnitud
 * seguida de un porcentaje entre paréntesis —«↑ 14% (19%)», un % de un %— y el
 * color atado al signo aritmético, que pinta de verde "+2 perdidos".
 */
function TrendBadge({
  curr,
  prev,
  tipo = "numero",
  subirEsMalo,
}: {
  curr: number;
  prev: number;
  tipo?: TipoCifra;
  subirEsMalo?: boolean;
}) {
  if (prev === 0 && curr === 0) return <span className="text-xs text-[var(--color-muted)]">—</span>;
  return <Comparativa valor={curr} previo={prev} tipo={tipo} subirEsMalo={subirEsMalo} />;
}

const TOOLTIP_STYLE = {
  borderRadius: "12px", border: "1px solid var(--color-border)",
  background: "var(--color-surface)", color: "var(--color-foreground)",
  fontSize: "12px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
};

// ─── Tab: General ─────────────────────────────────────────────────────────────

function TabGeneral({ kpisMes, kpisPrevMes, kpis, mesLabel }: {
  kpisMes: KpiData; kpisPrevMes: KpiData; kpis: KpiData; mesLabel: string;
}) {
  const { resumen } = kpisMes;
  const prevRes = kpisPrevMes.resumen;
  const ytd = kpis.comparacion.anio.actual;
  const ytdPrev = kpis.comparacion.anio.anterior;

  return (
    <div className="space-y-5">
      {/* Header blocks — datos del mes seleccionado */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <HeaderBlock
          title={`Presupuestos · ${mesLabel}`}
          main={String(resumen.total)}
          sub1={`1ª Visita: ${resumen.primeraVisita} · Con historial: ${resumen.conHistoria}`}
          sub2={resumen.total === 0 ? "Sin presupuestos este mes" : undefined}
        />
        <HeaderBlock
          title="Aceptados"
          main={String(resumen.aceptados)}
          sub1={`${textoTasa(resumen.tasa)} del € presentado se aceptó · ${notaTasa(resumen.tasa, `en ${mesLabel}`)}`}
          sub2={`vs mes anterior: ${prevRes.aceptados}`}
          tooltip="Del importe presentado en el mes elegido, qué parte ya se aceptó. Los que siguen abiertos entran en el denominador y se dicen aparte («aún sin decidir»): un presupuesto grande abierto baja la tasa hasta que se decide. Antes se medía por número y sobre decididos, que inflaba."
        />
        <HeaderBlock
          title="Presupuestos en seguimiento"
          main={eur(resumen.importeActivos)}
          sub1="Interesado + En Duda + En Negociación"
          tooltip="Presupuestos activos en etapas Interesado, En Duda o En Negociación"
        />
        <HeaderBlock
          title={`Este año (${new Date().getFullYear()})`}
          main={String(ytd)}
          highlight
          sub1={`${kpis.comparacion.anio.actual} presupuestos YTD`}
          sub2={ytdPrev > 0 ? `vs año anterior: ${ytdPrev}` : undefined}
        />
      </div>

      {/* Comparación vs mes anterior */}
      <Card>
        <p className="text-xs font-bold text-[var(--color-foreground)] mb-3">
          Comparación · {mesLabel}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Presupuestos", curr: resumen.total, prev: prevRes.total },
            { label: "Aceptados", curr: resumen.aceptados, prev: prevRes.aceptados },
            // Sin decididos no hay tasa que comparar: se enseña "—" y no se
            // fabrica un 0% que se leería como "no cerró ninguno".
            {
              label: "€ aceptado / presentado",
              curr: resumen.tasa.pct,
              prev: prevRes.tasa.pct,
              unit: "%",
            },
            { label: "En juego €", curr: resumen.importeActivos, prev: prevRes.importeActivos, unit: "€" },
          ].map(({ label, curr, prev, unit }) => (
            <div key={label}>
              <p className="text-[10px] text-[var(--color-muted)] font-medium mb-1">{label}</p>
              <p className="font-display text-lg font-bold tabular-nums text-[var(--color-foreground)]">
                {curr == null ? "—" : unit === "€" ? eur(curr) : `${curr}${unit ?? ""}`}
              </p>
              {curr != null && prev != null && (
                <TrendBadge curr={curr} prev={prev} tipo={unit === "€" ? "dinero" : unit === "%" ? "porcentaje" : "numero"} />
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* AreaChart — evolución 12 meses */}
      <Card padding="none" className="p-5">
        <p className="text-sm font-bold text-[var(--color-foreground)] mb-1">Evolución mensual (12 meses)</p>
        <p className="text-xs text-[var(--color-muted)] mb-4">Azul = presupuestos ofrecidos · Verde = aceptados</p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={kpis.tendenciaMensual} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLOR_OFRECIDO} stopOpacity={0.18} />
                <stop offset="95%" stopColor={COLOR_OFRECIDO} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLOR_ACEPTADO} stopOpacity={0.22} />
                <stop offset="95%" stopColor={COLOR_ACEPTADO} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" strokeOpacity={0.5} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 700 }} />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            <Area type="monotone" dataKey="total" name="Ofrecidos" stroke={COLOR_OFRECIDO} strokeWidth={2} fill="url(#g1)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="aceptados" name="Aceptados" stroke={COLOR_ACEPTADO} strokeWidth={2} fill="url(#g2)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ─── Tab: Tarifas ─────────────────────────────────────────────────────────────

function TabTarifas({ kpisMes, kpisPrevMes, kpis, mesLabel }: {
  kpisMes: KpiData; kpisPrevMes: KpiData; kpis: KpiData; mesLabel: string;
}) {
  // Una card por valor del CATÁLOGO, no dos escritas a mano. Antes esta
  // pestaña buscaba "Privado" y "Adeslas" literales; con el dato real diciendo
  // otra cosa llevaba enseñando 0 y 0 desde que existe (spec 2026-07-29).
  const tarifas = kpis.tarifas ?? [];
  const bloques = tarifas.map((tarifa) => ({
    tipo: tarifa,
    mes: kpisMes.porTipoPaciente.find((t) => t.tipo === tarifa),
    prev: kpisPrevMes.porTipoPaciente.find((t) => t.tipo === tarifa),
  }));

  return (
    <div className="space-y-5">
      {/* Bloques del mes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {bloques.map(({ tipo, mes, prev }) => (
          <div key={tipo} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <p className="text-[11px] font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">{tipo} — {mesLabel}</p>
            <p className="font-display text-3xl font-bold tabular-nums text-[var(--color-foreground)]">{mes?.total ?? 0}</p>
            <p className="text-xs text-[var(--color-muted)] mt-1">
              {mes?.aceptados ?? 0} aceptados · {mes ? `${textoTasa(mes.tasa)} del € presentado` : "—"}
            </p>
            {(mes?.importe ?? 0) > 0 && (
              <p className="text-xs font-semibold text-[var(--color-success)] mt-0.5">{eur((mes?.importe ?? 0))} aceptado</p>
            )}
            <div className="mt-2">
              <TrendBadge curr={mes?.total ?? 0} prev={prev?.total ?? 0} />
            </div>
          </div>
        ))}
      </div>

      {/* Evolución 12 meses — 4 barras: ofrecido/aceptado por tarifa */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <p className="text-sm font-bold text-[var(--color-foreground)] mb-1">Evolución mensual por tarifa (12 meses)</p>
        <p className="text-xs text-[var(--color-muted)] mb-4">Barras claras = ofrecidos · Barras oscuras = aceptados</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={kpis.tendenciaPorTarifa} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barGap={1} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" strokeOpacity={0.5} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            {/* Series dinámicas y colores DESDE EL TOKEN del acento: cada
                tarifa es un escalón de la misma familia (ofrecido translúcido,
                aceptado sólido). Antes eran cuatro hex a mano que además se
                rompían en oscuro. */}
            {tarifas.flatMap((tarifa, i) => {
              const mezcla = Math.max(30, 100 - i * 22);
              return [
                <Bar
                  key={`${tarifa}-of`}
                  dataKey={tarifa}
                  name={`${tarifa} ofrecido`}
                  fill={`color-mix(in srgb, var(--color-accent) ${Math.round(mezcla * 0.35)}%, transparent)`}
                  radius={[3, 3, 0, 0]}
                />,
                <Bar
                  key={`${tarifa}-ac`}
                  dataKey={`${tarifa}__acept`}
                  name={`${tarifa} aceptado`}
                  fill={`color-mix(in srgb, var(--color-accent) ${mezcla}%, transparent)`}
                  radius={[3, 3, 0, 0]}
                />,
              ];
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla resumen — todos los meses */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <p className="px-4 py-3 text-[11px] font-medium text-[var(--color-muted)] border-b border-[var(--color-border)] uppercase tracking-wider">Resumen por tarifa — {mesLabel}</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {["Tarifa", "Ofrecidos", "Aceptados", "Tasa conv.", "€ Aceptado", "vs mes ant."].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold text-[var(--color-muted)] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kpisMes.porTipoPaciente.map((t) => {
              const p = kpisPrevMes.porTipoPaciente.find((x) => x.tipo === t.tipo);
              return (
                <tr key={t.tipo} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-muted)]">
                  <td className="px-4 py-3 font-semibold text-[var(--color-foreground)]">{t.tipo}</td>
                  <td className="px-4 py-3 text-[var(--color-foreground)]">{t.total}</td>
                  <td className="px-4 py-3 font-semibold text-[var(--color-success)]">{t.aceptados}</td>
                  <td className="px-4 py-3 font-bold text-[var(--color-foreground)]" title={notaTasa(t.tasa)}>{textoTasa(t.tasa)}</td>
                  <td className="px-4 py-3 text-[var(--color-foreground)]">{eur(t.importe)}</td>
                  <td className="px-4 py-3"><TrendBadge curr={t.total} prev={p?.total ?? 0} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Tipo Paciente ───────────────────────────────────────────────────────

function TabPaciente({ kpisMes, kpisPrevMes, kpis, mesLabel }: {
  kpisMes: KpiData; kpisPrevMes: KpiData; kpis: KpiData; mesLabel: string;
}) {
  const tipoLabel = etiquetaTipoVisita;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {kpisMes.porTipoVisita.map((t) => {
          const prev = kpisPrevMes.porTipoVisita.find((x) => x.tipo === t.tipo);
          return (
            <div key={t.tipo} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="text-[11px] font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">{tipoLabel(t.tipo)} — {mesLabel}</p>
              <p className="font-display text-3xl font-bold tabular-nums text-[var(--color-foreground)]">{t.total}</p>
              <p className="text-xs text-[var(--color-muted)] mt-1">{t.aceptados} aceptados · {textoTasa(t.tasa)} del € presentado</p>
              {t.importe > 0 && <p className="text-xs font-semibold text-[var(--color-success)] mt-0.5">{eur(t.importe)} aceptado</p>}
              <div className="mt-2"><TrendBadge curr={t.total} prev={prev?.total ?? 0} /></div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <p className="text-sm font-bold text-[var(--color-foreground)] mb-1">Evolución mensual por tipo de paciente (12 meses)</p>
        <p className="text-xs text-[var(--color-muted)] mb-4">Azul = 1ª Visita (nuevos) · Turquesa = Con historial (recurrentes)</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={kpis.tendenciaPorVisita} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barGap={1} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" strokeOpacity={0.5} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            {/* Dos categorías (1ª visita / con historial) × dos estados
                (ofrecido / aceptado). La CATEGORÍA la lleva el paso de la escala
                y el ESTADO la intensidad: lo ofrecido en claro, lo aceptado en
                el mismo tono lleno. Antes eran cuatro azules-cianes a mano que
                en oscuro se comían entre ellos. */}
            <Bar dataKey="primera" name="1ª visita · ofrecidos" fill={pasoAcento(35)} radius={[3, 3, 0, 0]} />
            <Bar dataKey="primeraAcept" name="1ª visita · aceptados" fill={COLOR_OFRECIDO} radius={[3, 3, 0, 0]} />
            <Bar dataKey="historia" name="Ya eran pacientes · ofrecidos" fill="color-mix(in srgb, var(--color-success) 35%, var(--color-surface))" radius={[3, 3, 0, 0]} />
            <Bar dataKey="historiaAcept" name="Ya eran pacientes · aceptados" fill={COLOR_ACEPTADO} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <p className="px-4 py-3 text-[11px] font-medium text-[var(--color-muted)] border-b border-[var(--color-border)] uppercase tracking-wider">Resumen por tipo de paciente — {mesLabel}</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {["Tipo", "Ofrecidos", "Aceptados", "Tasa conv.", "€ Aceptado", "vs mes ant."].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold text-[var(--color-muted)] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kpisMes.porTipoVisita.map((t) => {
              const prev = kpisPrevMes.porTipoVisita.find((x) => x.tipo === t.tipo);
              return (
                <tr key={t.tipo} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-muted)]">
                  <td className="px-4 py-3 font-semibold text-[var(--color-foreground)]">{tipoLabel(t.tipo)}</td>
                  <td className="px-4 py-3 text-[var(--color-foreground)]">{t.total}</td>
                  <td className="px-4 py-3 font-semibold text-[var(--color-success)]">{t.aceptados}</td>
                  <td className="px-4 py-3 font-bold text-[var(--color-foreground)]" title={notaTasa(t.tasa)}>{textoTasa(t.tasa)}</td>
                  <td className="px-4 py-3 text-[var(--color-foreground)]">{eur(t.importe)}</td>
                  <td className="px-4 py-3"><TrendBadge curr={t.total} prev={prev?.total ?? 0} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Tratamientos ────────────────────────────────────────────────────────

const CONFIANZA_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  alta:  { bg: "bg-[var(--color-success-soft)] dark:bg-[var(--color-success)]/15", text: "text-[var(--color-success)]", label: "Alta confianza" },
  media: { bg: "bg-[var(--color-warning-soft)] dark:bg-[var(--color-warning)]/15",   text: "text-[var(--color-warning)]",   label: "Confianza media" },
  baja:  { bg: "bg-[var(--color-surface-muted)]",   text: "text-[var(--color-muted)]",   label: "Pocos datos" },
};

function TabTratamientos({ kpisMes, kpis, mesLabel }: { kpisMes: KpiData; kpis: KpiData; mesLabel: string }) {
  // Los gráficos necesitan el % plano; los que aún no tienen decididos no
  // pintan barra (recharts se salta el null) en vez de fingir un 0%.
  const serieTasa = <T extends { tasa: TasaCierre }>(filas: T[]) =>
    filas.map((f) => ({ ...f, tasaPct: f.tasa.pct }));
  const top8 = serieTasa(
    [...kpisMes.porTratamiento].sort((a, b) => (b.tasa.pct ?? -1) - (a.tasa.pct ?? -1)).slice(0, 8),
  );
  const top8HistAll = serieTasa(
    [...kpis.porTratamiento].sort((a, b) => (b.tasa.pct ?? -1) - (a.tasa.pct ?? -1)).slice(0, 8),
  );

  // Tratamientos con umbral de precio detectado (histórico — más datos)
  const tratConTecho = [...kpis.porTratamiento]
    .filter((t) => t.techoInfo != null)
    .sort((a, b) =>
      (b.techoInfo!.tasaBelow - b.techoInfo!.tasaAbove) -
      (a.techoInfo!.tasaBelow - a.techoInfo!.tasaAbove)
    );

  return (
    <div className="space-y-5">

      {/* Umbrales de precio detectados */}
      {tratConTecho.length > 0 && (
        <div className="rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-5">
          <p className="text-sm font-bold text-[var(--color-foreground)] mb-1">Umbrales de precio detectados</p>
          <p className="text-xs text-[var(--color-muted)] mb-4">
            Importe a partir del cual la tasa de aceptación cae significativamente para cada tratamiento.
          </p>
          <div className="space-y-4">
            {tratConTecho.map((t) => {
              const info = t.techoInfo!;
              const badge = CONFIANZA_BADGE[info.confianza] ?? CONFIANZA_BADGE.baja;
              const maxTasa = Math.max(info.tasaBelow, info.tasaAbove, 1);
              return (
                <div key={t.grupo} className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-warning)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-sm text-[var(--color-foreground)]">{t.grupo}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[var(--color-warning)]">
                        ~{eur(t.techoPrecio!)}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                  {/* Barra inferior al techo */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[var(--color-muted)] w-28 shrink-0">
                        ≤{eur(t.techoPrecio!)}
                      </span>
                      <div className="flex-1 h-5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--color-success)] rounded-full transition-all"
                          style={{ width: `${Math.round((info.tasaBelow / maxTasa) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-bold text-[var(--color-success)] w-8 text-right">
                        {info.tasaBelow}%
                      </span>
                    </div>
                    {/* Barra superior al techo */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[var(--color-muted)] w-28 shrink-0">
                        &gt;{eur(t.techoPrecio!)}
                      </span>
                      <div className="flex-1 h-5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--color-danger)] rounded-full transition-all"
                          style={{ width: `${Math.round((info.tasaAbove / maxTasa) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-bold text-[var(--color-danger)] w-8 text-right">
                        {info.tasaAbove}%
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--color-muted)] mt-2">
                    {info.sampleBelow + info.sampleAbove} presupuestos analizados
                    · de {info.tasaBelow}% a {info.tasaAbove}% de aceptación
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bar chart this month */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <p className="text-sm font-bold text-[var(--color-foreground)] mb-1">Top 8 tratamientos — tasa de conversión en {mesLabel}</p>
        <p className="text-xs text-[var(--color-muted)] mb-4">Ordenados de mayor a menor tasa de aceptación</p>
        {top8.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)] py-8 text-center">Sin datos para este mes</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={top8} layout="vertical" margin={{ top: 4, right: 40, left: 100, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" strokeOpacity={0.5} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} unit="%" />
              <YAxis type="category" dataKey="grupo" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={100} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, "Tasa"]} />
              <Bar dataKey="tasaPct" name="Tasa %" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table this month */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <p className="px-4 py-3 text-[11px] font-medium text-[var(--color-muted)] border-b border-[var(--color-border)] uppercase tracking-wider">Tratamientos — {mesLabel}</p>
        {kpisMes.porTratamiento.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--color-muted)]">Sin datos para este mes</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Tratamiento", "Ofrecidos", "Aceptados", "Tasa", "€ Aceptado", "Techo precio"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold text-[var(--color-muted)] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpisMes.porTratamiento.map((t) => {
                // Prefer historical techo (more data) over monthly
                const histT = kpis.porTratamiento.find((x) => x.grupo === t.grupo);
                const techo = histT?.techoPrecio ?? t.techoPrecio;
                return (
                  <tr key={t.grupo} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-muted)]">
                    <td className="px-4 py-3 font-medium text-[var(--color-foreground)]">{t.grupo}</td>
                    <td className="px-4 py-3 text-[var(--color-foreground)]">{t.total}</td>
                    <td className="px-4 py-3 font-semibold text-[var(--color-success)]">{t.aceptados}</td>
                    <td className="px-4 py-3 font-bold text-[var(--color-foreground)]" title={notaTasa(t.tasa)}>{textoTasa(t.tasa)}</td>
                    <td className="px-4 py-3 text-[var(--color-foreground)]">{eur(t.importe)}</td>
                    <td className="px-4 py-3">
                      {techo ? (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-warning-soft)] dark:bg-[var(--color-warning)]/15 text-[var(--color-warning)] cursor-default"
                          title="La tasa de conversión cae significativamente a partir de este importe"
                        >
                          ~{eur(techo)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Historical top 8 */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <p className="text-sm font-bold text-[var(--color-foreground)] mb-4">Top 8 tratamientos — histórico (todos los tiempos)</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={top8HistAll} layout="vertical" margin={{ top: 4, right: 40, left: 100, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" strokeOpacity={0.5} horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} unit="%" />
            <YAxis type="category" dataKey="grupo" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={100} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, "Tasa"]} />
            <Bar dataKey="tasaPct" name="Tasa %" fill={pasoAcento(70)} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Tab: Doctores ────────────────────────────────────────────────────────────

function TabDoctores({ kpisMes, kpisPrevMes, kpis, mesLabel }: {
  kpisMes: KpiData; kpisPrevMes: KpiData; kpis: KpiData; mesLabel: string;
}) {
  const [evolDoctor, setEvolDoctor] = useState<string | null>(null);
  const [evolData, setEvolData] = useState<KpiData | null>(null);
  const [evolError, setEvolError] = useState<string | null>(null);

  function downloadCsv() {
    const rows = [
      // El CSV declara su denominador igual que la pantalla: la tasa sin la
      // columna "decididos" al lado se vuelve a leer mal en cuanto sale de aquí.
      ["Doctor", "Especialidad", "Este mes", "Aceptados", "€ presentado", "€ aceptado", "€ sin decidir", "Tasa € aceptado/presentado", "vs prev mes"],
      ...kpisMes.porDoctor.map((d) => {
        const p = kpisPrevMes.porDoctor.find((x) => x.doctor === d.doctor);
        return [
          d.doctor, d.especialidad, d.total, d.aceptados,
          Math.round(d.tasa.presentadoEur), Math.round(d.tasa.aceptadoEur), Math.round(d.tasa.abiertosEur), textoTasa(d.tasa),
          (p ? d.total - p.total : 0),
        ];
      }),
    ];
    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "kpis_doctores.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function loadDoctorEvol(doctor: string) {
    if (evolDoctor === doctor) { setEvolDoctor(null); setEvolData(null); return; }
    try {
      const url = new URL("/api/presupuestos/kpis", location.href);
      url.searchParams.set("doctor", doctor);
      // Sin status ni error declarado, un fallo dejaba la evolución del doctor
      // en blanco sin decir nada (censo 2026-07-29).
      const d = await cargarJSON<{ kpis?: KpiData }>(url.toString());
      setEvolDoctor(doctor);
      setEvolData(d.kpis ?? null);
      setEvolError(null);
    } catch (e) {
      setEvolError(mensajeDeError(e));
    }
  }

  const prevMap = new Map(kpisPrevMes.porDoctor.map((d) => [d.doctor, d]));

  return (
    <div className="space-y-5">
      {/* Visual doctor cards — comparativa */}
      {kpisMes.porDoctor.length > 0 && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="text-sm font-bold text-[var(--color-foreground)] mb-1">Comparativa de doctores — {mesLabel}</p>
          <p className="text-xs text-[var(--color-muted)] mb-4">Ordenados por € aceptado sobre € presentado</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[...kpisMes.porDoctor].sort((a, b) => (b.tasa.pct ?? -1) - (a.tasa.pct ?? -1)).map((d) => {
              const prev = prevMap.get(d.doctor);
              return (
                // La tarjeta se teñía con un pastel por ESPECIALIDAD: cinco
                // colores de identidad que no decían nada del doctor y que en
                // oscuro eran cinco claros sobre fondo oscuro. La especialidad
                // ya se lee justo debajo, en texto.
                <div
                  key={d.doctor}
                  onClick={() => loadDoctorEvol(d.doctor)}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 cursor-pointer hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-1 mb-2">
                    <p className="text-xs font-bold text-[var(--color-foreground)] leading-tight">{d.doctor}</p>
                    {prev && <TrendBadge curr={d.total} prev={prev.total} />}
                  </div>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mb-3 inline-block bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
                    {d.especialidad}
                  </span>
                  {/* Tasa grande */}
                  <p className="font-display text-3xl font-bold tabular-nums text-[var(--color-foreground)] mt-1">{textoTasa(d.tasa)}</p>
                  <p className="text-[10px] text-[var(--color-muted)] mb-2">del € presentado · {notaTasa(d.tasa)}</p>
                  {/* Progress bar */}
                  <div className="w-full bg-[var(--color-border)] rounded-full h-1.5 mb-2">
                    <div
                      className="h-1.5 rounded-full bg-[var(--color-success)] transition-all"
                      style={{ width: `${d.tasa.pct ?? 0}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--color-muted)]">
                    {d.aceptados} aceptados / {d.total} totales
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabla comparativa */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-[var(--color-foreground)]">Tabla de doctores — {mesLabel}</p>
            <p className="text-[10px] text-[var(--color-muted)] mt-0.5">Clic en un doctor para ver su evolución</p>
          </div>
          <button onClick={downloadCsv} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">CSV</button>
        </div>
        {kpisMes.porDoctor.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--color-muted)]">Sin datos para este mes</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Doctor", "Especialidad", "Ofrecidos", "Aceptados", "Tasa", "vs mes ant."].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-[var(--color-muted)] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpisMes.porDoctor.map((d) => {
                const prev = prevMap.get(d.doctor);
                const isSelected = evolDoctor === d.doctor;
                return (
                  <Fragment key={d.doctor}>
                    <tr
                      onClick={() => loadDoctorEvol(d.doctor)}
                      className={`border-b border-[var(--color-border)] cursor-pointer transition-colors ${isSelected ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-surface-muted)]"}`}
                    >
                      <td className="px-3 py-2.5 font-medium text-[var(--color-foreground)] whitespace-nowrap">
                        <span className="mr-1 inline-flex align-middle text-[var(--color-muted)]" aria-hidden>
                          {isSelected
                            ? <ChevronDown size={12} strokeWidth={ICON_STROKE} />
                            : <ChevronRight size={12} strokeWidth={ICON_STROKE} />}
                        </span>
                        {d.doctor}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--color-muted)]">{d.especialidad}</td>
                      <td className="px-3 py-2.5 text-[var(--color-foreground)]">{d.total}</td>
                      <td className="px-3 py-2.5 font-semibold text-[var(--color-success)]">{d.aceptados}</td>
                      <td className="px-3 py-2.5 font-bold text-[var(--color-foreground)]" title={notaTasa(d.tasa)}>{textoTasa(d.tasa)}</td>
                      <td className="px-3 py-2.5"><TrendBadge curr={d.total} prev={prev?.total ?? 0} /></td>
                    </tr>
                    {isSelected && evolError && (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 text-xs text-[var(--color-danger)] border-b border-[var(--color-border)]">
                          {evolError}
                        </td>
                      </tr>
                    )}
                    {isSelected && evolData && (
                      <tr>
                        <td colSpan={6} className="px-4 py-4 bg-[var(--color-accent-soft)] border-b border-[var(--color-border)]">
                          <p className="text-xs font-bold text-[var(--color-accent)] mb-3">Evolución 12 meses — {d.doctor}</p>
                          <ResponsiveContainer width="100%" height={160}>
                            <AreaChart data={evolData.tendenciaMensual} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                              <defs>
                                <linearGradient id="gd1" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.15} />
                                  <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" strokeOpacity={0.5} />
                              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 9, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                              <Tooltip contentStyle={TOOLTIP_STYLE} />
                              <Area type="monotone" dataKey="total" name="Ofrecidos" stroke="var(--color-accent)" strokeWidth={2} fill="url(#gd1)" dot={false} />
                              <Area type="monotone" dataKey="aceptados" name="Aceptados" stroke={COLOR_ACEPTADO} strokeWidth={2} fill="none" dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Historical comparison table */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <p className="px-4 py-3 text-[11px] font-medium text-[var(--color-muted)] border-b border-[var(--color-border)] uppercase tracking-wider">Histórico total — todos los tiempos</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Doctor", "Especialidad", "Total", "1ª Visita", "Con historial", "Aceptados", "Tasa"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-[var(--color-muted)] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpis.porDoctor.map((d) => (
                <tr key={d.doctor} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-muted)]">
                  <td className="px-3 py-2.5 font-medium text-[var(--color-foreground)] whitespace-nowrap">{d.doctor}</td>
                  <td className="px-3 py-2.5 text-[var(--color-muted)]">{d.especialidad}</td>
                  <td className="px-3 py-2.5 text-[var(--color-foreground)]">{d.total}</td>
                  <td className="px-3 py-2.5 text-[var(--color-foreground)]">{d.primeraVisita}</td>
                  <td className="px-3 py-2.5 text-[var(--color-foreground)]">{d.conHistoria}</td>
                  <td className="px-3 py-2.5 font-semibold text-[var(--color-success)]">{d.aceptados}</td>
                  <td className="px-3 py-2.5 font-bold text-[var(--color-foreground)]" title={notaTasa(d.tasa)}>{textoTasa(d.tasa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Benchmark ───────────────────────────────────────────────────────────

// Aquí vivía `ORIGEN_COLORS`: siete hex sueltos que además eran SEMÁNTICOS
// (verde, ámbar, rojo) usados como identidad, así que un canal cualquiera salía
// pintado de rojo y se leía como una alerta. Ahora la escala categórica
// compartida — ver `shared/paleta-grafica`.

function TabBenchmark({ kpis, isManager }: { kpis: KpiData; isManager: boolean }) {
  const origenData = kpis.porOrigenLead ?? [];
  const motivoData = kpis.porMotivoPerdida ?? [];
  const clinicaData = kpis.porClinica ?? [];
  const totalPerdidos = motivoData.reduce((s, m) => s + m.count, 0);

  return (
    <div className="space-y-8">

      {/* ── Sección 1: Origen del paciente ── */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-[var(--color-foreground)] flex items-center gap-2">
          Conversión por origen del paciente
          <span className="text-[10px] font-normal text-[var(--color-muted)]">todos los tiempos</span>
        </h3>

        {origenData.filter((o) => o.origen !== "sin_origen").length === 0 ? (
          <p className="text-xs text-[var(--color-muted)] italic">Sin datos de origen. Empieza a registrar el canal al crear presupuestos.</p>
        ) : (
          <>
            {/* Cards */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {origenData.filter((o) => o.origen !== "sin_origen").map((o, i) => (
                <div key={o.origen} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorCategoria(i) }} />
                    <p className="text-[10px] font-medium text-[var(--color-muted)] uppercase tracking-wide truncate">{o.label}</p>
                  </div>
                  <p className="font-display text-2xl font-bold tabular-nums text-[var(--color-foreground)]">{textoTasa(o.tasa)}</p>
                  <p className="text-[10px] text-[var(--color-muted)] mt-1">{notaTasa(o.tasa)}</p>
                  {o.importe > 0 && <p className="text-[10px] text-[var(--color-accent)] font-semibold mt-0.5">{eur(o.importe)}</p>}
                </div>
              ))}
            </div>

            {/* Bar chart */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase mb-3">€ aceptado / € presentado</p>
              <ResponsiveContainer width="100%" height={Math.max(180, origenData.filter((o) => o.origen !== "sin_origen").length * 44)}>
                <BarChart
                  layout="vertical"
                  data={origenData.filter((o) => o.origen !== "sin_origen").map((o) => ({ ...o, tasaPct: o.tasa.pct }))}
                  margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: "var(--color-muted)", fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={80} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v}%`, "Tasa"]} />
                  <Bar dataKey="tasaPct" radius={[0, 6, 6, 0]} fill="var(--color-accent)" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[var(--color-surface-muted)]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-muted)]">Origen</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-[var(--color-muted)]">Ofrecidos</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-[var(--color-muted)]">Aceptados</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-[var(--color-muted)]">Tasa</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-[var(--color-muted)]">€</th>
                  </tr>
                </thead>
                <tbody>
                  {origenData.map((o, i) => (
                    <tr key={o.origen} className={i % 2 === 0 ? "" : "bg-[var(--color-surface-muted)]"}>
                      <td className="px-4 py-2 font-medium text-[var(--color-foreground)]">{o.label}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-muted)]">{o.total}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-muted)]">{o.aceptados}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`font-bold ${colorTasa(o.tasa)}`} title={notaTasa(o.tasa)}>
                          {textoTasa(o.tasa)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--color-muted)]">
                        {o.importe > 0 ? eur(o.importe) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Sección 2: Clínicas (solo manager) ── */}
      {isManager && clinicaData.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-[var(--color-foreground)]">Comparativa de clínicas</h3>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--color-surface-muted)]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-muted)]">#</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-[var(--color-muted)]">Clínica</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-[var(--color-muted)]">Total</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-[var(--color-muted)]">Aceptados</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-[var(--color-muted)]">Tasa</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-[var(--color-muted)]">€ aceptado</th>
                </tr>
              </thead>
              <tbody>
                {clinicaData.map((c, i) => (
                  <tr key={c.clinica} className={i % 2 === 0 ? "" : "bg-[var(--color-surface-muted)]"}>
                    <td className="px-4 py-2.5">
                      {i === 0 ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-warning-soft)] dark:bg-[var(--color-warning)]/15 text-[var(--color-warning)]">#1</span>
                      ) : i === 1 ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">#2</span>
                      ) : i === 2 ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-warning-soft)] text-[var(--color-warning)]">#3</span>
                      ) : (
                        <span className="text-[10px] text-[var(--color-muted)]">#{i + 1}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-[var(--color-foreground)]">{c.clinica}</td>
                    <td className="px-3 py-2.5 text-right text-[var(--color-muted)]">{c.total}</td>
                    <td className="px-3 py-2.5 text-right text-[var(--color-muted)]">{c.aceptados}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`font-bold ${colorTasa(c.tasa)}`} title={notaTasa(c.tasa)}>
                        {textoTasa(c.tasa)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-muted)]">
                      {c.importe > 0 ? eur(c.importe) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sección 3: Motivos de pérdida ── */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-[var(--color-foreground)] flex items-center gap-2">
          Motivos de pérdida
          {totalPerdidos > 0 && (
            <span className="text-[10px] font-normal text-[var(--color-muted)]">{totalPerdidos} perdidos</span>
          )}
        </h3>

        {motivoData.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)] italic">Sin presupuestos perdidos registrados.</p>
        ) : (
          <>
            {/* Bar chart */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <ResponsiveContainer width="100%" height={Math.max(160, motivoData.length * 44)}>
                <BarChart
                  layout="vertical"
                  data={motivoData}
                  margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                  <XAxis type="number" tick={{ fill: "var(--color-muted)", fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={100} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [v, "Casos"]} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="var(--color-danger)" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[var(--color-surface-muted)]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-muted)]">Motivo</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-[var(--color-muted)]">Casos</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-[var(--color-muted)]">%</th>
                  </tr>
                </thead>
                <tbody>
                  {motivoData.map((m, i) => (
                    <tr key={m.motivo} className={i % 2 === 0 ? "" : "bg-[var(--color-surface-muted)]"}>
                      <td className="px-4 py-2 font-medium text-[var(--color-foreground)]">{m.label}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-muted)]">{m.count}</td>
                      <td className="px-4 py-2 text-right font-bold text-[var(--color-danger)]">{m.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

    </div>
  );
}

// ─── Tab: Motor IA ───────────────────────────────────────────────────────────

const TONO_META: Record<string, { label: string; color: string; textColor: string; hex: string }> = {
  directo:  { label: "Directo",  color: "bg-[var(--color-surface-muted)]",   textColor: "text-[var(--color-foreground)]", hex: "var(--color-muted)" },
  empatico: { label: "Empático", color: "bg-[var(--color-accent-soft)]",   textColor: "text-[var(--color-accent)]", hex: "var(--color-accent)" },
  urgencia: { label: "Urgencia", color: "bg-[var(--color-danger-soft)]",     textColor: "text-[var(--color-danger)]",   hex: "var(--color-danger)" },
};

function TabMotorIA({ stats, loading, isDemo, error }: {
  stats: TonosStats | null;
  loading: boolean;
  isDemo: boolean;
  /** El motivo real del fallo. Sin esto, "no se pudo preguntar" se pintaba
   *  igual que "todavía no hay datos de tonos". */
  error: string | null;
}) {
  if (error) {
    return (
      <ErrorState
        title="No se pudieron cargar los datos del asistente"
        detail={error}
      />
    );
  }
  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-24 rounded-xl bg-[var(--color-surface-muted)]" />
        <div className="h-40 rounded-xl bg-[var(--color-surface-muted)]" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center">
        <p className="text-sm font-semibold text-[var(--color-muted)]">Sin datos del asistente IA todavía</p>
        <p className="text-xs text-[var(--color-muted)] mt-1">
          Los datos aparecen cuando se envían mensajes con el asistente IA y los presupuestos se resuelven (Aceptado / Perdido).
        </p>
      </div>
    );
  }

  // Best tono
  const tonos = ["directo", "empatico", "urgencia"] as const;
  const bestTono = tonos.reduce<string | null>((best, t) => {
    const tasa = stats[t].tasa;
    if (tasa == null) return best;
    if (best == null) return t;
    return (stats[t].tasa! > (stats[best as keyof TonosStats]?.tasa ?? -1)) ? t : best;
  }, null);

  const total = tonos.reduce((s, t) => s + stats[t].contactados, 0);
  const totalAcep = tonos.reduce((s, t) => s + stats[t].aceptados, 0);
  const tasaGlobal = total > 0 ? Math.round((totalAcep / total) * 100) : null;

  return (
    <div className="space-y-5">
      {isDemo && (
        <div className="rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-2 text-xs text-[var(--color-warning)]">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Esta clínica aún no tiene datos conectados. Contacta con Fyllio para activarlos.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="text-[11px] font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Mensajes IA enviados</p>
          <p className="font-display text-3xl font-bold tabular-nums text-[var(--color-foreground)]">{total}</p>
          <p className="text-xs text-[var(--color-muted)] mt-1">contactos con asistente IA</p>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="text-[11px] font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Tasa global IA</p>
          <p className="font-display text-3xl font-bold tabular-nums text-[var(--color-foreground)]">{tasaGlobal != null ? `${tasaGlobal}%` : "—"}</p>
          <p className="text-xs text-[var(--color-muted)] mt-1">{totalAcep} aceptados de {total}</p>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] p-5">
          <p className="text-[11px] font-semibold text-[var(--color-accent)] uppercase tracking-wide mb-2 flex items-center gap-1">
            Mejor tono
            <Star size={12} strokeWidth={ICON_STROKE} aria-hidden />
          </p>
          <p className="font-display text-3xl font-bold tabular-nums text-[var(--color-accent)]">
            {bestTono ? TONO_META[bestTono].label : "—"}
          </p>
          <p className="text-xs text-[var(--color-accent)] mt-1">
            {bestTono && stats[bestTono as keyof TonosStats].tasa != null
              ? `${stats[bestTono as keyof TonosStats].tasa}% de conversión`
              : "Sin datos suficientes"}
          </p>
        </div>
      </div>

      {/* Per-tono table */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <p className="px-4 py-3 text-[11px] font-medium text-[var(--color-muted)] border-b border-[var(--color-border)] uppercase tracking-wider">
          A/B por tono — histórico acumulado
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {["Tono", "Mensajes enviados", "Presup. aceptados", "Tasa conv.", ""].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold text-[var(--color-muted)] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tonos.map((tono) => {
              const s = stats[tono];
              const meta = TONO_META[tono];
              const isBest = bestTono === tono;
              return (
                <tr key={tono} className={`border-b border-[var(--color-border)] last:border-0 ${isBest ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-surface-muted)]"}`}>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color} ${meta.textColor}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-foreground)] font-semibold">{s.contactados}</td>
                  <td className="px-4 py-3 font-semibold text-[var(--color-success)]">{s.aceptados}</td>
                  <td className="px-4 py-3">
                    {s.tasa != null ? (
                      <span className={`font-bold text-sm ${s.tasa >= 40 ? "text-[var(--color-success)]" : s.tasa >= 20 ? "text-[var(--color-warning)]" : "text-[var(--color-danger)]"}`}>
                        {s.tasa}%
                      </span>
                    ) : (
                      <span className="text-[var(--color-muted)] text-[10px]">Insuf. datos (&lt;10)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isBest && s.tasa != null && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                        <Star size={10} strokeWidth={ICON_STROKE} aria-hidden />
                        Mejor
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[10px] text-[var(--color-muted)] border-t border-[var(--color-border)]">
          Se necesitan al menos 10 mensajes por tono para calcular la tasa. Los presupuestos pueden haber recibido mensajes de más de un tono.
        </p>
      </div>

      {/* Bar chart */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <p className="text-sm font-bold text-[var(--color-foreground)] mb-4">Conversión por tono</p>
        <div className="space-y-3">
          {tonos.map((tono) => {
            const s = stats[tono];
            const meta = TONO_META[tono];
            const pct = s.tasa ?? 0;
            return (
              <div key={tono} className="flex items-center gap-3">
                <span className={`text-[10px] font-bold w-16 shrink-0 ${meta.textColor}`}>{meta.label}</span>
                <div className="flex-1 bg-[var(--color-surface-muted)] rounded-full h-3 overflow-hidden">
                  <div
                    className="h-3 rounded-full transition-all"
                    style={{ width: `${pct}%`, background: meta.hex }}
                  />
                </div>
                <span className="text-xs font-bold text-[var(--color-foreground)] w-12 text-right shrink-0">
                  {s.tasa != null ? `${s.tasa}%` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main KpiView ─────────────────────────────────────────────────────────────

// El periodo, el doctor y la clínica ya NO se eligen aquí: llegan de la cabecera
// compartida de /kpis (bloque 2, 2026-07-30). Esta pantalla tenía su propia fila
// de tres filtros —incluido un segundo desplegable de clínicas, con el selector
// global ya en la cabecera de la app— que además no existía en las otras tres
// pestañas: cambiar de módulo hacía desaparecer los controles.
export default function KpiView({
  user,
  showBenchmark = true,
  periodo,
  doctor,
  clinicaNombre,
}: {
  user: UserSession;
  showBenchmark?: boolean;
  periodo: PeriodoKpi;
  doctor: string;
  clinicaNombre: string | null;
}) {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [kpisMes, setKpisMes] = useState<KpiData | null>(null);
  const [kpisPrevMes, setKpisPrevMes] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("general");
  // Solo presentación: reintento del ErrorState — re-dispara el mismo useEffect de carga.
  const [reloadKey, setReloadKey] = useState(0);
  // La clínica efectiva: la encargada solo ve la suya; el resto, la del selector
  // global. Una sola fuente, ninguna copia local.
  const clinicaEfectiva =
    user.rol === "encargada_ventas" && user.clinica ? user.clinica : clinicaNombre;

  // Motor IA tab state
  const [tonosStats, setTonosStats] = useState<TonosStats | null>(null);
  const [tonosLoading, setTonosLoading] = useState(false);
  const [tonosIsDemo, setTonosIsDemo] = useState(false);
  const [tonosError, setTonosError] = useState<string | null>(null);
  const tonosFetchedRef = useRef(false);

  // Lazy fetch for Motor IA tab — only once
  useEffect(() => {
    if (subTab !== "ia" || tonosFetchedRef.current) return;
    tonosFetchedRef.current = true;
    setTonosLoading(true);
    const url = new URL("/api/presupuestos/tonos-stats", location.href);
    if (clinicaEfectiva) url.searchParams.set("clinica", clinicaEfectiva);
    // El último `fetch` a pelo de la pantalla, con su catch mudo: un fallo
    // dejaba la pestaña "Asistente IA" con `stats` en null y su propio vacío
    // ("aún no hay datos de tonos"), indistinguible de que no se pudo preguntar.
    cargarJSON<{ stats?: TonosStats | null; isDemo?: boolean }>(url.toString())
      .then((d) => {
        setTonosStats(d.stats ?? null);
        setTonosIsDemo(d.isDemo ?? false);
        setTonosError(null);
      })
      .catch((e) => {
        setTonosStats(null);
        setTonosError(mensajeDeError(e));
      })
      .finally(() => setTonosLoading(false));
  }, [subTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = new URL("/api/presupuestos/kpis", location.href);
    if (clinicaEfectiva) url.searchParams.set("clinica", clinicaEfectiva);
    if (doctor) url.searchParams.set("doctor", doctor);
    url.searchParams.set("periodo", periodo);
    // Aquí había un `fetch` a pelo sin comprobar el status: un 500 con {error}
    // entraba como respuesta buena y solo se salvaba porque los tres `?? null`
    // acababan en el ErrorState. Funcionaba por accidente (§10).
    cargarJSON<{ kpis: KpiData; kpisMes: KpiData; kpisPrevMes: KpiData }>(url.toString())
      .then((d) => {
        setKpis(d.kpis);
        setKpisMes(d.kpisMes);
        setKpisPrevMes(d.kpisPrevMes);
      })
      .catch((e) => {
        setKpis(null);
        setError(mensajeDeError(e));
      })
      .finally(() => setLoading(false));
  }, [clinicaEfectiva, doctor, periodo, reloadKey]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-4 gap-3">{[1,2,3,4].map((i) => <div key={i} className="h-28 rounded-xl bg-[var(--color-surface-muted)]" />)}</div>
        <div className="h-64 rounded-xl bg-[var(--color-surface-muted)]" />
      </div>
    );
  }

  if (!kpis || !kpisMes || !kpisPrevMes) {
    return (
      <ErrorState
        title="No se pudieron cargar los KPIs"
        detail={error ?? "Los indicadores de presupuestos no están disponibles ahora mismo."}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  // Cómo se nombra el periodo DENTRO de una frase ("presupuestos de este mes",
  // "de los presentados en la semana"). `etiquetaPeriodo` da la etiqueta del
  // botón —"Mes"—, que en medio de una frase se lee como un error.
  const mesLabel = NOMBRE_EN_FRASE[periodo];
  const isManager = user.rol === "manager_general";

  return (
    <div className="space-y-4">
      {/* Las siete pestañas internas usan el primitivo compartido de pills
          (`ColaTabs`, el de las colas de Presupuestos y Cobros) en vez del
          subrayado propio que era el quinto patrón de pestañas del producto. */}
      <ColaTabs
        tabs={SUB_TABS.filter((t) => showBenchmark || t.id !== "benchmark")}
        active={subTab}
        onChange={setSubTab}
      />

      {/* Tab content */}
      {subTab === "general" && <TabGeneral kpisMes={kpisMes} kpisPrevMes={kpisPrevMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "tarifas" && <TabTarifas kpisMes={kpisMes} kpisPrevMes={kpisPrevMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "paciente" && <TabPaciente kpisMes={kpisMes} kpisPrevMes={kpisPrevMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "tratamientos" && <TabTratamientos kpisMes={kpisMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "doctores" && <TabDoctores kpisMes={kpisMes} kpisPrevMes={kpisPrevMes} kpis={kpis} mesLabel={mesLabel} />}
      {subTab === "benchmark" && <TabBenchmark kpis={kpis} isManager={isManager} />}
      {subTab === "ia" && <TabMotorIA stats={tonosStats} loading={tonosLoading} isDemo={tonosIsDemo} error={tonosError} />}
    </div>
  );
}
