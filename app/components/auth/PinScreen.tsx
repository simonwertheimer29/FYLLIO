"use client";

// Pantalla genérica de PIN: icono + título + casillas + keypad + botones.
// Gestiona el state del PIN. Soporta teclado físico (dígitos, backspace, enter)
// y paste de una cadena de 4 o 6 dígitos.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

  const submit = useCallback(
    async (value: string) => {
      if (value.length !== digits || loading) return;
      await onSubmit(value);
    },
    [digits, loading, onSubmit]
  );

  const addDigit = useCallback(
    (d: string) => {
      if (loading) return;
      setPin((prev) => {
        if (prev.length >= digits) return prev;
        const next = prev + d;
        if (next.length === digits && autoSubmit) {
          // Dispara fuera del setter para evitar doble render.
          queueMicrotask(() => submit(next));
        }
        return next;
      });
    },
    [digits, loading, autoSubmit, submit]
  );

  const backspace = useCallback(() => {
    if (loading) return;
    setPin((prev) => prev.slice(0, -1));
  }, [loading]);

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
      if (autoSubmit) queueMicrotask(() => submit(onlyDigits));
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [digits, autoSubmit, submit]);

  return (
    <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Back link */}
        <div>
          <Link
            href={backHref}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors inline-flex items-center gap-1"
          >
            ← Volver
          </Link>
        </div>

        {/* Icon + title — Sprint 12 H.1 tipografia display. */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-sky-50 text-sky-700 text-2xl border border-sky-100">
            🛡️
          </div>
          <h1 className="font-display text-2xl font-semibold text-[var(--color-foreground)] tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-[var(--color-muted)]">{subtitle}</p>}
        </div>

        {/* Casillas PIN */}
        <div className="flex justify-center gap-2">
          {Array.from({ length: digits }).map((_, i) => {
            const filled = i < pin.length;
            return (
              <div
                key={i}
                className={`${digits === 6 ? "w-11 h-14" : "w-12 h-14"} rounded-lg border flex items-center justify-center text-2xl font-bold transition-colors ${
                  filled
                    ? "bg-sky-500 border-sky-500 text-white"
                    : "bg-white border-[var(--color-border)] text-slate-300"
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
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-center">
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
          className="w-full rounded-lg bg-sky-500 text-white text-sm font-semibold py-3 hover:bg-sky-600 disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          {loading ? "Entrando…" : "Acceder"}
        </button>
      </div>
    </div>
  );
}
