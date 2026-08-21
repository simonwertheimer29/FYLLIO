"use client";

// Seguimiento (P2, 18-08) — LA MESA DE TRABAJO: los casos que exigen una
// persona, en TRES cohortes (Necesita respuesta · Listos para cerrar · Fuera
// de plazo). Lo demás no vive aquí: lo que trabaja el agente está en
// Mensajería, lo que va a salir hoy en Envíos (la cinta), y la consulta en
// Tablas — el ciclo del caso del PLAN §8.
//
// Qué murió en este rediseño (dictado):
//  · La división Leads/Presupuestos como pestañas — ahora es un filtro.
//  · «Casos del agente» como sección — los entregados SON la cola.
//  · Las cohortes viejas (Citados · Nuevos · En conversación · Rezagados) —
//    lo que exige persona cae en las tres; el resto salió de la cola.
// La vista vieja (tabs + paneles) vivía aquí; los cierres de presupuesto
// siguen en /presupuestos hasta que el cierre llegue por la ficha (B3+).

import Link from "next/link";
import { useClinic } from "../../lib/context/ClinicContext";
import { CabeceraCola } from "../../components/shared/CabeceraCola";
import { ColaPorCohortes } from "./ColaPorCohortes";
import { AvisoFiltroClinica } from "../../components/shared/AvisoFiltroClinica";
import { Send, ICON_STROKE } from "../../components/icons";

export function SeguimientoView({
  cohorteInicial,
}: {
  /** Deep-link de /red (?cohorte=, vocabulario nuevo). null = default. */
  cohorteInicial?: "necesita_respuesta" | "listos_para_cerrar" | "fuera_de_plazo" | null;
}) {
  const { selectedClinicaId, selectedClinicaNombre, setSelectedClinicaId } = useClinic();
  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col overflow-auto p-4 lg:p-6 gap-4">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">Seguimiento</h1>
            <p className="text-xs text-[var(--color-muted)]">
              Lo que te toca hacer, con lo más urgente arriba.
            </p>
          </div>
          {/* La otra mitad de la cola de trabajo: lo que va a SALIR hoy. */}
          <Link
            href="/envios"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
          >
            <Send size={14} strokeWidth={ICON_STROKE} />
            Envíos
          </Link>
        </header>

        {/* El filtro de clínica PERSISTE en localStorage: se puede llegar
            aquí con él puesto sin haberlo tocado en esta sesión, y las cifras
            son otras. Se declara en la página, no solo en el selector. */}
        {clinicaFiltrada && (
          <AvisoFiltroClinica
            nombre={selectedClinicaNombre!}
            onVerTodas={() => setSelectedClinicaId(null)}
          />
        )}

        <CabeceraCola />
        <ColaPorCohortes cohorteInicial={cohorteInicial ?? null} />
      </div>
    </div>
  );
}
