"use client";

// Bloque 2 — molde compartido del panel de acción (leads Y presupuestos).
// Principio rector: la coordinadora solo hace tres cosas — escribir,
// llamar, o cerrar. Todo lo demás sobra.
//
//   · Panel lateral derecho de altura completa en escritorio (lg+);
//     pantalla completa en móvil y tablet. Sin pestañas.
//   · Cabecera mínima: quién es y qué hay en juego + prioridad.
//   · Contexto y recomendación: recuadro pequeño y denso — qué pasa
//     (una frase con su dato), la recomendación y las acciones.
//   · Conversación: el resto de la pantalla. Hilo arriba, campo de
//     escritura fijo abajo con DOS botones consolidados: IA (genera el
//     mensaje en el campo) y Plantillas (desplegable). Un solo camino
//     para escribir.

import { useEffect, useRef, useState } from "react";
import type { MensajeWhatsApp } from "../../lib/presupuestos/types";
import { StatePill, type StatePillVariant } from "../ui/StatePill";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  LoaderCircle,
  Plus,
  Send,
  Sparkles,
  X,
  ICON_STROKE,
} from "../icons";

export type PrioridadPanel = "alta" | "media" | "baja";

export const PRIORIDAD_PILL: Record<
  PrioridadPanel,
  { label: string; variant: StatePillVariant }
> = {
  alta: { label: "Prioridad alta", variant: "danger" },
  media: { label: "Prioridad media", variant: "warning" },
  baja: { label: "Al día", variant: "neutral" },
};

export function iniciales(nombre: string): string {
  const parts = nombre.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// ─── Shell: lateral en escritorio, pantalla completa en móvil/tablet ───

export function PanelAccionShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Escape cierra + bloquea scroll del body mientras está abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full lg:max-w-md h-dvh bg-[var(--color-surface)] shadow-2xl flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}

// ─── Cabecera mínima ───────────────────────────────────────────────────

export function PanelCabecera({
  nombre,
  sub,
  prioridad,
  prioridadTitle,
  onClose,
}: {
  nombre: string;
  /** Qué hay en juego: tratamiento (· importe en presupuestos). */
  sub: string;
  prioridad: PrioridadPanel | null;
  /** Tooltip del pill (el porqué). */
  prioridadTitle?: string;
  onClose: () => void;
}) {
  const pill = prioridad ? PRIORIDAD_PILL[prioridad] : null;
  return (
    <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2.5 shrink-0">
      <div className="h-9 w-9 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] text-[11px] font-semibold flex items-center justify-center shrink-0">
        {iniciales(nombre)}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="font-display text-sm font-semibold text-[var(--color-foreground)] leading-tight truncate">
          {nombre}
        </h2>
        <p className="text-[11px] text-[var(--color-muted)] truncate tabular-nums">{sub}</p>
      </div>
      {pill ? (
        <StatePill variant={pill.variant} title={prioridadTitle}>
          {pill.label}
        </StatePill>
      ) : (
        <span className="h-5 w-16 rounded-md bg-[var(--color-surface-muted)] animate-pulse" aria-hidden />
      )}
      <button
        type="button"
        onClick={onClose}
        className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] p-1 -mr-1"
        aria-label="Cerrar"
      >
        <X size={18} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
    </div>
  );
}

// ─── Contexto y recomendación (recuadro pequeño y denso) ───────────────

export function ContextoRecomendacion({
  quePasa,
  recomendacion,
  etiqueta,
  acciones,
  cierre,
  cargando,
}: {
  /** Qué pasa, una frase con su dato ("Te escribió ayer y sigue sin respuesta."). */
  quePasa: string;
  /** La recomendación, imperativa ("Responde a su último mensaje"). */
  recomendacion: string;
  /** Intención detectada por el clasificador (única marca IA aquí). */
  etiqueta?: string | null;
  /** Fila de acciones rápidas (Escribir / Llamar / cierre contextual). */
  acciones: React.ReactNode;
  /** Cierre secundario discreto (No interesado · Aceptó · Rechazó…). */
  cierre?: React.ReactNode;
  cargando?: boolean;
}) {
  if (cargando) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] p-3 space-y-2 animate-pulse">
        <div className="h-3.5 w-3/4 rounded bg-[var(--color-surface-muted)]" />
        <div className="h-4 w-1/2 rounded bg-[var(--color-surface-muted)]" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-9 rounded-lg bg-[var(--color-surface-muted)]" />
          <div className="h-9 rounded-lg bg-[var(--color-surface-muted)]" />
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] bg-[var(--color-accent-soft)] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-[var(--color-foreground)] opacity-80 leading-relaxed">{quePasa}</p>
        {etiqueta && (
          <StatePill variant="info" title="Intención detectada en su última respuesta">
            <Sparkles size={10} strokeWidth={ICON_STROKE} aria-hidden />
            {etiqueta}
          </StatePill>
        )}
      </div>
      <p className="font-display text-sm font-semibold text-[var(--color-foreground)] mt-1 leading-snug">
        {recomendacion}
      </p>
      <div className="mt-2.5">{acciones}</div>
      {cierre && <div className="mt-2 pt-2 border-t border-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]">{cierre}</div>}
    </div>
  );
}

// Botones de la fila de acciones — el primario según la recomendación.
export const btnAccionBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
export const btnAccionPrimario = `${btnAccionBase} bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]`;
export const btnAccionSecundario = `${btnAccionBase} bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]`;

// ─── Conversación: burbujas ────────────────────────────────────────────

export function Burbujas({ mensajes }: { mensajes: MensajeWhatsApp[] }) {
  return (
    <>
      {mensajes.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.direccion === "Saliente" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[85%] px-3 py-2 ${
              msg.direccion === "Saliente"
                ? "ml-8 bg-[var(--color-accent)] text-[var(--color-on-accent)] rounded-2xl rounded-br-sm"
                : "mr-8 bg-[var(--color-surface-muted)] text-[var(--color-foreground)] rounded-2xl rounded-bl-sm"
            }`}
          >
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.contenido}</p>
            <p
              className={`text-[9px] text-right mt-0.5 ${
                msg.direccion === "Saliente"
                  ? "text-[var(--color-on-accent)] opacity-70"
                  : "text-[var(--color-muted)]"
              }`}
            >
              {msg.timestamp
                ? new Date(msg.timestamp).toLocaleString("es-ES", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </p>
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Registro colapsable (llamadas, cambios de estado — texto plano) ───

export function RegistroColapsable({
  titulo,
  lineas,
}: {
  titulo: string;
  lineas: Array<{ id: string; texto: string; fecha?: string }>;
}) {
  const [abierto, setAbierto] = useState(false);
  if (lineas.length === 0) return null;
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)] uppercase tracking-wide transition-colors"
      >
        {abierto ? (
          <ChevronDown size={12} strokeWidth={ICON_STROKE} aria-hidden />
        ) : (
          <ChevronRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
        )}
        {titulo} ({lineas.length})
      </button>
      {abierto && (
        <div className="space-y-1.5 mt-2 max-h-36 overflow-y-auto">
          {lineas.map((l) => (
            <div
              key={l.id}
              className="rounded-lg px-3 py-1.5 text-[11px] bg-[var(--color-surface-muted)] text-[var(--color-muted)] leading-relaxed"
            >
              {l.texto}
              {l.fecha && (
                <span className="block text-[9px] mt-0.5 opacity-80">
                  {new Date(l.fecha).toLocaleString("es-ES", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Composer: campo + IA + Plantillas + Enviar ────────────────────────

export type PlantillaComposer = { id: string; nombre: string };

export function Composer({
  value,
  onChange,
  onEnviar,
  enviando,
  onIA,
  generandoIA,
  plantillas,
  onPlantilla,
  disabled,
  disabledTitle,
  error,
  modoManual,
  textareaRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnviar: () => void;
  enviando: boolean;
  /** Genera el mensaje directamente en el campo (sin panel intermedio). */
  onIA: () => void;
  generandoIA: boolean;
  plantillas: PlantillaComposer[];
  onPlantilla: (id: string) => void;
  disabled?: boolean;
  disabledTitle?: string;
  error?: string | null;
  /** Sin WABA: se registra aquí y se termina el envío en WhatsApp. */
  modoManual?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [plantillasOpen, setPlantillasOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  // El campo crece con el contenido hasta ~5 líneas; después, scroll
  // interno. Los botones (IA · Plantillas · Enviar) van en fila aparte y
  // quedan siempre visibles.
  const MAX_ALTO = 128;
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ALTO)}px`;
    el.style.overflowY = el.scrollHeight > MAX_ALTO ? "auto" : "hidden";
  }, [value]);

  // Cerrar el desplegable al pinchar fuera.
  useEffect(() => {
    if (!plantillasOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPlantillasOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [plantillasOpen]);

  return (
    <div className="pt-2 border-t border-[var(--color-border)] shrink-0" title={disabled ? disabledTitle : undefined}>
      {error && <p className="text-[11px] text-[var(--color-danger)] mb-1.5">{error}</p>}
      <textarea
        ref={(el) => {
          innerRef.current = el;
          if (textareaRef) textareaRef.current = el;
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onEnviar();
          }
        }}
        rows={1}
        placeholder={generandoIA ? "Generando mensaje…" : "Escribe un mensaje…"}
        disabled={disabled || enviando}
        className="w-full text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none resize-none disabled:opacity-50"
      />
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <div className="flex items-center gap-1.5" ref={wrapRef}>
          <button
            type="button"
            onClick={onIA}
            disabled={disabled || generandoIA}
            title="Generar mensaje con IA"
            aria-label="Generar mensaje con IA"
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg fyllio-ia-gradient hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {generandoIA ? (
              <LoaderCircle size={14} strokeWidth={ICON_STROKE} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden />
            )}
          </button>
          {plantillas.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPlantillasOpen((v) => !v)}
                disabled={disabled}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] text-[11px] font-semibold disabled:opacity-50 transition-colors"
              >
                <FileText size={13} strokeWidth={ICON_STROKE} aria-hidden />
                Plantillas
                <ChevronDown size={12} strokeWidth={ICON_STROKE} aria-hidden />
              </button>
              {plantillasOpen && (
                <div className="absolute bottom-9 left-0 z-10 w-56 max-h-48 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl py-1">
                  {plantillas.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onPlantilla(p.id);
                        setPlantillasOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
                    >
                      {p.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onEnviar}
          disabled={disabled || enviando || !value.trim()}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-8 rounded-lg bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)] disabled:opacity-40 transition-colors"
        >
          <Send size={13} strokeWidth={ICON_STROKE} aria-hidden />
          {enviando ? "Enviando…" : "Enviar"}
        </button>
      </div>
      {modoManual && !disabled && (
        <p className="text-[10px] text-[var(--color-muted)] mt-1">
          Se registra aquí y se abre WhatsApp para terminar el envío.
        </p>
      )}
    </div>
  );
}

// ─── Dato clave ausente como acción ────────────────────────────────────

export function FaltaDatoAccion({
  label,
  tipo,
  placeholder,
  onGuardar,
}: {
  label: string;
  tipo: "email" | "tel";
  placeholder: string;
  onGuardar: (valor: string) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [saving, setSaving] = useState(false);

  async function guardar() {
    const v = valor.trim();
    if (!v) return;
    setSaving(true);
    try {
      await onGuardar(v);
      setAbierto(false);
    } finally {
      setSaving(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 self-start text-[11px] font-semibold rounded-md px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25 dark:hover:bg-amber-500/20 transition-colors"
      >
        <Plus size={11} strokeWidth={ICON_STROKE} aria-hidden />
        Falta {label} — añadir
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        type={tipo}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && guardar()}
        placeholder={placeholder}
        autoFocus
        className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] text-xs focus:border-[var(--color-accent)] focus:outline-none"
      />
      <button
        type="button"
        onClick={guardar}
        disabled={saving || !valor.trim()}
        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 shrink-0"
      >
        {saving ? "…" : "Guardar"}
      </button>
    </div>
  );
}
