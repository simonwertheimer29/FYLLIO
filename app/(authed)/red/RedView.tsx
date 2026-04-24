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
          <header>
            <h1 className="text-lg font-extrabold text-slate-900">Red</h1>
            <p className="text-xs text-slate-500">
              Panorama global sobre {scope}
            </p>
          </header>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiMini label="Leads en pipeline" value={activos.toString()} accent="bg-sky-50 text-sky-700" />
            <KpiMini
              label="Leads convertidos"
              value={leadsConvertidos.toString()}
              subline={`${pacientesDeLead} pacientes de origen Lead`}
              accent="bg-emerald-50 text-emerald-700"
            />
            <KpiMini
              label="Tasa conversión lead→paciente"
              value={`${tasaConversion}%`}
              accent="bg-violet-50 text-violet-700"
            />
            <KpiMini
              label="Facturado acumulado"
              value={facturadoMes.toLocaleString("es-ES", {
                style: "currency",
                currency: "EUR",
                maximumFractionDigits: 0,
              })}
              accent="bg-amber-50 text-amber-700"
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

function KpiMini({
  label,
  value,
  subline,
  accent,
}: {
  label: string;
  value: string;
  subline?: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4">
      <span
        className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${accent}`}
      >
        {label}
      </span>
      <p className="text-2xl font-extrabold text-slate-900 mt-1">{value}</p>
      {subline && <p className="text-[10px] text-slate-500">{subline}</p>}
    </div>
  );
}
