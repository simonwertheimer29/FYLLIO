"use client";

// /agente con DOS PESTAÑAS (fase E, dictado): «Configuración» y «Pruebas» —
// dos caras del mismo objeto: configuras, pruebas, ves un fallo, ajustas,
// repites. (Criterio general en el PLAN §7: subpestañas solo cuando son dos
// caras del mismo objeto.)
//
// Coordinación NO ve la pestaña de Configuración (dictado: ni vacía ni con
// error) — aterriza directa en Pruebas, con una línea que dice dónde vive la
// configuración. Admin ve las dos.

import { useState } from "react";
import { useClinic } from "../../../lib/context/ClinicContext";
import { Sparkles, ICON_STROKE } from "../../../components/icons";
import { AgenteConfigView } from "./AgenteConfigView";
import { BancoPruebasView } from "./BancoPruebasView";
import { DescartesJuezPanel } from "../../../components/agente/DescartesJuezPanel";

export function AgenteView() {
  const { session } = useClinic();
  const esAdmin = session.rol === "admin";
  const [tab, setTab] = useState<"configuracion" | "pruebas">(esAdmin ? "configuracion" : "pruebas");

  if (!esAdmin) {
    // Sin pestañas: solo el banco, con la nota de dónde vive lo demás.
    return (
      <div className="mx-auto max-w-[100rem] space-y-4 px-4 py-6 lg:px-8">
        <header>
          <h1 className="font-display flex items-center gap-2 text-xl font-semibold text-[var(--color-foreground)]">
            <Sparkles size={18} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
            Pon a prueba tu agente
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
            Escríbele como si fueras un paciente y mira cómo decide. La configuración del agente la
            gestiona administración.
          </p>
        </header>
        <BancoPruebasView />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[100rem] px-4 py-6 lg:px-8">
      <div className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
        {([
          { id: "configuracion" as const, label: "Configuración" },
          { id: "pruebas" as const, label: "Pruebas" },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-selected={tab === t.id}
            className={`-mb-px border-b-2 px-3 py-2 text-[13.5px] font-semibold transition-colors ${
              tab === t.id
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "configuracion" ? (
        <div className="space-y-6">
          <AgenteConfigView />
          {/* MEJORAS 151: el termómetro del generador, junto a la config que
              lo mueve. */}
          <DescartesJuezPanel />
        </div>
      ) : (
        <div className="space-y-4">
          <header>
            <h1 className="font-display flex items-center gap-2 text-xl font-semibold text-[var(--color-foreground)]">
              <Sparkles size={18} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
              Pon a prueba tu agente
            </h1>
            <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
              Escríbele como si fueras un paciente y mira cómo decide — con la configuración real de la
              clínica seleccionada.
            </p>
          </header>
          <BancoPruebasView />
        </div>
      )}
    </div>
  );
}
