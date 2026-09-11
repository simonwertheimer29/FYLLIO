"use client";
// app/(authed)/analiticas/conversacion/ConversacionView.tsx
//
// «Qué dicen» (2.1, MEJORAS 176): lo que los pacientes le dicen al agente en
// la ventana, agregado por conversación —decisión, objeciones, motivos de
// rechazo, cuándo retomar, qué preguntan, por qué se entrega, qué buscan y con
// qué urgencia— comparado con la ventana anterior. Los cubos salen del mismo
// vocabulario que los modales de cierre; «Otro» trae las frases literales,
// que es donde está lo que el vocabulario aún no nombra.
//
// Regla A: una línea explica; el criterio de cada bloque va en el title.

import { useCallback, useEffect, useState } from "react";
import { Card } from "../../../components/ui/Card";
import { ErrorState } from "../../../components/ui/Feedback";
import { MessageCircle, Minus, RefreshCw, TrendingDown, TrendingUp, ICON_STROKE } from "../../../components/icons";
import { cargarJSON, mensajeDeError } from "../../../lib/fetch-json";
import { ETIQUETA_CAUSA } from "../../../components/agente/etiquetas-agente";
// Del módulo PURO, nunca de `conversacion.ts`: aquello arrastraría pg al navegador.
import {
  COPY_BLOQUE,
  ORDEN_BLOQUES,
  VENTANAS_CONVERSACION,
  VENTANA_CONVERSACION_DEFAULT,
  type Bloque,
  type BloqueId,
  type Conversacion,
  type VentanaConversacion,
} from "../../../lib/metricas/conversacion.tipos";

type Respuesta = Conversacion & { clinicas: { id: string; nombre: string }[]; puedeRed: boolean; clinicaId: string };

const fmtN = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export function ConversacionView() {
  const [clinicaId, setClinicaId] = useState<string | null>(null);
  const [dias, setDias] = useState<VentanaConversacion>(VENTANA_CONVERSACION_DEFAULT);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ dias: String(dias) });
      if (clinicaId) qs.set("clinicaId", clinicaId);
      const r = await cargarJSON<Respuesta>(`/api/metricas/conversacion?${qs.toString()}`, {
        validar: (d) => typeof (d as Respuesta)?.bloques === "object" && Array.isArray((d as Respuesta)?.clinicas),
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
          <h1 className="font-[family-name:var(--font-geist-sans)] text-xl font-semibold text-[var(--color-foreground)]">Qué dicen</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Lo que los pacientes le dicen al agente: decisiones, objeciones, preguntas y lo que buscan.</p>
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

      {error && <ErrorState title="No se pudo leer lo que dicen" detail={error} onRetry={() => void cargar()} />}

      {!datos && !error && <Esqueleto />}

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
                {VENTANAS_CONVERSACION.map((d) => (
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
              Del {fechaCorta(datos.ventana.desde)} al {fechaCorta(datos.ventana.hasta)} (días completos, hasta ayer) · comparado con del{" "}
              {fechaCorta(datos.ventanaPrevia.desde)} al {fechaCorta(datos.ventanaPrevia.hasta)}
            </p>
          </section>

          <Titular datos={datos} />

          {datos.conversaciones.n === 0 ? (
            <Card padding="lg">
              <p className="text-sm text-[var(--color-muted)]">
                El agente no tuvo ninguna conversación del {fechaCorta(datos.ventana.desde)} al {fechaCorta(datos.ventana.hasta)}. Cuando conteste, aquí se verá lo que le
                dicen.
              </p>
            </Card>
          ) : (
            <div className={`grid gap-4 lg:grid-cols-2 xl:grid-cols-3 min-[2100px]:grid-cols-4 ${cargando ? "opacity-60" : ""}`}>
              {ORDEN_BLOQUES.map((id) => (
                <TarjetaBloque key={id} id={id} bloque={datos.bloques[id]} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Titular({ datos }: { datos: Respuesta }) {
  const c = datos.conversaciones;
  const celdas: Array<{ etiqueta: string; n: number; previo: number; nota: string }> = [
    { etiqueta: "Conversaciones con el agente", n: c.n, previo: c.previo, nota: `en ${datos.ventana.dias} días` },
    { etiqueta: "Decidieron sobre un presupuesto", n: datos.bloques.decision.n, previo: datos.bloques.decision.previo, nota: "acepta, se lo piensa o rechaza" },
    { etiqueta: "Pidieron cita", n: datos.bloques.buscan.n, previo: datos.bloques.buscan.previo, nota: "dijeron qué buscan" },
  ];
  return (
    <Card padding="lg">
      <div className="grid gap-4 sm:grid-cols-3">
        {celdas.map((x) => (
          <div key={x.etiqueta}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{x.etiqueta}</div>
            <div className="mt-1 font-[family-name:var(--font-geist-sans)] text-4xl font-bold tabular-nums tracking-tight text-[var(--color-foreground)]">
              {fmtN.format(x.n)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-muted)]">
              <span>{x.nota}</span>
              <Delta n={x.n} previo={x.previo} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Sin color: aquí subir no es bueno ni malo, es lo que dijeron. */
function Delta({ n, previo }: { n: number; previo: number }) {
  const d = n - previo;
  const Icono = d === 0 ? Minus : d > 0 ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 text-xs tabular-nums text-[var(--color-muted)]" title="Frente a la ventana anterior, de la misma duración.">
      <Icono size={13} strokeWidth={ICON_STROKE} aria-hidden />
      {d > 0 ? "+" : ""}
      {fmtN.format(d)} vs. {fmtN.format(previo)}
    </span>
  );
}

function TarjetaBloque({ id, bloque }: { id: BloqueId; bloque: Bloque }) {
  const copy = COPY_BLOQUE[id];
  const max = Math.max(1, ...bloque.cubos.map((c) => c.n));
  const vacio = bloque.n === 0;
  return (
    <Card padding="lg" className={vacio ? "opacity-80" : ""}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-[family-name:var(--font-geist-sans)] text-base font-semibold text-[var(--color-foreground)]" title={copy.detalle}>
          {copy.titulo}
        </h2>
        <div className="flex shrink-0 flex-col items-end">
          <span className="font-[family-name:var(--font-geist-sans)] text-2xl font-bold tabular-nums tracking-tight text-[var(--color-foreground)]">
            {fmtN.format(bloque.n)}
          </span>
          <Delta n={bloque.n} previo={bloque.previo} />
        </div>
      </div>
      {vacio ? (
        <p className="mt-3 text-sm text-[var(--color-muted)]">Nada anotado en esta ventana.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {bloque.cubos
            .filter((c) => c.n > 0 || c.previo > 0)
            .map((c) => (
              <li key={c.clave}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-[var(--color-foreground)]">{id === "entregas" ? (ETIQUETA_CAUSA[c.clave] ?? c.etiqueta) : c.etiqueta}</span>
                  <span className="shrink-0 tabular-nums">
                    <b className="font-semibold text-[var(--color-foreground)]">{fmtN.format(c.n)}</b>
                    {c.previo !== c.n && <span className="text-[var(--color-muted)]"> · antes {fmtN.format(c.previo)}</span>}
                  </span>
                </div>
                <div className="mt-1 h-[5px] overflow-hidden rounded-sm bg-[var(--color-border)]">
                  <div className={`h-full rounded-sm ${c.clave === "otro" ? "bg-[var(--color-muted)]" : "bg-[var(--color-accent)]"}`} style={{ width: `${(c.n / max) * 100}%` }} />
                </div>
                {c.ejemplos.length > 0 && (
                  <p
                    className="mt-1 flex items-start gap-1 truncate text-[12px] text-[var(--color-muted)]"
                    title={c.ejemplos.length > 1 ? c.ejemplos.map((e) => `«${e}»`).join("\n") : undefined}
                  >
                    <MessageCircle size={12} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" aria-hidden />
                    <span className="truncate">
                      «{c.ejemplos[0]}»{c.ejemplos.length > 1 ? ` y ${c.ejemplos.length - 1} más` : ""}
                    </span>
                  </p>
                )}
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-4">
      <div className="fyllio-skeleton h-20" />
      <div className="fyllio-skeleton h-28" />
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="fyllio-skeleton h-44" />
        ))}
      </div>
    </div>
  );
}
