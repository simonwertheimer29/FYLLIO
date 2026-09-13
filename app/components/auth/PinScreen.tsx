"use client";

// Pantalla genérica de PIN: icono + título + casillas + keypad + botones.
// Gestiona el state del PIN. Soporta teclado físico (dígitos, backspace, enter)
// y paste de una cadena de 4 o 6 dígitos.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ShieldCheck } from "../icons";
import { NumericKeypad } from "./NumericKeypad";

type Props = {
  digits: 4 | 6;
  title: string;
  subtitle?: string;
  backHref: string;
  onSubmit: (pin: string) => void | Promise<void>;
  loading?: boolean;
  error?: string | null;
  /** Si true, dispara onSubmit automáticamente al completar la última casilla. */
  autoSubmit?: boolean;
};

/** Lo que espera el autoenvío tras la última casilla (14-09-2026).
 *
 *  Antes salía en el mismo instante (`queueMicrotask`), y eso convierte una
 *  ERRATA en un intento gastado: no da tiempo a ver el sexto dígito, ni a
 *  borrarlo. Cinco erratas seguidas —que con seis casillas y prisa es media
 *  jornada normal— son quince minutos fuera. El caso que lo destapó fue Simon
 *  bloqueado con el PIN correcto; con una coordinadora en mitad de su jornada
 *  el coste es peor, porque ni sabe por qué ni a quién preguntar.
 *
 *  600 ms es el hueco para ver la última casilla y borrar antes de que salga;
 *  por debajo de ~400 ms no da tiempo a reaccionar, y por encima de un segundo
 *  el autoenvío se siente roto. Cualquier borrado lo cancela. */
const RETARDO_AUTOENVIO_MS = 600;

export function PinScreen({
  digits,
  title,
  subtitle,
  backHref,
  onSubmit,
  loading = false,
  error = null,
  autoSubmit = true,
}: Props) {
  const [pin, setPin] = useState("");
  const envioPendiente = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelarAutoenvio = useCallback(() => {
    if (envioPendiente.current) {
      clearTimeout(envioPendiente.current);
      envioPendiente.current = null;
    }
  }, []);

  const submit = useCallback(
    async (value: string) => {
      cancelarAutoenvio();
      if (value.length !== digits || loading) return;
      await onSubmit(value);
    },
    [digits, loading, onSubmit, cancelarAutoenvio]
  );

  /** Programa el autoenvío y deja una ventana para corregir. Un borrado, otro
   *  dígito o un envío a mano lo cancelan. */
  const programarAutoenvio = useCallback(
    (valor: string) => {
      cancelarAutoenvio();
      envioPendiente.current = setTimeout(() => {
        envioPendiente.current = null;
        void submit(valor);
      }, RETARDO_AUTOENVIO_MS);
    },
    [cancelarAutoenvio, submit],
  );

  // Si la pantalla se va con un envío programado, no se dispara.
  useEffect(() => cancelarAutoenvio, [cancelarAutoenvio]);

  const addDigit = useCallback(
    (d: string) => {
      if (loading) return;
      setPin((prev) => {
        if (prev.length >= digits) return prev;
        const next = prev + d;
        if (next.length === digits && autoSubmit) {
          // Fuera del setter (evita doble render) y con retardo (evita que una
          // errata se convierta en un intento gastado).
          queueMicrotask(() => programarAutoenvio(next));
        }
        return next;
      });
    },
    [digits, loading, autoSubmit, programarAutoenvio]
  );

  const backspace = useCallback(() => {
    if (loading) return;
    // Borrar SIEMPRE cancela el autoenvío: es la corrección de la errata.
    cancelarAutoenvio();
    setPin((prev) => prev.slice(0, -1));
  }, [loading, cancelarAutoenvio]);

  // Limpia las casillas cuando llega un error nuevo, para que el usuario reteclee.
  useEffect(() => {
    if (error) setPin("");
  }, [error]);

  // Teclado físico: 0-9, Backspace, Enter.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (loading) return;
      if (/^\d$/.test(e.key)) {
        addDigit(e.key);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
        return;
      }
      if (e.key === "Enter" && pin.length === digits) {
        submit(pin);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addDigit, backspace, submit, pin, digits, loading]);

  // Paste handler a nivel window (el form no tiene input real).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const clip = e.clipboardData?.getData("text") ?? "";
      const onlyDigits = clip.replace(/\D/g, "");
      if (onlyDigits.length !== digits) return;
      e.preventDefault();
      setPin(onlyDigits);
      if (autoSubmit) queueMicrotask(() => programarAutoenvio(onlyDigits));
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [digits, autoSubmit, programarAutoenvio]);

  return (
    <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Back link */}
        <div>
          <Link
            href={backHref}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors inline-flex items-center gap-1"
          >
            <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
            Volver
          </Link>
        </div>

        {/* Icon + title — Sprint 12 H.1 tipografia display. */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-border)]">
            <ShieldCheck size={26} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)] tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-[var(--color-muted)]">{subtitle}</p>}
        </div>

        {/* Casillas PIN */}
        <div className="flex justify-center gap-2">
          {Array.from({ length: digits }).map((_, i) => {
            const filled = i < pin.length;
            return (
              <div
                key={i}
                className={`${digits === 6 ? "w-11 h-14" : "w-12 h-14"} rounded-lg border flex items-center justify-center font-display text-2xl font-bold tabular-nums transition-colors ${
                  filled
                    ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-on-accent)]"
                    : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-muted)]"
                }`}
                aria-label={`Dígito ${i + 1} ${filled ? "introducido" : "pendiente"}`}
              >
                {filled ? "•" : ""}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <p
            role="alert"
            className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-center"
          >
            {error}
          </p>
        )}

        {/* Keypad */}
        <NumericKeypad onDigit={addDigit} onBackspace={backspace} disabled={loading} />

        {/* Submit fallback */}
        <button
          type="button"
          disabled={loading || pin.length !== digits}
          onClick={() => submit(pin)}
          className="w-full rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold py-3 hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]"
        >
          {loading ? "Entrando…" : "Acceder"}
        </button>
      </div>
    </div>
  );
}
