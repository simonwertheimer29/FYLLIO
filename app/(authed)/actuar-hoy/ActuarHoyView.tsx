"use client";

// Sprint 9 Fix 3 — Actuar Hoy con sub-tabs internos:
//  [Leads] (default) · [Presupuestos]
//
// Sub-tab Leads: cards ricas con info del lead + acciones embebidas
// (IA mensaje con tonos, Llamar, WhatsApp, cambio de estado inline).
// Agrupados en buckets: Citados Hoy / Sin contactar / Seguimiento >48h.
//
// Sub-tab Presupuestos: IntervencionView (lo de antes).

import { useEffect, useMemo, useState } from "react";
import type {
  UserSession,
  PresupuestoIntervencion,
  PresupuestoEstado,
  MotivoPerdida,
} from "../../lib/presupuestos/types";
import type { Lead } from "../leads/types";
import IntervencionView from "../../components/presupuestos/IntervencionView";
import IntervencionSidePanel from "../../components/presupuestos/IntervencionSidePanel";
import { useClinic } from "../../lib/context/ClinicContext";
import { LeadAccionCard } from "./LeadAccionCard";

type Tab = "leads" | "presupuestos";

export function ActuarHoyView({
  user,
  initialLeads,
}: {
  user: UserSession;
  initialLeads: Lead[];
}) {
  const [tab, setTab] = useState<Tab>("leads");
  const [item, setItem] = useState<PresupuestoIntervencion | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col overflow-auto p-4 lg:p-6 gap-4">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Actuar hoy</h1>
            <p className="text-xs text-slate-500">
              Cola priorizada para que cierres todo desde aquí, sin saltar al kanban.
            </p>
          </div>
          <div className="flex gap-1 rounded-full border border-slate-200 bg-white p-0.5">
            {(
              [
                ["leads", "Leads"],
                ["presupuestos", "Presupuestos"],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`text-xs font-bold px-4 py-1.5 rounded-full transition-colors ${
                  tab === id
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {tab === "leads" ? (
          <LeadsTab initialLeads={initialLeads} />
        ) : (
          <IntervencionView
            key={reloadKey}
            user={user}
            onOpenDrawer={(p) => setItem(p)}
          />
        )}
      </div>

      {item && (
        <IntervencionSidePanel
          item={item}
          onClose={() => setItem(null)}
          onChangeEstado={(id, estado) => {
            handleChangeEstado(id, estado, undefined, () => setReloadKey((k) => k + 1));
            setItem(null);
          }}
          onRefresh={() => setItem(null)}
        />
      )}
    </div>
  );
}

async function handleChangeEstado(
  id: string,
  estado: PresupuestoEstado,
  extra: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string; reactivar?: boolean } | undefined,
  onDone: () => void
) {
  try {
    const { reactivar, ...patchExtra } = extra ?? {};
    await fetch(`/api/presupuestos/kanban/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado, ...patchExtra }),
    });
    if (reactivar && estado === "PERDIDO") {
      const fecha90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      await fetch("/api/presupuestos/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: id,
          tipo: "whatsapp",
          resultado: "pidió tiempo",
          nota: "Reactivación programada — 90 días",
          fechaHora: fecha90,
        }),
      }).catch(() => {});
    }
    onDone();
  } catch {
    // swallow
  }
}

// ────────────────────────────────────────────────────────────────────
// Sub-tab Leads: 3 buckets con cards ricas (estilo Intervención).
// ────────────────────────────────────────────────────────────────────

function LeadsTab({ initialLeads }: { initialLeads: Lead[] }) {
  const { selectedClinicaId } = useClinic();
  const [leads, setLeads] = useState<Lead[]>(initialLeads);

  // Si la clínica del header cambia, refetch para no servir leads de otras.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/leads" + (selectedClinicaId ? `?clinica=${selectedClinicaId}` : ""))
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d?.leads)) setLeads(d.leads);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedClinicaId]);

  const today = new Date().toISOString().slice(0, 10);
  const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const buckets = useMemo(() => {
    const citadosHoy: Lead[] = [];
    const sinContactar: Lead[] = [];
    const seguimiento: Lead[] = [];
    for (const l of leads) {
      if (l.convertido) continue;
      if (
        (l.estado === "Citado" || l.estado === "Citados Hoy") &&
        l.fechaCita === today &&
        !l.asistido
      ) {
        citadosHoy.push(l);
        continue;
      }
      if (l.estado === "Nuevo" && !l.llamado) {
        sinContactar.push(l);
        continue;
      }
      if (l.estado === "Contactado" && l.createdAt <= hace48h) {
        seguimiento.push(l);
      }
    }
    return { citadosHoy, sinContactar, seguimiento };
  }, [leads, today, hace48h]);

  function onLeadChanged(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
  }

  const total = buckets.citadosHoy.length + buckets.sinContactar.length + buckets.seguimiento.length;

  if (total === 0) {
    return (
      <div className="rounded-3xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm font-bold text-slate-800">Sin leads accionables hoy 🎉</p>
        <p className="text-xs text-slate-500 mt-1">Todo al día en este filtro de clínica.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Bucket
        label="Citados hoy"
        accent="text-rose-700"
        leads={buckets.citadosHoy}
        onLeadChanged={onLeadChanged}
      />
      <Bucket
        label="Sin contactar"
        accent="text-slate-700"
        leads={buckets.sinContactar}
        onLeadChanged={onLeadChanged}
      />
      <Bucket
        label="Seguimiento pendiente (>48h)"
        accent="text-amber-700"
        leads={buckets.seguimiento}
        onLeadChanged={onLeadChanged}
      />
    </div>
  );
}

function Bucket({
  label,
  accent,
  leads,
  onLeadChanged,
}: {
  label: string;
  accent: string;
  leads: Lead[];
  onLeadChanged: (l: Lead) => void;
}) {
  if (leads.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className={`text-xs font-extrabold uppercase tracking-wide ${accent}`}>
          {label}
        </h2>
        <span className="text-[10px] font-bold bg-slate-900 text-white rounded-full px-2 py-0.5">
          {leads.length}
        </span>
      </div>
      <div className="space-y-3">
        {leads.map((l) => (
          <LeadAccionCard key={l.id} lead={l} onChanged={onLeadChanged} />
        ))}
      </div>
    </section>
  );
}
