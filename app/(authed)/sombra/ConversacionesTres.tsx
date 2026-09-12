"use client";
// app/(authed)/sombra/ConversacionesTres.tsx
//
// TRES CONVERSACIONES POR GUION (049, 12-09-2026). Instrumentación de
// desarrollo, bajo el mismo candado que /sombra. Para cada guion, tres
// conversaciones enteras en paralelo — el código, el modelo con contexto y
// el modelo libre — cada una conducida por su decisor de principio a fin,
// con el paciente simulado reaccionando a ESE decisor. Encima de cada hilo,
// el resumen: en cuántos mensajes pasó el caso a una persona, con qué
// motivo, con qué datos, y cómo terminó el paciente. Dentro, el momento
// exacto en que pasa el caso va marcado. Simon lee los tres y dice cuál
// habría preferido recibir como paciente.
//
// Solo importa del módulo PURO (actos.ts).

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "../../components/ui/Card";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { StatePill } from "../../components/ui/StatePill";
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { AlertTriangle, Flag, RefreshCw, ICON_STROKE } from "../../components/icons";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import {
  DECISORES,
  DEFINICION_ACTO,
  ETIQUETA_DECISOR,
  ETIQUETA_FIN,
  PREFERIDOS_TRES,
  type Decisor,
  type GuionTres,
  type HiloTres,
  type MensajeTres,
  type PreferidoTres,
} from "../../lib/agente/actos";

type Respuesta = { guiones: GuionTres[] };

const ETIQUETA_PREFERIDO: Record<PreferidoTres, string> = { ...ETIQUETA_DECISOR, ninguno: "Ninguna" };

function resumenCorto(h: HiloTres | undefined): string {
  if (!h) return "sin jugar";
  const r = h.resumen;
  if (r.fin === "derivado" && r.derivoEn != null) return `pasó en ${r.derivoEn}`;
  if (r.fin === "resuelto") return "resuelto";
  return "perdido";
}

export function ConversacionesTres() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await cargarJSON<Respuesta>("/api/sombra?vista=conversaciones", { validar: (d) => Array.isArray((d as Respuesta)?.guiones) });
      setDatos(r);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const guiones = datos?.guiones ?? [];
  useEffect(() => {
    if (guiones.length && (seleccionado == null || !guiones.some((g) => g.guionId === seleccionado))) setSeleccionado(guiones[0]!.guionId);
  }, [guiones, seleccionado]);
  const guion = guiones.find((g) => g.guionId === seleccionado) ?? null;

  const guardar = async (g: GuionTres, preferido: PreferidoTres | null, nota: string | null) => {
    try {
      await cargarJSON<{ ok: true }>("/api/sombra", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guionId: g.guionId, preferido, nota }),
        validar: (d) => (d as { ok?: boolean })?.ok === true,
      });
      setDatos((prev) =>
        prev ? { guiones: prev.guiones.map((x) => (x.guionId === g.guionId ? { ...x, preferido, nota, preferidoEn: new Date().toISOString() } : x)) } : prev,
      );
      toast.success(preferido == null && !nota ? "Veredicto quitado" : "Veredicto guardado");
    } catch (e) {
      toast.error(mensajeDeError(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-muted)]">
        <span>
          {guiones.length} guiones · {guiones.filter((g) => g.preferido != null).length} con veredicto. Cada guion: tres conversaciones enteras, una por decisor, con el mismo primer mensaje.
        </span>
        <button
          type="button"
          onClick={() => void cargar()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
        >
          <RefreshCw size={14} strokeWidth={ICON_STROKE} className={cargando ? "animate-spin" : ""} />
          Actualizar
        </button>
      </div>

      {error && <ErrorState title="No se pudieron leer las conversaciones" detail={error} onRetry={() => void cargar()} />}
      {!datos && !error && <CardListSkeleton rows={4} />}

      {datos && guiones.length === 0 && (
        <EmptyState title="Todavía no hay conversaciones jugadas" hint="Se juegan con «npm run hilos:tres» (tres por guion; --estimar dice el coste antes)." />
      )}

      {datos && guiones.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-2 lg:max-h-[calc(100vh-240px)] lg:overflow-y-auto lg:pr-1">
            {guiones.map((g) => {
              const activo = g.guionId === seleccionado;
              return (
                <button
                  key={g.guionId}
                  type="button"
                  onClick={() => setSeleccionado(g.guionId)}
                  className={`block w-full rounded-xl border px-3 py-2 text-left transition-colors ${activo ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)]"}`}
                >
                  <div className="truncate text-sm font-medium text-[var(--color-foreground)]">{g.titulo}</div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {DECISORES.map((d) => `${d === "codigo" ? "código" : d}: ${resumenCorto(g.hilos[d])}`).join(" · ")}
                    {g.preferido && <span className="text-[var(--color-accent)]"> · prefiere {ETIQUETA_PREFERIDO[g.preferido].toLowerCase()}</span>}
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="min-w-0 space-y-3">
            {guion && (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-[family-name:var(--font-geist-sans)] text-base font-semibold text-[var(--color-foreground)]">{guion.titulo}</h2>
                  <span className="text-xs text-[var(--color-muted)]">{guion.categoria}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {DECISORES.map((d) => (
                    <Columna key={d} decisor={d} hilo={guion.hilos[d]} />
                  ))}
                </div>
                <Veredicto key={guion.guionId} guion={guion} onGuardar={guardar} />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Columna({ decisor, hilo }: { decisor: Decisor; hilo: HiloTres | undefined }) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{ETIQUETA_DECISOR[decisor]}</div>
      {!hilo ? (
        <Card padding="md" className="text-sm text-[var(--color-muted)]">Sin jugar.</Card>
      ) : (
        <>
          <Resumen hilo={hilo} />
          <div className="space-y-2">
            {hilo.mensajes.map((m, i) => (
              <Burbuja key={i} m={m} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Resumen({ hilo }: { hilo: HiloTres }) {
  const r = hilo.resumen;
  const variante = r.fin === "derivado" ? "info" : r.fin === "resuelto" ? "success" : "danger";
  return (
    <Card padding="md" className="space-y-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatePill variant={variante} size="md">{ETIQUETA_FIN[r.fin]}</StatePill>
        {r.porHecho && (
          <StatePill variant="warning" size="sm" title="La entrega la forzó un hecho (urgencia, queja, mensaje no legible), no el decisor">
            por hecho
          </StatePill>
        )}
      </div>
      <p className="font-medium text-[var(--color-foreground)]">
        {r.derivoEn != null ? `Pasó el caso en ${r.derivoEn} mensaje${r.derivoEn === 1 ? "" : "s"}` : `No pasó el caso en ${r.turnos} mensaje${r.turnos === 1 ? "" : "s"}`}
        {r.repeticiones > 0 ? ` · el paciente repitió ${r.repeticiones} ${r.repeticiones === 1 ? "vez" : "veces"}` : ""}
        {r.molestiaEn != null ? ` · molestia en el mensaje ${r.molestiaEn}` : ""}
      </p>
      {r.motivo && <p className="text-xs text-[var(--color-muted)]">Motivo: {r.motivo}</p>}
      {r.detalleFin && <p className="text-xs text-[var(--color-muted)]">{r.detalleFin}</p>}
      <p className="text-xs text-[var(--color-muted)]">
        {r.datos.length ? `Llegó con: ${r.datos.join(" · ")}` : "Llegó sin datos recogidos"}
        {r.aplazados.length ? ` · anotado: ${r.aplazados.join(", ")}` : ""}
      </p>
      <p className="text-[11px] text-[var(--color-muted)]">${r.costeUsd.toFixed(3)} · versión {hilo.version}</p>
    </Card>
  );
}

function Burbuja({ m }: { m: MensajeTres }) {
  if (m.quien === "cadencia") {
    return <p className="px-2 text-xs italic text-[var(--color-muted)]">Mensaje automático de la clínica: {m.texto}</p>;
  }
  if (m.quien === "paciente") {
    return (
      <div className="mr-6 rounded-xl bg-[var(--color-surface-muted)] px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Paciente · {m.n}</div>
        <p className="whitespace-pre-wrap text-sm text-[var(--color-foreground)]">{m.texto}</p>
      </div>
    );
  }
  const acto = m.acto && m.acto !== "ilegible" ? DEFINICION_ACTO[m.acto].etiqueta : m.acto === "ilegible" ? "acto ilegible" : null;
  return (
    <div className={`ml-6 rounded-xl px-3 py-2 ${m.deriva ? "border border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "bg-[var(--color-accent-soft)]"}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        <span>Agente{acto ? ` · ${acto}` : ""}</span>
        {m.deriva && (
          <span className="inline-flex items-center gap-1 normal-case tracking-normal text-[var(--color-accent)]">
            <Flag size={11} strokeWidth={ICON_STROKE} aria-hidden />
            Pasa a una persona{m.motivo ? ` · ${m.motivo}` : ""}
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm text-[var(--color-foreground)]">{m.texto || "(sin mensaje)"}</p>
      {m.veto && (
        <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle size={12} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" aria-hidden />
          <span>{m.veto}</span>
        </p>
      )}
    </div>
  );
}

function Veredicto({ guion, onGuardar }: { guion: GuionTres; onGuardar: (g: GuionTres, p: PreferidoTres | null, nota: string | null) => Promise<void> }) {
  // El padre lo monta con key=guionId: al cambiar de guion se reinicia solo.
  const [nota, setNota] = useState(guion.nota ?? "");
  const [guardando, setGuardando] = useState(false);
  const elegir = async (p: PreferidoTres) => {
    setGuardando(true);
    await onGuardar(guion, guion.preferido === p ? null : p, nota.trim() || null);
    setGuardando(false);
  };
  const guardarNota = async () => {
    const limpia = nota.trim() || null;
    if ((guion.nota ?? null) === limpia) return;
    setGuardando(true);
    await onGuardar(guion, guion.preferido, limpia);
    setGuardando(false);
  };
  return (
    <Card padding="md" className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-[var(--color-muted)]">Como paciente habría preferido:</span>
      {PREFERIDOS_TRES.map((p) => (
        <button
          key={p}
          type="button"
          disabled={guardando}
          onClick={() => void elegir(p)}
          className={`h-9 rounded-lg border px-3 text-sm transition-colors disabled:opacity-60 ${guion.preferido === p ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"}`}
        >
          {ETIQUETA_PREFERIDO[p]}
        </button>
      ))}
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
    </Card>
  );
}
