"use client";

import { useEffect, useState } from "react";

export default function FloatingNewButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  // Keyboard shortcut: press "N" when no input is focused
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "n" && e.key !== "N") return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      onClick();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClick]);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Nuevo presupuesto (N)"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-violet-600 text-white font-semibold shadow-md hover:bg-violet-700 transition-all duration-200 rounded-full"
      style={{
        height: 52,
        paddingLeft: hovered ? 20 : 0,
        paddingRight: hovered ? 20 : 0,
        width: hovered ? "auto" : 52,
        minWidth: 52,
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      }}
    >
      <span className="text-xl leading-none shrink-0">+</span>
      <span
        className="text-sm whitespace-nowrap overflow-hidden transition-all duration-200"
        style={{ maxWidth: hovered ? 160 : 0, opacity: hovered ? 1 : 0 }}
      >
        Nuevo presupuesto
      </span>
    </button>
  );
}
