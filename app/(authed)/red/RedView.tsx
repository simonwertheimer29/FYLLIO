"use client";

// Sprint 8 D.3 — "Red": dashboard macro integrando Leads + Presupuestos +
// Pacientes. Respeta ClinicContext: admin con "Todas" ve agregado, con
// clínica específica filtra.
//
// Reutiliza CommandCenterView (ya consume useClinic en su filtro interno) y
// añade encima una franja de KPIs de leads + tasa de conversión lead→paciente.

import { useEffect, useMemo, useState } from "react";
import type { UserSession } from "../../lib/presupuestos/types";
import { useClinic } from "../../lib/context/ClinicContext";
import CommandCenterView from "../../components/presupuestos/CommandCenterView";
import { openCopilot } from "../../components/copilot/openCopilot";
import { KpiCard } from "../../components/ui/KpiCard";
import { Sparkles, ICON_STROKE } from "../../components/icons";

type LeadApi = {
  id: string;
  estado: "Nuevo" | "Contactado" | "Citado" | "Citados Hoy" | "No Interesado";
  clinicaId: string | null;
  convertido: boolean;
};

type PacienteApi = {
  id: string;
  clinicaId: string | null;
  aceptado: "Si" | "No" | "Pendiente" | null;
  pagado: number | null;
  leadOrigenId: string | null;
};

export function RedView({ user }: { user: UserSession }) {
  const { selectedClinicaId, selectedClinicaNombre } = useClinic();
  const [leads, setLeads] = useState<LeadApi[] | null>(null);
  const [pacientes, setPacientes] = useState<PacienteApi[] | null>(null);

  useEffect(() => {
    fetch("/api/leads")
      .then((r) => (r.ok ? r.json() : { leads: [] }))
      .then((d) => setLeads(d.leads ?? []))
      .catch(() => setLeads([]));
    fetch("/api/pacientes")
      .then((r) => (r.ok ? r.json() : { pacientes: [] }))
      .then((d) => setPacientes(d.pacientes ?? []))
      .catch(() => setPacientes([]));
  }, []);

  const filtered = useMemo(() => {
    const ls = (leads ?? []).filter(
      (l) => !selectedClinicaId || l.clinicaId === selectedClinicaId
    );
    const ps = (pacientes ?? []).filter(
      (p) => !selectedClinicaId || p.clinicaId === selectedClinicaId
    );
    return { ls, ps };
  }, [leads, pacientes, selectedClinicaId]);

  const activos = filtered.ls.filter(
    (l) => l.estado !== "No Interesado"
  ).length;
  const leadsConvertidos = filtered.ls.filter((l) => l.convertido).length;
  const totalLeads = filtered.ls.length;
  const tasaConversion = totalLeads
    ? Math.round((leadsConvertidos / totalLeads) * 100)
    : 0;

  // Pacientes originados en un lead (comprobación cruzada)
  const pacientesDeLead = filtered.ps.filter((p) => p.leadOrigenId).length;

  // Facturado del mes actual (pagado > 0 de pacientes creados este mes).
  const nowYM = new Date().toISOString().slice(0, 7);
  const facturadoMes = filtered.ps.reduce(
    (s, p) => s + (p.pagado ?? 0),
    0
  );
  // NOTE: no tenemos fecha_pago; usamos total pagado como proxy.
  void nowYM;

  const scope =
    selectedClinicaNombre ?? (selectedClinicaId === null ? "todas las clínicas" : "clínica");

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 lg:p-6 space-y-6">
        {/* Franja KPI leads */}
        <section className="space-y-3">
          <header className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">Red</h1>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">
                Panorama global sobre {scope}
              </p>
            </div>
            {/* Sprint 11 C.3 — Copilot con KPIs globales del mes. */}
            <button
              type="button"
              onClick={() => {
                const summary = [
                  `Vista: Red — ${scope}`,
                  `Leads en pipeline: ${activos}`,
                  `Leads convertidos: ${leadsConvertidos}`,
                  `Pacientes de origen Lead: ${pacientesDeLead}`,
                  `Tasa conversión lead→paciente: ${tasaConversion}%`,
                  `Facturado acumulado: ${facturadoMes.toLocaleString("es-ES")}€`,
                ].join("\n");
                openCopilot({
                  context: { kind: "red_admin", summary },
                  initialAssistantMessage:
                    "He visto los KPIs de la red. ¿Quieres que te explique algún punto en concreto?",
                });
              }}
              className="text-xs font-medium px-3 py-2 rounded-md bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors inline-flex items-center gap-1.5"
            >
              <Sparkles size={14} strokeWidth={ICON_STROKE} /> Analiza el rendimiento del mes
            </button>
          </header>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label="Leads en pipeline"
              value={activos}
              accent="sky"
              copilotSummary={`KPI: Leads en pipeline — ${scope}\nValor: ${activos}\n(Excluye los marcados como No Interesado.)`}
            />
            <KpiCard
              label="Leads convertidos"
              value={leadsConvertidos}
              subline={`${pacientesDeLead} pacientes de origen Lead`}
              accent="emerald"
              copilotSummary={`KPI: Leads convertidos — ${scope}\nValor: ${leadsConvertidos}\nPacientes que originaron como lead: ${pacientesDeLead}`}
            />
            <KpiCard
              label="Tasa conversión lead→paciente"
              value={tasaConversion}
              formatter={(n) => `${n}%`}
              accent="sky"
              copilotSummary={`KPI: Tasa conversión lead→paciente — ${scope}\nValor: ${tasaConversion}%\nFórmula: leads convertidos / leads totales.`}
            />
            <KpiCard
              label="Facturado acumulado"
              value={facturadoMes}
              formatter={(n) =>
                n.toLocaleString("es-ES", {
                  style: "currency",
                  currency: "EUR",
                  maximumFractionDigits: 0,
                })
              }
              accent="amber"
              copilotSummary={`KPI: Facturado acumulado — ${scope}\nValor: ${facturadoMes.toLocaleString("es-ES")}€\nSuma del campo Pagado de pacientes activos.`}
            />
          </div>
        </section>

        {/* Franja de Presupuestos (CommandCenterView ya filtra por selectedClinicaNombre) */}
        <section>
          <CommandCenterView
            user={user}
            onNavigateToTareas={() => {
              /* no-op: "Tareas" desaparece en D.6. El usuario puede ir a
                 /actuar-hoy manualmente. */
            }}
          />
        </section>
      </div>
    </div>
  );
}

