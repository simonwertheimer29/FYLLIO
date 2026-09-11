"use client";
// app/(authed)/analiticas/fuga/FugaView.tsx
//
// «Dónde se pierde» (2.2, MEJORAS 177): los casos que salieron del flujo en
// la ventana, etapa por etapa, con lo que costaron y el motivo que quedó
// registrado. Dos monedas que NO se suman: el dinero de documentos reales
// (presupuestos perdidos, cobros vencidos) y el € esperado de los leads, que
// es una estimación con la propia clínica y va aparte, con su método.
//
// Lo que está parado HOY (y se rescata hoy) vive en Inicio; esto es la
// lectura analítica de lo que ya se fue.

import { useCallback, useEffect, useState } from "react";
import { Card } from "../../../components/ui/Card";
import { ErrorState } from "../../../components/ui/Feedback";
import { Skeleton } from "../../../components/ui/Skeleton";
import {
  ArrowDown,
  ArrowRight,
  CreditCard,
  FileText,
  Minus,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserX,
  CalendarClock,
  ICON_STROKE,
} from "../../../components/icons";
import { cargarJSON, mensajeDeError } from "../../../lib/fetch-json";
import { eur } from "../../../components/shared/Cifra";
// Del módulo PURO, nunca de `fuga.ts`: aquello arrastraría pg al navegador.
import { VENTANAS_FUGA, VENTANA_FUGA_DEFAULT, type EtapaDeFuga, type EtapaFuga, type Fuga, type Tramo, type VentanaFuga } from "../../../lib/metricas/fuga.tipos";

type Respuesta = Fuga & { clinicas: { id: string; nombre: string }[]; puedeRed: boolean; clinicaId: string };

const fmtN = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const fmtDec = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

const ICONO_ETAPA: Record<EtapaFuga, typeof UserX> = {
  sin_contacto: UserX,
  sin_cita: CalendarClock,
  presupuesto_perdido: FileText,
  cobro_vencido: CreditCard,
};

export function FugaView() {
  const [clinicaId, setClinicaId] = useState<string | null>(null);
  const [dias, setDias] = useState<VentanaFuga>(VENTANA_FUGA_DEFAULT);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ dias: String(dias) });
      if (clinicaId) qs.set("clinicaId", clinicaId);
      const r = await cargarJSON<Respuesta>(`/api/metricas/fuga?${qs.toString()}`, {
        validar: (d) => Array.isArray((d as Respuesta)?.etapas) && Array.isArray((d as Respuesta)?.clinicas),
      });
      setDatos(r);
      if (!clinicaId) setClinicaId(r.clinicaId);
    } catch (e) {
      // Se conserva lo último bueno: vaciar la pantalla es perder información (§10).
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [clinicaId, dias]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-geist-sans)] text-xl font-semibold text-[var(--color-foreground)]">Dónde se pierde</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Los casos que se perdieron, etapa por etapa: cuántos, cuánto y por qué.</p>
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

      {error && <ErrorState title="No se pudo calcular el mapa" detail={error} onRetry={() => void cargar()} />}

      {!datos && !error && <EsqueletoMapa />}

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
            <div className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
              Ventana
              <div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 text-sm">
                {VENTANAS_FUGA.map((d) => (
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
            <p className="basis-full text-xs text-[var(--color-muted)] sm:basis-auto sm:ml-auto">
              Del {fechaCorta(datos.ventana.desde)} al {fechaCorta(datos.ventana.hasta)} (días completos, hasta ayer) · comparado con
              del {fechaCorta(datos.ventanaPrevia.desde)} al {fechaCorta(datos.ventanaPrevia.hasta)}
            </p>
          </section>

          <Titular datos={datos} />

          {/* En una columna es un embudo con flechas; con sitio, las etapas van en rejilla y las flechas sobran. */}
          <ol className="grid gap-3 xl:grid-cols-2 min-[2100px]:grid-cols-4">
            {datos.etapas.map((e, i) => (
              <li key={e.etapa}>
                <TarjetaEtapa etapa={e} />
                {i < datos.etapas.length - 1 && (
                  <div className="flex justify-center py-1 xl:hidden" aria-hidden>
                    <ArrowDown size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)] opacity-60" />
                  </div>
                )}
              </li>
            ))}
          </ol>

        </>
      )}
    </div>
  );
}

function Titular({ datos }: { datos: Respuesta }) {
  const t = datos.total;
  return (
    <Card padding="lg">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Casos que se fueron</div>
          <div className="mt-1 font-[family-name:var(--font-geist-sans)] text-4xl font-bold tabular-nums tracking-tight text-[var(--color-foreground)]">
            {fmtN.format(t.casos)}
          </div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">en {datos.ventana.dias} días, en las cuatro etapas</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Dinero real que se fue</div>
          <div className="mt-1 font-[family-name:var(--font-geist-sans)] text-4xl font-bold tabular-nums tracking-tight text-[var(--color-danger)]">
            {eur(t.eurReal)}
          </div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">presupuestos perdidos + cobros vencidos</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Lo que valían los leads</div>
          <div className="mt-1 font-[family-name:var(--font-geist-sans)] text-4xl font-bold tabular-nums tracking-tight text-[var(--color-muted)]">
            {t.eurEstimado == null ? "—" : `≈ ${eur(t.eurEstimado)}`}
          </div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            {t.eurEstimado == null ? "sin base suficiente para estimar (se dice en cada etapa)" : "estimación: si hubieran cerrado como tu media"}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Delta({ actual, previo, motivo }: { actual: Tramo; previo: Tramo | null; motivo: string | null }) {
  if (previo == null) {
    return (
      <span className="text-xs text-[var(--color-muted)]" title={motivo ?? undefined}>
        Sin comparación con la ventana anterior{motivo ? `: ${motivo}` : ""}
      </span>
    );
  }
  const d = actual.n - previo.n;
  // Aquí SUBIR es malo: más casos que se fueron.
  const color = d === 0 ? "text-[var(--color-muted)]" : d > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]";
  const Icono = d === 0 ? Minus : d > 0 ? TrendingUp : TrendingDown;
  const pct = previo.n > 0 ? Math.round((d / previo.n) * 1000) / 10 : null;
  const conEur = actual.eur != null && previo.eur != null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 text-xs tabular-nums ${color}`}>
      <Icono size={14} strokeWidth={ICON_STROKE} aria-hidden />
      {d > 0 ? "+" : ""}
      {fmtN.format(d)} vs. la ventana anterior ({fmtN.format(previo.n)}
      {conEur ? `, ${eur(previo.eur!)}` : ""})
      {pct != null && d !== 0 && <span className="text-[var(--color-muted)]">· {pct > 0 ? "+" : ""}{fmtDec.format(pct)} %</span>}
    </span>
  );
}

function TarjetaEtapa({ etapa: e }: { etapa: EtapaDeFuga }) {
  const Icono = ICONO_ETAPA[e.etapa];
  const totalMotivos = e.motivos.reduce((s, m) => s + m.n, 0) + e.sinMotivo;
  const maxN = Math.max(1, ...e.motivos.map((m) => m.n), e.sinMotivo);
  const vacia = e.actual.n === 0;
  return (
    <Card padding="lg" className={vacia ? "opacity-80" : ""}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <Icono size={16} strokeWidth={ICON_STROKE} />
            </span>
            <div className="min-w-0">
              {/* El criterio exacto va en tooltip (regla «una línea explica»): es
                  prescindible, el titular ya dice qué se perdió. */}
              <h2 className="font-[family-name:var(--font-geist-sans)] text-base font-semibold text-[var(--color-foreground)]" title={e.detalle}>
                {e.titulo}
              </h2>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-[family-name:var(--font-geist-sans)] text-3xl font-bold tabular-nums tracking-tight text-[var(--color-foreground)]">
              {fmtN.format(e.actual.n)}
            </span>
            <span className="text-sm text-[var(--color-muted)]">{e.actual.n === 1 ? "caso" : "casos"}</span>
            {e.actual.eur != null && (
              <span className="font-[family-name:var(--font-geist-sans)] text-2xl font-bold tabular-nums tracking-tight text-[var(--color-danger)]">
                {eur(e.actual.eur)}
              </span>
            )}
          </div>
          <div className="mt-1">
            <Delta actual={e.actual} previo={e.previo} motivo={e.previoMotivo} />
          </div>

          {e.estimado && <LineaEstimado est={e.estimado} n={e.actual.n} />}

          {e.conCita != null && e.conCita > 0 && (
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              {e.conCita} de ellos {e.conCita === 1 ? "sí había tenido" : "sí habían tenido"} cita y aun así se {e.conCita === 1 ? "perdió" : "perdieron"}.
            </p>
          )}
          {e.vencidoHoy && (
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              A día de hoy hay {fmtN.format(e.vencidoHoy.n)} {e.vencidoHoy.n === 1 ? "cobro vencido" : "cobros vencidos"} en total
              {e.vencidoHoy.eur != null ? ` (${eur(e.vencidoHoy.eur)})` : ""}, contando los que vencieron antes de la ventana.
            </p>
          )}

          <a
            href={e.href}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            Ver los casos
            <ArrowRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
          </a>
        </div>

        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Por qué, según quedó registrado</div>
          {e.etapa === "cobro_vencido" ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">Un cobro no lleva motivo en Fyllio: aquí solo hay el importe y el plazo.</p>
          ) : totalMotivos === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">Nada que explicar: no se fue ningún caso en esta etapa.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {e.motivos.map((m) => (
                <BarraMotivo key={m.clave} etiqueta={m.etiqueta} n={m.n} eur={m.eur} max={maxN} reactivable={m.reactivable} />
              ))}
              {e.sinMotivo > 0 && <BarraMotivo etiqueta="Sin motivo registrado" n={e.sinMotivo} eur={null} max={maxN} reactivable={null} tenue />}
            </ul>
          )}

          {e.frasesDelAgente.length > 0 && (
            <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)]">
                <Sparkles size={13} strokeWidth={ICON_STROKE} />
                Lo que anotó el agente en los cerrados sin motivo
              </div>
              <ul className="mt-1.5 space-y-1 text-sm text-[var(--color-foreground)]">
                {e.frasesDelAgente.map((f) => (
                  <li key={f.frase} className="flex flex-wrap items-baseline gap-x-2">
                    <span>«{f.frase}»</span>
                    {f.etiquetaSugerida && <span className="text-xs text-[var(--color-muted)]">→ {f.etiquetaSugerida}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function LineaEstimado({ est, n }: { est: NonNullable<EtapaDeFuga["estimado"]>; n: number }) {
  if (n === 0) return null;
  if (est.eur == null) {
    return <p className="mt-2 text-xs text-[var(--color-muted)]">Sin € estimado: {est.motivo}.</p>;
  }
  return (
    <p className="mt-2 text-xs text-[var(--color-muted)]">
      <span className="font-medium text-[var(--color-foreground)]">≈ {eur(est.eur)}</span> si hubieran cerrado como tu media: de cada 100 leads
      captados, {fmtDec.format(est.tasaPct ?? 0)} acaban aceptando un presupuesto de {eur(est.ticketMedio ?? 0)} de media (tus últimos{" "}
      {est.dias} días: {fmtN.format(est.captados)} captados, {fmtN.format(est.aceptados)} aceptaron).
    </p>
  );
}

function BarraMotivo({
  etiqueta,
  n,
  eur: importe,
  max,
  reactivable,
  tenue,
}: {
  etiqueta: string;
  n: number;
  eur: number | null;
  max: number;
  reactivable: boolean | null;
  tenue?: boolean;
}) {
  const ancho = Math.max(4, Math.round((n / max) * 100));
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className={`truncate ${tenue ? "text-[var(--color-muted)]" : "text-[var(--color-foreground)]"}`}>
          {etiqueta}
          {reactivable === true && <span className="ml-1.5 text-xs text-[var(--color-accent)]">aún reactivable</span>}
        </span>
        <span className="shrink-0 tabular-nums text-[var(--color-foreground)]">
          {fmtN.format(n)}
          {importe != null && <span className="ml-1.5 text-xs text-[var(--color-muted)]">{eur(importe)}</span>}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
        <div className={`h-full rounded-full ${tenue ? "bg-[var(--color-border)]" : "bg-[var(--color-accent)]"}`} style={{ width: `${ancho}%` }} />
      </div>
    </li>
  );
}

function EsqueletoMapa() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  );
}
