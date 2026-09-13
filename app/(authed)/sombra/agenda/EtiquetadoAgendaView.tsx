"use client";
// app/(authed)/sombra/agenda/EtiquetadoAgendaView.tsx
//
// LA PANTALLA DE ETIQUETADO DEL CORPUS DE AGENDA (14-09-2026). NO es producto:
// fuera del menú, solo para quien pasa esVisorSombra.
//
// Para qué: la vara del juicio de agenda deja de ser los 62 casos de qa:juez
// —paráfrasis de bugs ya conocidos, o sea sobreajuste— y pasa a ser el corpus
// real etiquetado a mano contra UNA pregunta:
//
//   «¿Qué pasa si ese día resulta no estar libre? ¿El mensaje se vuelve falso,
//    o sigue en pie?»
//
// A CIEGAS, y es condición de diseño, no preferencia: aquí no se enseña lo que
// opina el juez ni el veto determinista. La vara existe para ser independiente
// de lo que mide. El juicio especializado corre en sombra y se guarda mientras
// se etiqueta —sin pasar dos veces por la lista— y los desacuerdos se leen
// después, en otra vista.
//
// La segunda pregunta («¿se arroga el poder de reservar?») va SEPARADA y es
// opcional: fundirla con la primera es exactamente la enfermedad de la regla 5
// del juez, que mezcla dos daños distintos en una sola categoría.
//
// Se puede dejar a medias: cada etiqueta se guarda al pulsar y la lista arranca
// por lo que falta. Teclado: 1 · 2 · 3 etiquetan, R marca lo de reservar,
// J/K o ↑/↓ mueven.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Card } from "../../../components/ui/Card";
import { ErrorState, EmptyState } from "../../../components/ui/Feedback";
import { StatePill } from "../../../components/ui/StatePill";
import { CardListSkeleton } from "../../../components/ui/Skeleton";
import { Calendar, Check, ListChecks, ICON_STROKE } from "../../../components/icons";
import { cargarJSON, mensajeDeError } from "../../../lib/fetch-json";
import {
  DEFINICION_ETIQUETA,
  ETIQUETAS_AGENDA,
  ETIQUETA_FUENTE,
  ETIQUETA_ORIGEN_CORPUS,
  ORIGENES_CORPUS,
  type CandidatoAgenda,
  type EtiquetaAgenda,
  type OrigenCorpus,
  type ResumenCorpus,
} from "../../../lib/agente/agenda-enrutador";

type Respuesta = { candidatos: CandidatoAgenda[]; resumen: ResumenCorpus };
type Filtro = "pendientes" | "todos" | "etiquetados";
type FiltroOrigen = OrigenCorpus | "todos";

const LA_PREGUNTA = "Si ese día resulta no estar libre, ¿el mensaje se vuelve falso o sigue en pie?";

const VARIANTE_ETIQUETA: Record<EtiquetaAgenda, "danger" | "success" | "neutral"> = {
  afirma: "danger",
  repite: "success",
  ninguno: "neutral",
};

const ATAJO: Record<EtiquetaAgenda, string> = { afirma: "1", repite: "2", ninguno: "3" };

export function EtiquetadoAgendaView() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  // Por material: Simon etiqueta primero lo variado y deja los cuatro guiones
  // para el final — cuatro situaciones repetidas al principio gastan el
  // criterio donde menos información hay.
  const [origen, setOrigen] = useState<FiltroOrigen>("todos");
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [nota, setNota] = useState("");
  const detalleRef = useRef<HTMLDivElement | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await cargarJSON<Respuesta>("/api/sombra/agenda", {
        validar: (d) => Array.isArray((d as Respuesta)?.candidatos),
      });
      setDatos(r);
    } catch (e) {
      // Se conserva lo último bueno (§10): un fallo de red no se pinta como
      // «ya no quedan candidatos».
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const todos = useMemo(() => datos?.candidatos ?? [], [datos]);

  // El filtro se congela al entrar en un candidato: si «pendientes» quitara de
  // la lista el que acabas de etiquetar, la nota que escribes después se
  // quedaría sin dueño. Lo etiquetado sigue visible hasta recargar el filtro.
  const lista = useMemo(() => {
    const deEsteOrigen = origen === "todos" ? todos : todos.filter((c) => c.origen === origen);
    if (filtro === "todos") return deEsteOrigen;
    if (filtro === "etiquetados") return deEsteOrigen.filter((c) => c.etiqueta != null);
    return deEsteOrigen.filter((c) => c.etiqueta == null || c.clave === seleccion);
  }, [todos, filtro, origen, seleccion]);

  useEffect(() => {
    if (lista.length && (seleccion == null || !lista.some((c) => c.clave === seleccion))) {
      setSeleccion(lista[0]!.clave);
    }
  }, [lista, seleccion]);

  const actual = lista.find((c) => c.clave === seleccion) ?? null;

  useEffect(() => {
    setNota(actual?.nota ?? "");
  }, [actual?.clave, actual?.nota]);

  const mover = useCallback(
    (delta: number) => {
      if (!lista.length) return;
      const i = lista.findIndex((c) => c.clave === seleccion);
      const j = Math.min(lista.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
      setSeleccion(lista[j]!.clave);
      detalleRef.current?.scrollTo({ top: 0 });
    },
    [lista, seleccion],
  );

  const guardar = useCallback(
    async (clave: string, cambio: { etiqueta?: EtiquetaAgenda | null; seArroga?: boolean | null; nota?: string | null }, avanzar: boolean) => {
      const antes = todos.find((c) => c.clave === clave);
      if (!antes) return;
      setGuardando(true);
      // Optimista: etiquetar 80 mensajes con una espera de red por clic no se
      // acaba nunca. Si falla, se deshace y se dice (§10).
      setDatos((prev) => (prev ? { ...prev, candidatos: prev.candidatos.map((c) => (c.clave === clave ? { ...c, ...cambio } : c)) } : prev));
      try {
        await cargarJSON("/api/sombra/agenda", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clave, ...cambio }),
          validar: (d) => (d as { ok?: boolean })?.ok === true,
        });
        if (avanzar) mover(1);
      } catch (e) {
        setDatos((prev) => (prev ? { ...prev, candidatos: prev.candidatos.map((c) => (c.clave === clave ? antes : c)) } : prev));
        toast.error(mensajeDeError(e));
      } finally {
        setGuardando(false);
      }
    },
    [todos, mover],
  );

  const etiquetar = useCallback(
    (e: EtiquetaAgenda) => {
      if (!actual) return;
      // Pulsar la que ya está puesta la quita: corregirse no exige recargar.
      void guardar(actual.clave, { etiqueta: actual.etiqueta === e ? null : e }, actual.etiqueta !== e);
    },
    [actual, guardar],
  );

  // Teclado: etiquetar 80 mensajes con el ratón es lo que hace que un corpus
  // se quede a medias.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === "1" || ev.key === "2" || ev.key === "3") {
        ev.preventDefault();
        etiquetar(ETIQUETAS_AGENDA[Number(ev.key) - 1]!);
      } else if (ev.key === "r" || ev.key === "R") {
        ev.preventDefault();
        if (actual) void guardar(actual.clave, { seArroga: actual.seArroga === true ? null : true }, false);
      } else if (ev.key === "j" || ev.key === "ArrowDown") {
        ev.preventDefault();
        mover(1);
      } else if (ev.key === "k" || ev.key === "ArrowUp") {
        ev.preventDefault();
        mover(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [etiquetar, mover, actual, guardar]);

  const r = datos?.resumen;
  const pct = r && r.candidatos > 0 ? Math.round((r.etiquetados / r.candidatos) * 100) : 0;

  return (
    <div className="p-4 lg:p-6">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Calendar size={18} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">Agenda · etiquetar el corpus</h1>
          <StatePill variant="info" size="md" title="Aquí no se ve lo que opina la revisión de seguridad: la vara tiene que ser independiente de lo que mide.">
            A ciegas
          </StatePill>
        </div>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{LA_PREGUNTA}</p>
      </header>

      {cargando && !datos ? (
        <CardListSkeleton rows={4} />
      ) : error && !datos ? (
        <ErrorState title="No se pudo cargar el corpus de agenda" detail={error} onRetry={() => void cargar()} />
      ) : !todos.length ? (
        <EmptyState
          icon={<ListChecks size={20} strokeWidth={ICON_STROKE} aria-hidden />}
          title="Ningún mensaje menciona un día, una hora ni una reserva"
          hint="El corpus se arma con lo que ya hay en la sombra: juega hilos (npm run sombra:hilos) y vuelve."
        />
      ) : (
        <div className="space-y-4">
          {error && (
            <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-muted)]">
              Lo que ves es lo último que se pudo cargar — {error}
            </p>
          )}

          <Card padding="sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-display text-base font-semibold tabular-nums text-[var(--color-foreground)]">
                  {r?.etiquetados ?? 0} de {r?.candidatos ?? 0}
                </span>
                <span className="text-[var(--color-muted)]">etiquetados · {r?.hilos ?? 0} conversaciones</span>
                {r && (
                  <span className="flex items-center gap-1.5">
                    <StatePill variant="danger">afirma {r.afirma}</StatePill>
                    <StatePill variant="success">repite {r.repite}</StatePill>
                    <StatePill variant="neutral">ninguno {r.ninguno}</StatePill>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] p-0.5">
                {(["pendientes", "todos", "etiquetados"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFiltro(f)}
                    className={`h-8 rounded-md px-3 text-sm transition-colors ${filtro === f ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}
                  >
                    {f === "pendientes" ? "Sin etiquetar" : f === "todos" ? "Todos" : "Etiquetados"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
              <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${pct}%` }} />
            </div>
            {/* Por material: los cuatro guiones son muchos mensajes de pocas
                situaciones y van al final de la lista; desde aquí se eligen. */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOrigen("todos")}
                className={`h-8 rounded-lg border px-3 text-sm transition-colors ${origen === "todos" ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}
              >
                Todo el material
              </button>
              {ORIGENES_CORPUS.map((o) => {
                const x = r?.porOrigen?.[o];
                if (!x || x.candidatos === 0) return null;
                return (
                  <button
                    key={o}
                    type="button"
                    title={ETIQUETA_ORIGEN_CORPUS[o].que}
                    onClick={() => setOrigen(o)}
                    className={`h-8 rounded-lg border px-3 text-sm transition-colors ${origen === o ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}
                  >
                    {ETIQUETA_ORIGEN_CORPUS[o].etiqueta}{" "}
                    <span className="tabular-nums opacity-70">
                      {x.etiquetados}/{x.candidatos}
                    </span>
                    <span className="ml-1 text-xs opacity-60">· {x.hilos} {x.hilos === 1 ? "conversación" : "conversaciones"}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            {/* En móvil, primero el mensaje que se etiqueta y la lista debajo:
                con la lista arriba hay que pasar 70vh de scroll para llegar a
                los botones. En escritorio, lista a la izquierda. */}
            <Card padding="none" className="order-2 max-h-[40vh] overflow-auto lg:order-1 lg:max-h-[70vh]">
              {lista.length === 0 ? (
                <p className="p-4 text-sm text-[var(--color-muted)]">No queda ninguno con este filtro.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {lista.map((c) => (
                    <li key={c.clave}>
                      <button
                        type="button"
                        onClick={() => setSeleccion(c.clave)}
                        className={`w-full px-3 py-2.5 text-left transition-colors ${c.clave === seleccion ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-surface-muted)]"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-[var(--color-muted)]">{c.hilo}</span>
                          {c.etiqueta ? (
                            <StatePill variant={VARIANTE_ETIQUETA[c.etiqueta]}>{DEFINICION_ETIQUETA[c.etiqueta].etiqueta}</StatePill>
                          ) : (
                            <span className="text-[10px] text-[var(--color-muted)]">
                              {c.origen === "guiones" ? `Guion · ${c.decisor}` : ETIQUETA_FUENTE[c.fuente]}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-sm text-[var(--color-foreground)]">{c.texto}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div ref={detalleRef} className="order-1 overflow-auto lg:order-2 lg:max-h-[70vh]">
              {actual ? <Detalle c={actual} guardando={guardando} nota={nota} setNota={setNota} etiquetar={etiquetar} guardar={guardar} /> : null}
            </div>
          </div>

          <p className="text-xs text-[var(--color-muted)]">
            Teclado: <kbd className="rounded border border-[var(--color-border)] px-1">1</kbd> afirma ·{" "}
            <kbd className="rounded border border-[var(--color-border)] px-1">2</kbd> repite ·{" "}
            <kbd className="rounded border border-[var(--color-border)] px-1">3</kbd> ninguno ·{" "}
            <kbd className="rounded border border-[var(--color-border)] px-1">R</kbd> se arroga reservar ·{" "}
            <kbd className="rounded border border-[var(--color-border)] px-1">J</kbd>/
            <kbd className="rounded border border-[var(--color-border)] px-1">K</kbd> moverse
          </p>
        </div>
      )}
    </div>
  );
}

function Detalle({
  c,
  guardando,
  nota,
  setNota,
  etiquetar,
  guardar,
}: {
  c: CandidatoAgenda;
  guardando: boolean;
  nota: string;
  setNota: (s: string) => void;
  etiquetar: (e: EtiquetaAgenda) => void;
  guardar: (clave: string, cambio: { etiqueta?: EtiquetaAgenda | null; seArroga?: boolean | null; nota?: string | null }, avanzar: boolean) => void;
}) {
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-base font-semibold text-[var(--color-foreground)]">{c.hilo}</span>
        <StatePill variant="neutral" size="md" title={ETIQUETA_ORIGEN_CORPUS[c.origen].que}>
          {ETIQUETA_ORIGEN_CORPUS[c.origen].etiqueta}
        </StatePill>
        <StatePill variant={c.fuente === "codigo" ? "info" : "neutral"} size="md">
          {c.origen === "guiones" ? `Decisor: ${c.decisor}` : ETIQUETA_FUENTE[c.fuente]}
        </StatePill>
        {c.senal.cuando.length > 0 && (
          <span className="text-xs text-[var(--color-muted)]">día u hora: {c.senal.cuando.join(" · ")}</span>
        )}
      </div>

      {/* El hilo alrededor: sin él la pregunta no se puede contestar, porque lo
          que decide es si el día lo trajo ELLA o se lo inventó el agente. */}
      {c.aviso && (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-muted)]">
          {c.aviso}
        </p>
      )}

      <div className="space-y-2 rounded-xl border border-[var(--color-border)] p-3">
        {c.mensajes.map((m, i) =>
          m.esElCandidato ? (
            <div key={i} className="rounded-lg border-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-accent)]">
                Agente · el mensaje que se etiqueta
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--color-foreground)]">{m.texto}</p>
            </div>
          ) : m.quien === "paciente" ? (
            <div key={i} className="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                {c.persona ? c.persona.split(" ")[0] : "Paciente"}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--color-foreground)]">{m.texto}</p>
            </div>
          ) : (
            <div key={i} className="rounded-lg px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                {m.quien === "clinica" ? "La clínica escribió sola" : "Agente"}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--color-muted)]">{m.texto}</p>
            </div>
          ),
        )}
      </div>

      <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
        <p className="text-sm text-[var(--color-foreground)]">{LA_PREGUNTA}</p>
        <div className="flex flex-wrap gap-2">
          {ETIQUETAS_AGENDA.map((e) => {
            const activo = c.etiqueta === e;
            return (
              <button
                key={e}
                type="button"
                disabled={guardando}
                title={DEFINICION_ETIQUETA[e].que}
                onClick={() => etiquetar(e)}
                className={`h-10 rounded-lg border px-3 text-sm transition-colors disabled:opacity-60 ${activo ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"}`}
              >
                <span className="mr-1.5 text-xs opacity-70">{ATAJO[e]}</span>
                {DEFINICION_ETIQUETA[e].etiqueta}
              </button>
            );
          })}
        </div>
        {/* Las tres, siempre, y en una línea: enseñar solo la definición de una
            de ellas mientras se decide es empujar hacia esa. */}
        <p className="text-xs text-[var(--color-muted)]">
          Afirma = se vuelve falso · Repite = sigue en pie · Ninguno = no habla de la agenda de la clínica
        </p>
      </div>

      {/* La SEGUNDA pregunta, aparte. Fundirla con la primera es la enfermedad
          que este rediseño deshace: son dos daños distintos. */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3">
        <span className="text-sm text-[var(--color-foreground)]">¿Se arroga el agente el poder de reservar?</span>
        <div className="flex gap-2">
          {([true, false] as const).map((v) => {
            const activo = c.seArroga === v;
            return (
              <button
                key={String(v)}
                type="button"
                disabled={guardando}
                onClick={() => guardar(c.clave, { seArroga: activo ? null : v }, false)}
                className={`h-9 rounded-lg border px-3 text-sm transition-colors disabled:opacity-60 ${activo ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"}`}
              >
                {v ? (
                  <span className="inline-flex items-center gap-1">
                    <Check size={14} strokeWidth={ICON_STROKE} aria-hidden /> Sí
                  </span>
                ) : (
                  "No"
                )}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-[var(--color-muted)]">Opcional · tecla R</span>
      </div>

      <input
        type="text"
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        onBlur={() => {
          if ((c.nota ?? "") !== nota) guardar(c.clave, { nota: nota.trim() || null }, false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="Nota (opcional) — por qué, si el caso es raro"
        maxLength={600}
        className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)]"
      />
    </Card>
  );
}
