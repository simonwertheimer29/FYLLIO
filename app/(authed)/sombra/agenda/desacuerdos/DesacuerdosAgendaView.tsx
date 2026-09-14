"use client";
// app/(authed)/sombra/agenda/desacuerdos/DesacuerdosAgendaView.tsx
//
// DÓNDE NO COINCIDIMOS (14-09-2026). La otra mitad del corpus de agenda: en
// /sombra/agenda se etiqueta A CIEGAS y aquí se lee la comparación, con la
// lista ya terminada y sin haber pasado dos veces por ella.
//
// LA CONDICIÓN DE SIMON, y está en la estructura de la pantalla, no en una
// nota al pie: LOS «NINGUNO» SE CUENTAN APARTE. Un 90 % global puede ser solo
// que los dos sabemos descartar lo obvio — 56 de los 91 candidatos son
// «ninguno», así que el número grande lo domina el material fácil. Por eso la
// vara (afirma contra repite) es el bloque de arriba y el único que se lee
// como nota; el descarte va aparte, y el global va el último y con su aviso.
//
// Y los desacuerdos no valen todos lo mismo: se ordenan por lo que CUESTAN.
// Dejar pasar una afirmación falsa llega al paciente; vetar algo verdadero
// calla al agente; alarmarse con lo que no habla de agenda es ruido.
//
// El resumen se calcula EN EL CLIENTE sobre las filas filtradas (lección del
// 14-09: un resumen que viene del servidor y no se recalcula al cambiar el
// filtro es un contador que miente mientras trabajas).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../../../../components/ui/Card";
import { ErrorState, EmptyState } from "../../../../components/ui/Feedback";
import { StatePill } from "../../../../components/ui/StatePill";
import { CardListSkeleton } from "../../../../components/ui/Skeleton";
import { AlertTriangle, Calendar, ChevronDown, ChevronRight, Gauge, ICON_STROKE } from "../../../../components/icons";
import { cargarJSON, mensajeDeError } from "../../../../lib/fetch-json";
import {
  compararAgenda,
  DEFINICION_ETIQUETA,
  ETIQUETAS_AGENDA,
  ETIQUETA_GRAVEDAD,
  ETIQUETA_ORIGEN_CORPUS,
  GRAVEDADES,
  gravedadDelPar,
  ORIGENES_CORPUS,
  VARIANTE_ETIQUETA,
  type EtiquetaAgenda,
  type FilaComparada,
  type Gravedad,
  type OrigenCorpus,
  type ResumenCorpus,
} from "../../../../lib/agente/agenda-enrutador";

type Respuesta = { filas: FilaComparada[]; resumen: ResumenCorpus };
type FiltroOrigen = OrigenCorpus | "todos";

export function DesacuerdosAgendaView() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [origen, setOrigen] = useState<FiltroOrigen>("todos");
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await cargarJSON<Respuesta>("/api/sombra/agenda/desacuerdos", {
        validar: (d) => Array.isArray((d as Respuesta)?.filas),
      });
      setDatos(r);
    } catch (e) {
      // §10 — se conserva lo último bueno y el error se dice. Una lista vacía
      // aquí se leería como «coincidimos en todo», que es la conclusión
      // contraria a la verdadera.
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const todas = useMemo(() => datos?.filas ?? [], [datos]);
  const filas = useMemo(() => (origen === "todos" ? todas : todas.filter((f) => f.origen === origen)), [todas, origen]);
  const cmp = useMemo(() => compararAgenda(filas), [filas]);

  const desacuerdos = useMemo(() => {
    const conGravedad = filas
      .map((f) => ({ f, g: gravedadDelPar(f.etiqueta, f.juicio.etiqueta) }))
      .filter((x): x is { f: FilaComparada; g: Gravedad } => x.g != null);
    return GRAVEDADES.map((g) => ({ g, filas: conGravedad.filter((x) => x.g === g).map((x) => x.f) })).filter((x) => x.filas.length > 0);
  }, [filas]);

  const juzgados = useMemo(() => filas.filter((f) => f.juicio.etiqueta != null).length, [filas]);
  const version = useMemo(() => filas.find((f) => f.juicio.version)?.juicio ?? null, [filas]);

  return (
    <div className="p-4 lg:p-6">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Gauge size={18} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">Agenda · dónde no coincidimos</h1>
          <a
            href="/sombra/agenda"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)] hover:underline"
          >
            <Calendar size={14} strokeWidth={ICON_STROKE} aria-hidden /> volver a etiquetar
          </a>
        </div>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Lo que etiquetó Simon contra lo que dijo el juicio especializado, sobre los mismos mensajes.
        </p>
      </header>

      {cargando && !datos ? (
        <CardListSkeleton />
      ) : error && !datos ? (
        <ErrorState title="No se pudo leer la comparación" detail={error} onRetry={() => void cargar()} />
      ) : (
        <div className="space-y-4">
          {error && (
            <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-muted)]">
              Se está viendo lo último que cargó bien. {error}
            </p>
          )}

          {/* Por material: los cuatro guiones son muchos mensajes de pocas
              situaciones, y mezclados inflan cualquier porcentaje. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOrigen("todos")}
              className={chip(origen === "todos")}
            >
              Todo el material
            </button>
            {ORIGENES_CORPUS.map((o) => {
              const n = todas.filter((f) => f.origen === o).length;
              if (n === 0) return null;
              return (
                <button key={o} type="button" title={ETIQUETA_ORIGEN_CORPUS[o].que} onClick={() => setOrigen(o)} className={chip(origen === o)}>
                  {ETIQUETA_ORIGEN_CORPUS[o].etiqueta} <span className="tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          {juzgados === 0 ? (
            <EmptyState
              title="Todavía no hay ningún veredicto guardado"
              hint="El juicio especializado aún no ha pasado por este material. Se lanza con «npm run agenda:juicio» y escribe su veredicto al lado de cada etiqueta."
            />
          ) : (
            <>
              {/* ── LA VARA: el único número que se lee como nota ────────── */}
              <Card className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                      La vara · solo donde Simon dijo «afirma» o «repite»
                    </p>
                    <p className="mt-1 flex items-baseline gap-2">
                      <span className="font-display text-4xl font-bold tabular-nums text-[var(--color-foreground)]">
                        {cmp.vara.pct ?? "—"}
                        {cmp.vara.pct != null && <span className="text-2xl"> %</span>}
                      </span>
                      <span className="text-sm text-[var(--color-muted)]">
                        {cmp.vara.acuerdo} de {cmp.vara.n} · aquí se juega si el test funciona
                      </span>
                    </p>
                    {/* MEJORAS 239 — si alguien rejugó un hilo, la vara ENCOGE y hay
                        que poder verlo al lado del porcentaje: un 88 % sobre 32 casos
                        y otro sobre 24 no son la misma nota. Antes ni encogía: la
                        etiqueta se heredaba en falso y el número salía redondo. */}
                    {datos != null && datos.resumen.huerfanas > 0 && (
                      <p className="mt-1.5">
                        <StatePill variant="warning">
                          {datos.resumen.huerfanas} {datos.resumen.huerfanas === 1 ? "etiqueta" : "etiquetas"} ya no tienen mensaje detrás: se rejugó ese hilo y salieron de la vara
                        </StatePill>
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Cifra
                    n={cmp.vara.dejaPasar}
                    etiqueta="Deja pasar algo falso"
                    que={ETIQUETA_GRAVEDAD.deja_pasar.que}
                    tono={cmp.vara.dejaPasar > 0 ? "danger" : "neutral"}
                  />
                  <Cifra
                    n={cmp.vara.vetaDeMas}
                    etiqueta="Veta algo verdadero"
                    que={ETIQUETA_GRAVEDAD.veta_de_mas.que}
                    tono={cmp.vara.vetaDeMas > 0 ? "warning" : "neutral"}
                  />
                  <Cifra n={cmp.vara.seLoSalta} etiqueta="Ni lo mira" que={ETIQUETA_GRAVEDAD.se_lo_salta.que} tono="neutral" />
                </div>
              </Card>

              {/* ── APARTE: los «ninguno». Separados por diseño, no por sitio ── */}
              <Card className="space-y-2 border-dashed">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  Aparte · descartar lo obvio (los «ninguno» de Simon)
                </p>
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-2xl font-semibold tabular-nums text-[var(--color-muted)]">
                    {cmp.descarte.pct ?? "—"}
                    {cmp.descarte.pct != null && <span className="text-lg"> %</span>}
                  </span>
                  <span className="text-sm text-[var(--color-muted)]">
                    {cmp.descarte.acuerdo} de {cmp.descarte.n} · se alarma de más en {cmp.descarte.ruido}
                  </span>
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  No suma con la vara: acertar aquí solo dice que los dos sabemos descartar lo que no habla de la agenda.
                </p>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Matriz cmp={cmp} />
                <Card className="space-y-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">La segunda pregunta, aparte</p>
                  <p className="text-sm text-[var(--color-foreground)]">¿Se arroga el agente el poder de reservar?</p>
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="font-display text-2xl font-semibold tabular-nums text-[var(--color-foreground)]">
                      {cmp.reserva.pct ?? "—"}
                      {cmp.reserva.pct != null && <span className="text-lg"> %</span>}
                    </span>
                    <span className="text-sm text-[var(--color-muted)]">
                      {cmp.reserva.acuerdo} de {cmp.reserva.n} contestadas por los dos
                    </span>
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    Se la arroga y el juicio no lo ve: {cmp.reserva.seLaArrogaYNoLoVe} · se alarma sin motivo: {cmp.reserva.alarmaDeMas}
                  </p>
                  <div className="border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-muted)]">
                    <p>
                      Global {cmp.global.acuerdo}/{cmp.global.n}
                      {cmp.global.pct != null ? ` = ${cmp.global.pct} %` : ""} — el número que halaga: lleva los «ninguno» dentro.
                    </p>
                    <p className="mt-1">
                      {juzgados} juzgados de {filas.length}
                      {cmp.sinJuicio > 0 ? ` · ${cmp.sinJuicio} etiquetados sin juicio` : ""}
                      {cmp.sinEtiqueta > 0 ? ` · ${cmp.sinEtiqueta} juzgados sin etiquetar` : ""}
                      {version?.version ? ` · versión ${version.version}` : ""}
                      {version?.modelo ? ` · ${version.modelo}` : ""}
                    </p>
                  </div>
                </Card>
              </div>

              {/* ── Los desacuerdos, por lo que cuestan ──────────────────── */}
              {desacuerdos.length === 0 ? (
                <Card>
                  <p className="text-sm text-[var(--color-foreground)]">
                    Ningún desacuerdo en {origen === "todos" ? "todo el material" : `«${ETIQUETA_ORIGEN_CORPUS[origen].etiqueta}»`}.
                  </p>
                </Card>
              ) : (
                desacuerdos.map(({ g, filas: fs }) => (
                  <section key={g} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {g === "deja_pasar" && <AlertTriangle size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-danger)]" aria-hidden />}
                      <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">{ETIQUETA_GRAVEDAD[g].etiqueta}</h2>
                      <span className="tabular-nums text-sm text-[var(--color-muted)]">{fs.length}</span>
                    </div>
                    <p className="text-sm text-[var(--color-muted)]">{ETIQUETA_GRAVEDAD[g].que}</p>
                    <div className="space-y-2">
                      {fs.map((f) => (
                        <FilaDesacuerdo key={f.clave} f={f} abierto={abierto === f.clave} alternar={() => setAbierto(abierto === f.clave ? null : f.clave)} />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const chip = (activo: boolean) =>
  `h-8 rounded-lg border px-3 text-sm transition-colors ${
    activo
      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
      : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
  }`;

function Cifra({ n, etiqueta, que, tono }: { n: number; etiqueta: string; que: string; tono: "danger" | "warning" | "neutral" }) {
  const color =
    tono === "danger" ? "text-[var(--color-danger)]" : tono === "warning" ? "text-[var(--color-warning)]" : "text-[var(--color-muted)]";
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2" title={que}>
      <span className={`font-display text-2xl font-semibold tabular-nums ${color}`}>{n}</span>
      <p className="text-xs text-[var(--color-muted)]">{etiqueta}</p>
    </div>
  );
}

/** La matriz 3×3 con la fila y la columna de «ninguno» separadas por un borde:
 *  la condición de contarlos aparte se ve también aquí, no solo en los números. */
function Matriz({ cmp }: { cmp: ReturnType<typeof compararAgenda> }) {
  return (
    <Card className="space-y-2 overflow-x-auto">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Fila = Simon · columna = el juicio</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            <th className="p-1 text-left font-medium"> </th>
            {ETIQUETAS_AGENDA.map((e) => (
              <th key={e} className={`p-1 text-right font-medium ${e === "ninguno" ? "border-l border-[var(--color-border)]" : ""}`}>
                {DEFINICION_ETIQUETA[e].etiqueta}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ETIQUETAS_AGENDA.map((mio) => (
            <tr key={mio} className={mio === "ninguno" ? "border-t border-[var(--color-border)]" : ""}>
              <th className="p-1 text-left text-xs font-medium text-[var(--color-muted)]">{DEFINICION_ETIQUETA[mio].etiqueta}</th>
              {ETIQUETAS_AGENDA.map((suyo) => {
                const n = cmp.matriz[mio][suyo];
                const coincide = mio === suyo;
                return (
                  <td
                    key={suyo}
                    className={`p-1 text-right tabular-nums ${suyo === "ninguno" ? "border-l border-[var(--color-border)]" : ""} ${
                      coincide ? "font-semibold text-[var(--color-foreground)]" : n > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"
                    }`}
                  >
                    {n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function FilaDesacuerdo({ f, abierto, alternar }: { f: FilaComparada; abierto: boolean; alternar: () => void }) {
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-sm font-semibold text-[var(--color-foreground)]">{f.hilo}</span>
        <StatePill variant="neutral">{ETIQUETA_ORIGEN_CORPUS[f.origen].etiqueta}</StatePill>
        {f.decisor && <StatePill variant="neutral">{f.decisor}</StatePill>}
      </div>

      <p className="whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm text-[var(--color-foreground)]">
        {f.texto}
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border)] p-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Simon</p>
          <div className="mt-1">
            {f.etiqueta ? (
              <StatePill variant={VARIANTE_ETIQUETA[f.etiqueta]} size="md">
                {DEFINICION_ETIQUETA[f.etiqueta].etiqueta}
              </StatePill>
            ) : (
              <span className="text-sm text-[var(--color-muted)]">sin etiquetar</span>
            )}
          </div>
          {f.nota && <p className="mt-1 text-xs text-[var(--color-muted)]">{f.nota}</p>}
        </div>
        <div className="rounded-lg border border-[var(--color-border)] p-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">El juicio</p>
          <div className="mt-1">
            {f.juicio.etiqueta ? (
              <StatePill variant={VARIANTE_ETIQUETA[f.juicio.etiqueta]} size="md">
                {DEFINICION_ETIQUETA[f.juicio.etiqueta].etiqueta}
              </StatePill>
            ) : (
              <span className="text-sm text-[var(--color-muted)]">sin juzgar</span>
            )}
          </div>
          {f.juicio.porQue && <p className="mt-1 text-xs text-[var(--color-muted)]">{f.juicio.porQue}</p>}
        </div>
      </div>

      {(f.seArroga != null || f.juicio.seArroga != null) && (
        <p className="text-xs text-[var(--color-muted)]">
          ¿Se arroga reservar? Simon: {f.seArroga == null ? "sin contestar" : f.seArroga ? "sí" : "no"} · el juicio:{" "}
          {f.juicio.seArroga == null ? "sin contestar" : f.juicio.seArroga ? "sí" : "no"}
        </p>
      )}

      {/* El hilo alrededor, plegado: lo que decide el desacuerdo casi siempre
          es si el día lo trajo ELLA, y eso solo se ve en la conversación. */}
      <button
        type="button"
        onClick={alternar}
        className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)] hover:underline"
      >
        {abierto ? <ChevronDown size={14} strokeWidth={ICON_STROKE} aria-hidden /> : <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />}
        {abierto ? "ocultar la conversación" : "ver la conversación"}
      </button>
      {abierto && (
        <div className="space-y-2 rounded-xl border border-[var(--color-border)] p-3">
          {f.mensajes.map((m, i) => (
            <div
              key={i}
              className={
                m.esElCandidato
                  ? "rounded-lg border-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2"
                  : m.quien === "paciente"
                    ? "rounded-lg bg-[var(--color-surface-muted)] px-3 py-2"
                    : "rounded-lg px-3 py-2"
              }
            >
              <div
                className={`text-[11px] font-medium uppercase tracking-wide ${m.esElCandidato ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"}`}
              >
                {m.esElCandidato
                  ? "Agente · el mensaje que se juzga"
                  : m.quien === "paciente"
                    ? f.persona
                      ? f.persona.split(" ")[0]
                      : "Paciente"
                    : m.quien === "clinica"
                      ? "La clínica escribió sola"
                      : "Agente"}
              </div>
              <p className={`mt-0.5 whitespace-pre-wrap text-sm ${m.esElCandidato ? "text-[var(--color-foreground)]" : "text-[var(--color-muted)]"}`}>
                {m.texto}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
