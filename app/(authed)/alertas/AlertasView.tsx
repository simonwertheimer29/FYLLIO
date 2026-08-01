"use client";

// Sprint 8 D.7 — Alertas: situaciones que requieren acción de coordinación.
//
// Pasada visual + de producto (2026-08-01). Lo que cambia y por qué:
//
//  · CADA ALERTA LLEVA SU DINERO y la lista se ordena por DAÑO, no por
//    recuento ni por clínica. Antes el color de urgencia salía de cuántas
//    había (>5 rojo, 3-5 ámbar), así que seis leads sin gestionar salían en
//    rojo y dos liquidaciones vencidas de 12.725 € salían en gris.
//  · POSPONER, y solo posponer. Una alerta es un hecho del negocio, no una
//    tarea que se completa; si se pudiera descartar, se descartaría lo
//    incómodo y la pantalla dejaría de servir para supervisar.
//  · ¿SIRVIÓ EL AVISO? Se guarda contra cuántos casos se envió, así que la
//    card puede decir "avisaste ayer de 3 · hoy siguen siendo 3".
//  · Skeleton en vez de "Cargando alertas…" en texto plano, y `cargarJSON`
//    en vez de `?? []` (§10 — baja la deuda declarada).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useClinic } from "../../lib/context/ClinicContext";
import { Bell, CheckCircle2, Clock, ICON_STROKE } from "../../components/icons";
import { StatePill } from "../../components/ui/StatePill";
import { EmptyState, ErrorState } from "../../components/ui/Feedback";
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { AvisoFiltroClinica } from "../../components/shared/AvisoFiltroClinica";
import { eur } from "../../components/shared/Cifra";
import { cargarJSON, traeLista } from "../../lib/fetch-json";
import { fechaHoraClinica } from "../../lib/time";
import { deDiccionario } from "../../lib/diccionario";

type Tipo =
  | "leads"
  | "presupuestos"
  | "citados"
  | "asistencias"
  | "automatizaciones"
  | "cobro_vence_3d"
  | "cobro_vencido_7d"
  | "pendiente_alto_estancado";

type UltimoAviso = {
  enviadaEn: string;
  a: string | null;
  nEntonces: number | null;
  nAhora: number;
};

type Card = {
  clinicaId: string;
  clinicaNombre: string;
  counts: Record<Tipo, number>;
  importes: Partial<Record<Tipo, number>>;
  cooldowns: Partial<Record<Tipo, { untilMs: number } | null>>;
  ultimoAviso: Partial<Record<Tipo, UltimoAviso | null>>;
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

// El plural de "liquidación" es "liquidaciones", SIN tilde. El código hacía
// `liquidación${n===1?"":"es"}` y escribía "2 liquidaciónes" en la pantalla que
// se enseña. Misma clase que el "superóaron" de /red (2026-07-27): pluralizar
// concatenando sin mirar la palabra. Se escriben las dos formas y se elige.
const plural = (n: number, singular: string, plural_: string) => (n === 1 ? singular : plural_);

const TIPO_SUBTITLE: Record<Tipo, (n: number) => string> = {
  leads: (n) => `${n} ${plural(n, "lead nuevo sin gestionar", "leads nuevos sin gestionar")}`,
  presupuestos: (n) =>
    `${n} ${plural(n, "presupuesto", "presupuestos")} sin seguimiento desde hace más de 48 h`,
  citados: (n) => `${n} ${plural(n, "cita pasada", "citas pasadas")} sin marcar asistido`,
  asistencias: (n) => `${n} ${plural(n, "cita", "citas")} sin cerrar (falta asistió / no asistió)`,
  automatizaciones: (n) => `${n} ${plural(n, "envío", "envíos")} con estado Fallido`,
  cobro_vence_3d: (n) =>
    `${n} ${plural(n, "liquidación vence", "liquidaciones vencen")} en los próximos 3 días`,
  cobro_vencido_7d: (n) =>
    `${n} ${plural(n, "liquidación vencida", "liquidaciones vencidas")} hace más de 7 días`,
  pendiente_alto_estancado: (n) =>
    `${n} ${plural(n, "presupuesto", "presupuestos")} de más de 2.000 € ${plural(n, "aceptado", "aceptados")} hace más de 30 días sin ningún cobro`,
};

const COBRO_TIPOS: Tipo[] = ["cobro_vence_3d", "cobro_vencido_7d", "pendiente_alto_estancado"];

/**
 * El ORDEN. Antes era el recuento; ahora manda el daño, y el daño se mide en
 * euros cuando los hay. Los tipos sin importe (leads, asistencias…) no se
 * inventan uno: van después de los que sí lo tienen, ordenados entre ellos por
 * cuánto se estropea el caso esperando — el mismo criterio de urgencia de
 * acción que /red (decisión 2026-07-27).
 */
const URGENCIA_SIN_IMPORTE: Tipo[] = [
  "leads",
  "asistencias",
  "presupuestos",
  "citados",
  "automatizaciones",
];

type Fila = {
  clinicaId: string;
  clinicaNombre: string;
  tipo: Tipo;
  n: number;
  importe: number | null;
  cooldown: { untilMs: number } | null;
  ultimoAviso: UltimoAviso | null;
  pospuesta: { ocultaHasta: string; por: string | null } | null;
};

function ordenar(a: Fila, b: Fila): number {
  // Con importe siempre por delante de sin importe, y entre ellos por €.
  if (a.importe != null && b.importe != null) return b.importe - a.importe;
  if (a.importe != null) return -1;
  if (b.importe != null) return 1;
  const ia = URGENCIA_SIN_IMPORTE.indexOf(a.tipo);
  const ib = URGENCIA_SIN_IMPORTE.indexOf(b.tipo);
  if (ia !== ib) return ia - ib;
  return b.n - a.n;
}

type SubTab = "todos" | "cobros" | Tipo;

export function AlertasView() {
  const { selectedClinicaId, selectedClinicaNombre, setSelectedClinicaId } = useClinic();
  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;
  const [cards, setCards] = useState<Card[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [tab, setTab] = useState<SubTab>("todos");
  const [verPospuestas, setVerPospuestas] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // `cargarJSON` en vez de `d.alertas ?? []`: un fallo de carga no puede
      // pintarse como "sin situaciones pendientes" en la pantalla cuyo trabajo
      // es avisar de que las hay (§10).
      const d = await cargarJSON<{ alertas: Card[] }>("/api/alertas", {
        validar: traeLista("alertas"),
      });
      setCards(d.alertas);
      setError(null);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Cards → FILAS planas. La unidad de esta pantalla es la alerta, no la
  // clínica: agrupar por clínica era lo que impedía ordenar por daño.
  const todasLasFilas = useMemo<Fila[]>(() => {
    const out: Fila[] = [];
    for (const c of cards ?? []) {
      if (selectedClinicaId && c.clinicaId !== selectedClinicaId) continue;
      for (const tipo of Object.keys(c.counts) as Tipo[]) {
        const n = c.counts[tipo];
        if (!n || n <= 0) continue;
        out.push({
          clinicaId: c.clinicaId,
          clinicaNombre: c.clinicaNombre,
          tipo,
          n,
          importe: c.importes?.[tipo] ?? null,
          cooldown: c.cooldowns?.[tipo] ?? null,
          ultimoAviso: c.ultimoAviso?.[tipo] ?? null,
          pospuesta: c.pospuesta?.[tipo] ?? null,
        });
      }
    }
    return out.sort(ordenar);
  }, [cards, selectedClinicaId]);

  const porPestana = useMemo(
    () =>
      todasLasFilas.filter((f) =>
        tab === "todos" ? true : tab === "cobros" ? COBRO_TIPOS.includes(f.tipo) : f.tipo === tab,
      ),
    [todasLasFilas, tab],
  );
  const activas = porPestana.filter((f) => !f.pospuesta);
  const pospuestas = porPestana.filter((f) => f.pospuesta);
  const visibles = verPospuestas ? porPestana : activas;

  const totalActivas = activas.reduce((s, f) => s + f.n, 0);
  const dineroActivo = activas.reduce((s, f) => s + (f.importe ?? 0), 0);

  async function enviar(f: Fila) {
    const key = `${f.clinicaId}:${f.tipo}`;
    setOcupada(key);
    setError(null);
    try {
      const res = await fetch("/api/alertas/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicaId: f.clinicaId, tipoAlerta: f.tipo }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error ?? "No se pudo enviar la alerta");
        return;
      }
      toast.success("Alerta enviada");
      await load();
    } catch {
      setError("No se pudo enviar la alerta. Revisa tu conexión.");
    } finally {
      setOcupada(null);
    }
  }

  async function posponer(f: Fila, deshacer = false) {
    const key = `${f.clinicaId}:${f.tipo}`;
    setOcupada(key);
    setError(null);
    try {
      const res = await fetch("/api/alertas/posponer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicaId: f.clinicaId, tipoAlerta: f.tipo, deshacer }),
      });
      if (!res.ok) throw new Error();
      toast.success(deshacer ? "Vuelve a la lista" : "Pospuesta hasta mañana");
      await load();
    } catch {
      setError(
        deshacer ? "No se pudo recuperar la alerta." : "No se pudo posponer la alerta.",
      );
    } finally {
      setOcupada(null);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)]">
      <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
              Alertas
            </h1>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              Situaciones que requieren acción por parte de coordinación
            </p>
          </div>
          {!loading && totalActivas > 0 && (
            <div className="text-right shrink-0">
              <StatePill variant="danger" size="md" className="tabular-nums">
                {totalActivas} {plural(totalActivas, "situación activa", "situaciones activas")}
              </StatePill>
              {dineroActivo > 0 && (
                <p className="mt-1 text-xs text-[var(--color-muted)] tabular-nums">
                  {eur(dineroActivo)} en juego
                </p>
              )}
            </div>
          )}
        </header>

        {clinicaFiltrada && (
          <AvisoFiltroClinica
            nombre={selectedClinicaNombre!}
            onVerTodas={() => setSelectedClinicaId(null)}
            ocultaAdemas="Las alertas de las demás clínicas no se están contando."
          />
        )}

        <div className="flex flex-wrap gap-1">
          {(
            [
              ["todos", "Todas"],
              ["cobros", "Cobros"],
              ["leads", "Leads sin gestionar"],
              ["presupuestos", "Presupuestos sin seguimiento"],
              ["asistencias", "Asistencias sin cerrar"],
              ["automatizaciones", "Automatizaciones con error"],
            ] as Array<[SubTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-md border transition-colors ${
                tab === key
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}{" "}
            {error.includes("teléfono") && (
              <Link href="/ajustes/clinica-equipo" className="font-semibold underline">
                Ir a Ajustes
              </Link>
            )}
          </p>
        )}

        {/* Skeleton, no un "Cargando alertas…" en texto plano: la pantalla
            mantiene su forma mientras carga (estándar visual §4). */}
        {loading && !cards && <CardListSkeleton rows={5} />}

        {!loading && loadError && (
          <ErrorState
            title="No se pudieron cargar las alertas"
            detail="Las situaciones pendientes no están disponibles ahora mismo."
            onRetry={load}
          />
        )}

        {!loading && !loadError && visibles.length === 0 && (
          <EmptyState
            icon={<CheckCircle2 size={20} strokeWidth={ICON_STROKE} />}
            title={pospuestas.length > 0 ? "Nada activo ahora mismo" : "Sin situaciones pendientes"}
            hint={
              pospuestas.length > 0
                ? `Hay ${pospuestas.length} pospuesta${pospuestas.length === 1 ? "" : "s"} hasta mañana.`
                : selectedClinicaId
                  ? "Esta clínica no tiene alertas en este filtro."
                  : "Ninguna clínica tiene alertas en el filtro seleccionado."
            }
          />
        )}

        {!loading && !loadError && visibles.length > 0 && (
          <div className="space-y-2">
            {visibles.map((f) => (
              <FilaAlerta
                key={`${f.clinicaId}:${f.tipo}`}
                fila={f}
                ocupada={ocupada === `${f.clinicaId}:${f.tipo}`}
                onEnviar={() => enviar(f)}
                onPosponer={(deshacer) => posponer(f, deshacer)}
              />
            ))}
          </div>
        )}

        {/* Un contador discreto para que las pospuestas no se conviertan en un
            cajón invisible: se pueden ver siempre que se quiera. */}
        {!loading && !loadError && pospuestas.length > 0 && (
          <button
            type="button"
            onClick={() => setVerPospuestas((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
          >
            <Clock size={13} strokeWidth={ICON_STROKE} aria-hidden />
            {verPospuestas
              ? "Ocultar las pospuestas"
              : `${pospuestas.length} ${plural(pospuestas.length, "pospuesta", "pospuestas")} hasta mañana — ver`}
          </button>
        )}
      </div>
    </div>
  );
}

function FilaAlerta({
  fila,
  ocupada,
  onEnviar,
  onPosponer,
}: {
  fila: Fila;
  ocupada: boolean;
  onEnviar: () => void;
  onPosponer: (deshacer: boolean) => void;
}) {
  const { tipo, n, importe, cooldown, ultimoAviso, pospuesta } = fila;
  const enCooldown = !!cooldown;
  const label = deDiccionario(TIPO_LABEL, tipo, "Situación pendiente", "alertas.tipo");
  const subtitulo = TIPO_SUBTITLE[tipo]?.(n) ?? `${n} pendientes`;

  // El tono lo marca el DINERO cuando lo hay; si no, el propio tipo. Nunca el
  // recuento: seis leads no son más graves que 12.725 € sin cobrar.
  const tono =
    importe != null && importe > 0
      ? "danger"
      : tipo === "leads" || tipo === "asistencias"
        ? "warning"
        : "neutral";
  const iconoTono =
    tono === "danger"
      ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      : tono === "warning"
        ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
        : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]";

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors ${
        pospuesta ? "opacity-60" : ""
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconoTono}`}
        aria-hidden
      >
        <Bell size={16} strokeWidth={ICON_STROKE} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-[var(--color-foreground)]">
          {label}
          <span className="text-xs font-normal text-[var(--color-muted)]">
            {fila.clinicaNombre}
          </span>
        </p>
        <p className="text-xs text-[var(--color-muted)] tabular-nums">{subtitulo}</p>

        {/* ¿SIRVIÓ EL AVISO? La pregunta que cierra el bucle. */}
        {ultimoAviso && <EfectoDelAviso aviso={ultimoAviso} />}

        {pospuesta && (
          <p className="mt-1 text-[11px] text-[var(--color-muted)]">
            Pospuesta{pospuesta.por ? ` por ${pospuesta.por}` : ""} · vuelve mañana
          </p>
        )}
      </div>

      {importe != null && importe > 0 && (
        <p className="shrink-0 font-display text-base font-semibold tabular-nums text-[var(--color-danger)]">
          {eur(importe)}
        </p>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        {pospuesta ? (
          <button
            type="button"
            onClick={() => onPosponer(true)}
            disabled={ocupada}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-40"
          >
            {ocupada ? "…" : "Recuperar"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onPosponer(false)}
              disabled={ocupada}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-40"
            >
              Posponer
            </button>
            <button
              type="button"
              onClick={onEnviar}
              disabled={ocupada || enCooldown}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {ocupada ? "Enviando…" : enCooldown ? "Avisada" : "Avisar"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "Avisaste ayer de 3 · hoy siguen siendo 3."
 *
 * Es lo que convierte la pantalla en supervisión. Se apoya en la foto que se
 * guarda al enviar (`n_al_enviar`): sin ella solo se podía decir CUÁNDO se
 * avisó, nunca si el aviso movió algo. Las alertas anteriores al 2026-08-01 no
 * tienen foto y lo dicen —"no se guardó contra cuántos"— en vez de inventarla.
 */
function EfectoDelAviso({ aviso }: { aviso: UltimoAviso }) {
  const cuando = fechaHoraClinica(aviso.enviadaEn);
  const destino = aviso.a ? ` a ${aviso.a}` : "";
  if (aviso.nEntonces == null) {
    return (
      <p className="mt-1 text-[11px] text-[var(--color-muted)]">
        Avisada el {cuando}
        {destino}.
      </p>
    );
  }
  const bajo = aviso.nAhora < aviso.nEntonces;
  const igual = aviso.nAhora === aviso.nEntonces;
  return (
    <p
      className={`mt-1 text-[11px] ${
        bajo ? "text-[var(--color-success)]" : igual ? "text-[var(--color-warning)]" : "text-[var(--color-danger)]"
      }`}
    >
      Avisada el {cuando}
      {destino} de {aviso.nEntonces}.{" "}
      {bajo
        ? `Hoy quedan ${aviso.nAhora}: el aviso movió ${aviso.nEntonces - aviso.nAhora}.`
        : igual
          ? "Hoy siguen siendo los mismos."
          : `Hoy son ${aviso.nAhora}: han ido a más.`}
    </p>
  );
}
