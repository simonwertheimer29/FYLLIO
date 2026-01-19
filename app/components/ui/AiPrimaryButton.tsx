"use client";

import React from "react";

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
        // ✅ evita que un contenedor padre (o un <button> externo) se coma el click
        e.preventDefault();
        e.stopPropagation();

        if (disabled) return;
        onClick?.(e);
      }}
      className={[
        // ✅ pointer-events-auto + isolate para evitar overlays raros
        "pointer-events-auto isolate relative inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-extrabold transition select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        recommended
          ? [
              "text-white",
              "bg-gradient-to-r from-sky-600 via-indigo-600 to-fuchsia-600",
              "shadow-md shadow-sky-200/60",
              "ring-1 ring-sky-200/60",
            ].join(" ")
          : "bg-sky-600 text-white hover:bg-sky-700",
        className ?? "",
      ].join(" ")}
    >
      {recommended ? (
        <>
          {/* ✅ siguen sin capturar clicks */}
          <span className="pointer-events-none absolute -inset-1 rounded-full bg-gradient-to-r from-sky-400/30 via-indigo-400/25 to-fuchsia-400/30 blur-md animate-pulse" />
          <span className="pointer-events-none absolute -inset-[2px] rounded-full bg-gradient-to-r from-sky-300/25 via-indigo-300/20 to-fuchsia-300/25 blur-lg animate-pulse" />
        </>
      ) : null}

      <span className="relative z-10 inline-flex items-center gap-2">
        {recommended && withIcon ? <span className="text-sm leading-none">✦</span> : null}
        {children}
      </span>
    </button>
  );
}
