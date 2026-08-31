"use client";

// B6.4 (18-08) — LA COLA ÚNICA DE ENVÍOS. Una pantalla para todo mensaje
// propuesto, con filtro por tipo (decisión dictada: no una pantalla por tipo).
//
// Reglas de la pantalla, todas dictadas:
//  · ENVÍO UNO A UNO, nunca en bloque: en modo A la coordinadora firma con su
//    nombre lo que sale — el texto completo está a la vista y se envía leído.
//    «Enviar» registra el mensaje y abre WhatsApp con el texto puesto.
//  · La cola es DEL DÍA: lo de ayer caduca y SE VE (es la medida del equipo).
//  · ESTADOS HONESTOS: Pendiente/Enviado/Fallido/Cancelado/Caducado. Nada de
//    «entregado» o «leído» mientras el webhook no procese statuses de Meta.
//  · Opción (b): un hueco sin plantilla no genera — el aviso lo dice claro.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronLeft,
  CalendarClock,
  Hourglass,
  Phone,
  RefreshCw,
  Send,
  ICON_STROKE,
} from "../../components/icons";
import { StatePill, type StatePillVariant } from "../../components/ui/StatePill";
import { EmptyState, ErrorState } from "../../components/ui/Feedback";
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { cargarJSON } from "../../lib/fetch-json";
import { fechaHoraClinica } from "../../lib/time";

type Origen = "seguimiento_presupuesto" | "recordatorio_cita" | "reactivacion";

type FilaEnvio = {
  id: string;
  origen: Origen;
  tipo: string;
  estado: "Pendiente" | "Enviado" | "Fallido" | "Cancelado" | "Caducado";
  paciente: string;
  telefono: string;
  contenido: string;
  plantilla: string;
  programadoPara: string;
  enviadoEn: string | null;
  clinicaNombre: string | null;
};

type CitaSinRespuesta = {
  citaId: string;
  cita: string;
  paciente: string;
  telefono: string;
  horaInicio: string;
  recordatoriosEnviados: number;
  clinicaNombre: string | null;
};

type Vista = {
  hoy: string;
  pendientes: FilaEnvio[];
  procesadasHoy: FilaEnvio[];
  caducadasRecientes: FilaEnvio[];
  citasSinRespuesta: CitaSinRespuesta[];
  huecosSinPlantilla: string[];
};

const ORIGEN_LABEL: Record<Origen, string> = {
  seguimiento_presupuesto: "Presupuestos",
  recordatorio_cita: "Citas",
  reactivacion: "Reactivación",
};

const ESTADO_VARIANT: Record<FilaEnvio["estado"], StatePillVariant> = {
  Pendiente: "info",
  Enviado: "success",
  Fallido: "danger",
  Cancelado: "neutral",
  Caducado: "warning",
};

function horaDe(iso: string | null): string {
  if (!iso) return "";
  return fechaHoraClinica(iso);
}

export function EnviosView() {
  const [vista, setVista] = useState<Vista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Origen | "todos">("todos");
  const [operando, setOperando] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await cargarJSON<Vista>("/api/envios");
      setVista(data);
    } catch (e) {
      // Conservar lo último bueno + error honesto (§10).
      setError(e instanceof Error ? e.message : "No se pudo cargar la cola de envíos");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filtra = useCallback(
    (filas: FilaEnvio[]) => (filtro === "todos" ? filas : filas.filter((f) => f.origen === filtro)),
    [filtro],
  );

  const pendientes = useMemo(() => filtra(vista?.pendientes ?? []), [vista, filtra]);
  const procesadas = useMemo(() => filtra(vista?.procesadasHoy ?? []), [vista, filtra]);
  const caducadas = useMemo(() => filtra(vista?.caducadasRecientes ?? []), [vista, filtra]);

  async function marcar(fila: FilaEnvio, estado: "Enviado" | "Cancelado") {
    if (operando) return;
    setOperando(fila.id);
    try {
      const r = await cargarJSON<{ ok: boolean; urlWhatsApp?: string }>(
        "/api/presupuestos/cola-envios",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: fila.id, estado }),
        },
      );
      if (estado === "Enviado") {
        // Uno a uno: se abre WhatsApp con el texto puesto; la persona envía.
        if (r.urlWhatsApp) window.open(r.urlWhatsApp, "_blank", "noopener");
        toast.success(`Registrado — se abre WhatsApp para ${fila.paciente || "el paciente"}`);
      } else {
        toast.success("Envío cancelado");
      }
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar el envío");
    } finally {
      setOperando(null);
    }
  }

  async function generarHoy() {
    if (generando) return;
    setGenerando(true);
    try {
      const r = await cargarJSON<{ caducados: number; presupuestos: { generados: number }; citas: { generados: number } }>(
        "/api/presupuestos/cola-envios/generar",
        { method: "POST" },
      );
      toast.success(
        `Cola de hoy: ${r.presupuestos.generados + r.citas.generados} propuestos · ${r.caducados} caducados de días anteriores`,
      );
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo generar la cola");
    } finally {
      setGenerando(false);
    }
  }

  if (cargando && !vista) {
    return (
      <div className="w-full px-4 py-5 lg:px-6">
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Envíos</h1>
        <div className="mt-4">
          <CardListSkeleton />
        </div>
      </div>
    );
  }

  if (error && !vista) {
    return (
      <div className="w-full px-4 py-5 lg:px-6">
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Envíos</h1>
        <div className="mt-4">
          <ErrorState detail={error} onRetry={cargar} />
        </div>
      </div>
    );
  }

  if (!vista) return null;

  return (
    <div className="w-full px-4 py-5 lg:px-6 space-y-6">
      {/* Cabecera: solo hechos */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* Fase F: el back-link y el h1 murieron — la barra lateral da la
              ventana y la vuelta; solo quedan los hechos. */}
          <p className="mt-1 text-[13px] text-[var(--color-muted)]">
            {vista.pendientes.length} por enviar hoy · {vista.procesadasHoy.length} procesados hoy ·{" "}
            {vista.caducadasRecientes.length} caducados en 7 días
          </p>
        </div>
        <button
          onClick={generarHoy}
          disabled={generando}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
        >
          <RefreshCw size={14} strokeWidth={ICON_STROKE} className={generando ? "animate-spin" : ""} />
          Generar la cola de hoy
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
          No se pudo actualizar — estás viendo los últimos datos cargados.{" "}
          <button onClick={cargar} className="font-medium underline">Reintentar</button>
        </div>
      )}

      {/* Opción (b): un hueco sin plantilla no genera — se dice, no se tapa */}
      {vista.huecosSinPlantilla.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle size={15} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
          <span>
            Faltan plantillas de: <strong>{vista.huecosSinPlantilla.join(" · ")}</strong>. Esos
            mensajes no se proponen hasta que exista su plantilla revisada.
          </span>
        </div>
      )}

      {/* Filtro por tipo */}
      <div className="flex flex-wrap gap-1.5">
        {(["todos", "seguimiento_presupuesto", "recordatorio_cita", "reactivacion"] as const).map((o) => (
          <button
            key={o}
            onClick={() => setFiltro(o)}
            className={`rounded-lg border px-3 py-1 text-[13px] ${
              filtro === o
                ? "border-transparent bg-[var(--color-accent)] text-white"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
            }`}
          >
            {o === "todos" ? "Todos" : ORIGEN_LABEL[o]}
          </button>
        ))}
      </div>

      {/* 1 · Por enviar hoy */}
      <section>
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">Por enviar hoy</h2>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
          Uno a uno: lee el mensaje, envíalo y queda registrado. Lo que no se envíe hoy caduca.
        </p>
        <div className="mt-3 space-y-3">
          {pendientes.length === 0 && (
            <EmptyState
              title={vista.pendientes.length === 0 ? "No hay envíos propuestos para hoy" : "Nada pendiente de este tipo hoy"}
              hint={vista.pendientes.length === 0 ? "Genera la cola de hoy o vuelve mañana." : undefined}
            />
          )}
          {pendientes.map((f) => (
            <div key={f.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--color-foreground)]">{f.paciente || f.telefono}</span>
                <StatePill variant="info">{f.tipo}</StatePill>
                <StatePill variant="neutral">{ORIGEN_LABEL[f.origen]}</StatePill>
                {f.clinicaNombre && (
                  <span className="text-[13px] text-[var(--color-muted)]">{f.clinicaNombre}</span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap rounded-md bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-foreground)]">
                {f.contenido}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                  Plantilla: {f.plantilla}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => marcar(f, "Cancelado")}
                    disabled={operando === f.id}
                    className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => marcar(f, "Enviado")}
                    disabled={operando === f.id}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <Send size={14} strokeWidth={ICON_STROKE} />
                    Enviar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2 · Citas cerca sin respuesta */}
      <section>
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-[var(--color-foreground)]">
          <CalendarClock size={16} strokeWidth={ICON_STROKE} />
          Citas próximas sin respuesta al recordatorio
        </h2>
        <div className="mt-3 space-y-2">
          {vista.citasSinRespuesta.length === 0 && (
            <EmptyState title="Ninguna cita próxima sin respuesta" hint="Todas las citas con recordatorio enviado han contestado, o aún no se ha enviado ninguno." />
          )}
          {vista.citasSinRespuesta.map((c) => (
            <div
              key={c.citaId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-[var(--color-foreground)]">{c.paciente}</span>
                <span className="ml-2 text-[13px] text-[var(--color-muted)]">
                  {c.cita} · {horaDe(c.horaInicio)} · {c.recordatoriosEnviados}{" "}
                  {c.recordatoriosEnviados === 1 ? "recordatorio enviado" : "recordatorios enviados"}, sin respuesta
                </span>
              </div>
              <a
                href={`tel:${c.telefono}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
              >
                <Phone size={14} strokeWidth={ICON_STROKE} />
                Llamar
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* 3 · Procesado hoy — estado honesto */}
      <section>
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">Procesado hoy</h2>
        <div className="mt-3 space-y-2">
          {procesadas.length === 0 && <EmptyState title="Hoy todavía no se ha enviado ni cancelado nada" />}
          {procesadas.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-sm text-[var(--color-foreground)]">{f.paciente || f.telefono}</span>
                <span className="text-[13px] text-[var(--color-muted)]">{f.tipo}</span>
                <StatePill variant="neutral">{ORIGEN_LABEL[f.origen]}</StatePill>
              </div>
              <div className="flex items-center gap-2">
                {f.enviadoEn && <span className="text-[13px] text-[var(--color-muted)]">{horaDe(f.enviadoEn)}</span>}
                <StatePill variant={ESTADO_VARIANT[f.estado]}>{f.estado}</StatePill>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4 · Caducados — la medida del equipo, visible */}
      <section>
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-[var(--color-foreground)]">
          <Hourglass size={16} strokeWidth={ICON_STROKE} />
          Caducados (últimos 7 días)
        </h2>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
          Se propusieron y nadie los envió ese día. Si el caso sigue vivo, hoy vuelve a proponerse con datos de hoy.
        </p>
        <div className="mt-3 space-y-2">
          {caducadas.length === 0 && <EmptyState title="Nada caducado en los últimos 7 días" />}
          {caducadas.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-sm text-[var(--color-foreground)]">{f.paciente || f.telefono}</span>
                <span className="text-[13px] text-[var(--color-muted)]">{f.tipo}</span>
                <StatePill variant="neutral">{ORIGEN_LABEL[f.origen]}</StatePill>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-[var(--color-muted)]">{horaDe(f.programadoPara)}</span>
                <StatePill variant="warning">Caducado</StatePill>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
