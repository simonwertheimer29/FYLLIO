"use client";
// app/(authed)/sombra/SombraView.tsx
//
// LA SOMBRA — instrumentación de desarrollo (fase 1, 11-09-2026). NO es
// producto: no está en el menú y solo existe para quien pasa esVisorSombra.
// Enseña, turno a turno y en orden de conversación: la situación en palabras
// del modelo, el acto que eligió, el que hizo el código y —si difieren— el
// mensaje que el modelo habría escrito. Y recoge el veredicto de Simon, caso a
// caso. Los desacuerdos son el dato, no un error: aquí no se puntúa nada.
//
// Solo importa del módulo PURO (actos.ts): sombra.ts arrastraría pg al navegador.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "../../components/ui/Card";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { StatePill } from "../../components/ui/StatePill";
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { AlertTriangle, RefreshCw, Sparkles, ICON_STROKE } from "../../components/icons";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import {
  DEFINICION_ACTO,
  ETIQUETA_ORIGEN,
  ETIQUETA_VARIANTE,
  ETIQUETA_VEREDICTO,
  VEREDICTOS_SOMBRA,
  type Acto,
  type HiloSombra,
  type TurnoSombra,
  type VeredictoSombra,
} from "../../lib/agente/actos";

import { ConversacionesTres } from "./ConversacionesTres";

type Respuesta = { hilos: HiloSombra[]; activa: boolean; version: string };
type FiltroOrigen = "todos" | "produccion" | "hilos_jugados";
type Vista = "turnos" | "conversaciones";

const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function etiquetaActo(a: Acto | "ilegible", crudo?: string | null): string {
  if (a === "ilegible") return `Acto ilegible${crudo ? ` («${crudo}»)` : ""}`;
  return DEFINICION_ACTO[a].etiqueta;
}

function ActoPill({ acto, crudo, destacado }: { acto: Acto | "ilegible"; crudo?: string | null; destacado?: boolean }) {
  const title = acto === "ilegible" ? "El modelo devolvió un acto fuera del catálogo" : DEFINICION_ACTO[acto].que;
  return (
    <StatePill variant={acto === "ilegible" ? "danger" : destacado ? "info" : "neutral"} size="md" title={title}>
      {etiquetaActo(acto, crudo)}
    </StatePill>
  );
}

function decisionTexto(t: TurnoSombra): string {
  const d = t.decisionCodigo;
  if (!d) return "";
  const partes: string[] = [d.decision === "deriva" ? `entrega${d.causa ? ` · ${d.causa}` : ""}` : "sigue"];
  if (d.objetivo) partes.push(`objetivo ${d.objetivo}`);
  if (d.faltan.length) partes.push(`faltan ${d.faltan.join(", ")}`);
  if (d.descarte) partes.push(`borrador descartado (${d.descarte})`);
  if (d.poda) partes.push(`frase podada (${d.poda}), el resto se envió`);
  return partes.join(" · ");
}

export function SombraView() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [soloDesacuerdos, setSoloDesacuerdos] = useState(false);
  const [origen, setOrigen] = useState<FiltroOrigen>("todos");
  // 049: «Turnos» (sombra turno a turno) o «Conversaciones» (tres hilos enteros por guion).
  const [vista, setVista] = useState<Vista>("turnos");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await cargarJSON<Respuesta>("/api/sombra", { validar: (d) => Array.isArray((d as Respuesta)?.hilos) });
      setDatos(r);
    } catch (e) {
      // Se conserva lo último bueno (§10).
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const hilos = useMemo(() => {
    const todos = datos?.hilos ?? [];
    return todos.filter((h) => (origen === "todos" || h.origen === origen) && (!soloDesacuerdos || h.desacuerdos > 0));
  }, [datos, origen, soloDesacuerdos]);

  useEffect(() => {
    if (hilos.length && (seleccionado == null || !hilos.some((h) => h.telefono === seleccionado))) {
      setSeleccionado(hilos[0]!.telefono);
    }
  }, [hilos, seleccionado]);

  const hilo = hilos.find((h) => h.telefono === seleccionado) ?? null;

  const resumen = useMemo(() => {
    const todos = datos?.hilos ?? [];
    const turnos = todos.reduce((s, h) => s + h.turnos.length, 0);
    const desacuerdos = todos.reduce((s, h) => s + h.desacuerdos, 0);
    const veredictos = todos.reduce((s, h) => s + h.turnos.filter((t) => t.veredicto != null).length, 0);
    const sinSombra = todos.reduce((s, h) => s + Math.max(0, h.turnosEvaluados - h.turnos.length), 0);
    return { hilos: todos.length, turnos, desacuerdos, veredictos, sinSombra };
  }, [datos]);

  const actualizarTurno = (id: string, cambio: Partial<TurnoSombra>) => {
    setDatos((prev) =>
      prev
        ? {
            ...prev,
            hilos: prev.hilos.map((h) => ({ ...h, turnos: h.turnos.map((t) => (t.id === id ? { ...t, ...cambio } : t)) })),
          }
        : prev,
    );
  };

  const guardarVeredicto = async (t: TurnoSombra, veredicto: VeredictoSombra | null, nota: string | null) => {
    try {
      await cargarJSON<{ ok: true }>("/api/sombra", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: t.id, veredicto, nota }),
        validar: (d) => (d as { ok?: boolean })?.ok === true,
      });
      actualizarTurno(t.id, { veredicto, veredictoNota: nota, veredictoEn: new Date().toISOString() });
      toast.success(veredicto == null && !nota ? "Veredicto quitado" : "Veredicto guardado");
    } catch (e) {
      toast.error(mensajeDeError(e));
    }
  };

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-geist-sans)] text-xl font-semibold text-[var(--color-foreground)]">Sombra del agente</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Instrumentación de desarrollo. El modelo elige su acto en paralelo; el código sigue decidiendo. Aquí se leen las dos versiones.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
            {(["turnos", "conversaciones"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                className={`h-8 rounded-md px-3 text-sm ${vista === v ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}
              >
                {v === "turnos" ? "Turnos" : "Conversaciones"}
              </button>
            ))}
          </div>
          {datos && vista === "turnos" && (
            <StatePill variant={datos.activa ? "success" : "warning"} size="md" title={`Versión del prompt de la sombra: ${datos.version}`}>
              {datos.activa ? "Sombra activa en este cliente" : "Sombra apagada en este cliente"}
            </StatePill>
          )}
          <button
            type="button"
            onClick={() => void cargar()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
          >
            <RefreshCw size={14} strokeWidth={ICON_STROKE} className={cargando ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>
      </header>

      {vista === "conversaciones" && <ConversacionesTres />}

      {vista === "turnos" && error && <ErrorState title="No se pudo leer la sombra" detail={error} onRetry={() => void cargar()} />}

      {vista === "turnos" && !datos && !error && <CardListSkeleton rows={4} />}

      {vista === "turnos" && datos && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
              {(["todos", "hilos_jugados", "produccion"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOrigen(o)}
                  className={`h-8 rounded-md px-3 text-sm ${origen === o ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}
                >
                  {o === "todos" ? "Todos" : ETIQUETA_ORIGEN[o]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSoloDesacuerdos((v) => !v)}
              className={`h-8 rounded-lg border px-3 text-sm ${soloDesacuerdos ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}
            >
              Solo desacuerdos
            </button>
            <span className="text-[var(--color-muted)]">
              {resumen.hilos} hilos · {resumen.turnos} turnos · {resumen.desacuerdos} desacuerdos
              {resumen.turnos ? ` (${Math.round((100 * resumen.desacuerdos) / resumen.turnos)} %)` : ""} · {resumen.veredictos} con veredicto
              {resumen.sinSombra ? ` · ${resumen.sinSombra} turnos sin sombra` : ""}
            </span>
          </div>

          {hilos.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={20} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" />}
              title="Todavía no hay turnos en sombra"
              hint="Se calculan al evaluar un mensaje en la demo o con «npm run sombra:hilos» sobre los hilos jugados."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="space-y-2 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1">
                {hilos.map((h) => {
                  const activo = h.telefono === seleccionado;
                  const sinSombra = Math.max(0, h.turnosEvaluados - h.turnos.length);
                  return (
                    <button
                      key={h.telefono}
                      type="button"
                      onClick={() => setSeleccionado(h.telefono)}
                      className={`block w-full rounded-xl border px-3 py-2 text-left transition-colors ${activo ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)]"}`}
                    >
                      <div className="truncate text-sm font-medium text-[var(--color-foreground)]">{h.etiqueta}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-muted)]">
                        <span>{ETIQUETA_ORIGEN[h.origen]}</span>
                        <span>· {h.turnos.length} turnos</span>
                        <span className={h.desacuerdos ? "text-[var(--color-accent)]" : ""}>· {h.desacuerdos} desacuerdos</span>
                        {sinSombra > 0 && <span className="text-amber-600 dark:text-amber-300">· {sinSombra} sin sombra</span>}
                      </div>
                    </button>
                  );
                })}
              </aside>

              <section className="min-w-0 space-y-3">
                {hilo && (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="font-[family-name:var(--font-geist-sans)] text-base font-semibold text-[var(--color-foreground)]">{hilo.etiqueta}</h2>
                      <span className="text-xs text-[var(--color-muted)]">
                        {hilo.telefono} · {hilo.turnos.length} turnos con sombra
                        {hilo.turnosEvaluados > hilo.turnos.length ? ` de ${hilo.turnosEvaluados} evaluados` : ""}
                      </span>
                    </div>
                    {hilo.turnos
                      .filter((t) => !soloDesacuerdos || !t.coinciden)
                      .map((t) => (
                        <Turno key={t.id} t={t} onVeredicto={guardarVeredicto} />
                      ))}
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Turno({ t, onVeredicto }: { t: TurnoSombra; onVeredicto: (t: TurnoSombra, v: VeredictoSombra | null, nota: string | null) => Promise<void> }) {
  const [nota, setNota] = useState(t.veredictoNota ?? "");
  const [guardando, setGuardando] = useState(false);

  const elegir = async (v: VeredictoSombra) => {
    setGuardando(true);
    await onVeredicto(t, t.veredicto === v ? null : v, nota.trim() || null);
    setGuardando(false);
  };
  const guardarNota = async () => {
    const limpia = nota.trim() || null;
    if ((t.veredictoNota ?? null) === limpia) return;
    setGuardando(true);
    await onVeredicto(t, t.veredicto, limpia);
    setGuardando(false);
  };

  return (
    <Card padding="md" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
        <span>
          {t.turno != null ? `Turno ${t.turno}` : "Turno"} · {fmtFecha(t.en)}
        </span>
        <span>
          {t.coinciden && (t.libre == null || t.libre.actoModelo === t.actoCodigo) ? (
            <StatePill variant="neutral" size="sm">Coinciden</StatePill>
          ) : (
            <StatePill variant="info" size="sm">Difieren</StatePill>
          )}
        </span>
      </div>

      <div className="rounded-xl bg-[var(--color-surface-muted)] px-3 py-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{t.persona ? t.persona.split(" ")[0] : "Paciente"}</div>
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--color-foreground)]">{t.entrante}</p>
      </div>

      <div className="flex items-start gap-2 text-sm">
        <Sparkles size={14} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
        <p className="italic text-[var(--color-foreground)]">{t.situacion}</p>
      </div>

      {t.libre ? (
        // Tres columnas (048): el código, el modelo con el contexto de
        // producción y el modelo libre. Siempre las tres: Simon compara mensajes.
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2 rounded-xl border border-[var(--color-border)] p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Hizo el código</div>
            <ActoPill acto={t.actoCodigo} />
            {decisionTexto(t) && <p className="text-xs text-[var(--color-muted)]">{decisionTexto(t)}</p>}
            <Mensaje texto={t.mensajeCodigo} />
          </div>
          <div className={`space-y-2 rounded-xl border p-3 ${t.coinciden ? "border-[var(--color-border)]" : "border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]"}`}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{ETIQUETA_VARIANTE.produccion}</div>
            <ActoPill acto={t.actoModelo} crudo={t.actoCrudo} destacado={!t.coinciden} />
            {t.porQue && <p className="text-xs text-[var(--color-muted)]">{t.porQue}</p>}
            <Mensaje texto={t.mensajeModelo} veto={t.vetoModelo} />
          </div>
          <div className={`space-y-2 rounded-xl border p-3 ${t.libre.actoModelo === t.actoCodigo ? "border-[var(--color-border)]" : "border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]"}`}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-accent)]">{ETIQUETA_VARIANTE.libre}</div>
            <ActoPill acto={t.libre.actoModelo} crudo={t.libre.actoCrudo} destacado={t.libre.actoModelo !== t.actoCodigo} />
            <p className="text-xs italic text-[var(--color-foreground)]">{t.libre.situacion}</p>
            {t.libre.conviene && <p className="text-xs text-[var(--color-muted)]">Le conviene: {t.libre.conviene}</p>}
            <Mensaje texto={t.libre.mensajeModelo} veto={t.libre.vetoModelo} />
          </div>
        </div>
      ) : t.coinciden ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ActoPill acto={t.actoCodigo} />
            <span className="text-xs text-[var(--color-muted)]">{decisionTexto(t)}</span>
          </div>
          <Mensaje titulo="Lo que salió" texto={t.mensajeCodigo} />
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]">Ver la redacción del modelo</summary>
            <div className="mt-2 space-y-1">
              {t.porQue && <p className="text-xs text-[var(--color-muted)]">{t.porQue}</p>}
              <Mensaje texto={t.mensajeModelo} veto={t.vetoModelo} />
            </div>
          </details>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-[var(--color-border)] p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Hizo el código</div>
            <ActoPill acto={t.actoCodigo} />
            {decisionTexto(t) && <p className="text-xs text-[var(--color-muted)]">{decisionTexto(t)}</p>}
            <Mensaje texto={t.mensajeCodigo} />
          </div>
          <div className="space-y-2 rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-accent)]">{ETIQUETA_VARIANTE.produccion}</div>
            <ActoPill acto={t.actoModelo} crudo={t.actoCrudo} destacado />
            {t.porQue && <p className="text-xs text-[var(--color-muted)]">{t.porQue}</p>}
            <Mensaje texto={t.mensajeModelo} veto={t.vetoModelo} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
        {VEREDICTOS_SOMBRA.map((v) => {
          const activo = t.veredicto === v;
          return (
            <button
              key={v}
              type="button"
              disabled={guardando}
              onClick={() => void elegir(v)}
              className={`h-9 rounded-lg border px-3 text-sm transition-colors disabled:opacity-60 ${activo ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"}`}
            >
              {ETIQUETA_VEREDICTO[v]}
            </button>
          );
        })}
        <input
          type="text"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onBlur={() => void guardarNota()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="Nota (opcional)"
          maxLength={600}
          className="h-9 min-w-[200px] flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)]"
        />
      </div>

      <details className="text-xs text-[var(--color-muted)]">
        <summary className="cursor-pointer hover:text-[var(--color-foreground)]">
          Técnico · {t.modelo ?? "modelo desconocido"}
          {t.latenciaMs != null ? ` · ${(t.latenciaMs / 1000).toFixed(1)} s` : ""}
          {t.costeUsd != null ? ` · $${t.costeUsd.toFixed(4)}` : ""} · sombra {t.versionSombra}
          {t.versionEvaluador ? ` · evaluador ${t.versionEvaluador}` : ""}
        </summary>
        {t.entrada ? (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-muted)] p-2 text-[11px] leading-snug text-[var(--color-foreground)]">{t.entrada}</pre>
        ) : (
          <p className="mt-2">Sin la entrada renderizada.</p>
        )}
        {t.libre?.entrada && (
          <>
            <p className="mt-2">
              Lo que vio el modelo libre · {t.libre.modelo ?? "modelo desconocido"}
              {t.libre.latenciaMs != null ? ` · ${(t.libre.latenciaMs / 1000).toFixed(1)} s` : ""}
              {t.libre.costeUsd != null ? ` · $${t.libre.costeUsd.toFixed(4)}` : ""} · sombra libre {t.libre.versionSombra}
            </p>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-muted)] p-2 text-[11px] leading-snug text-[var(--color-foreground)]">{t.libre.entrada}</pre>
          </>
        )}
      </details>
    </Card>
  );
}

function Mensaje({ titulo, texto, veto }: { titulo?: string; texto: string; veto?: string | null }) {
  return (
    <div className="space-y-1">
      {titulo && <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{titulo}</div>}
      <p className="whitespace-pre-wrap rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-sm text-[var(--color-foreground)]">{texto || "—"}</p>
      {veto && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle size={12} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" aria-hidden />
          <span>La revisión de seguridad lo pararía: «{veto}»</span>
        </p>
      )}
    </div>
  );
}
