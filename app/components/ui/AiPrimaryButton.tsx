"use client";

import React from "react";
import { Sparkles, ICON_STROKE } from "../icons";

type Props = {
  children: React.ReactNode;
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  recommended?: boolean;
  withIcon?: boolean;
};

export default function AiPrimaryButton({
  children,
  onClick,
  disabled,
  className,
  recommended,
  withIcon = true,
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        // Evita que un contenedor padre (o un <button> externo) se coma el click
        e.preventDefault();
        e.stopPropagation();

        if (disabled) return;
        onClick?.(e);
      }}
      className={[
        // pointer-events-auto + isolate para evitar overlays raros
        "pointer-events-auto isolate relative inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        recommended
          ? [
              // Señal IA del sistema: degradado azul dentro del acento.
              "fyllio-ia-gradient",
              "shadow-md",
              "ring-1 ring-[var(--color-accent-soft)]",
            ].join(" ")
          : "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]",
        className ?? "",
      ].join(" ")}
    >
      {recommended ? (
        // Halo suave en accent — sigue sin capturar clicks.
        <span className="pointer-events-none absolute -inset-1 rounded-full bg-[var(--color-accent-soft)] blur-md animate-pulse" />
      ) : null}

      <span className="relative z-10 inline-flex items-center gap-2">
        {recommended && withIcon ? (
          <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
        ) : null}
        {children}
      </span>
    </button>
  );
}
