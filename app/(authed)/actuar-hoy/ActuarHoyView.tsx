"use client";

// Sprint 8 D.2 — wrapper client de IntervencionView + su SidePanel.
// Sprint 9 G.5 — añade sección superior con Leads accionables del día.

import { useState } from "react";
import Link from "next/link";
import type {
  UserSession,
  PresupuestoIntervencion,
  PresupuestoEstado,
  MotivoPerdida,
} from "../../lib/presupuestos/types";
import type { Lead } from "../../lib/leads/leads";
import IntervencionView from "../../components/presupuestos/IntervencionView";
import IntervencionSidePanel from "../../components/presupuestos/IntervencionSidePanel";

export function ActuarHoyView({
  user,
  initialLeads,
}: {
  user: UserSession;
  initialLeads: Lead[];
}) {
  const [item, setItem] = useState<PresupuestoIntervencion | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  async function handleChangeEstado(
    id: string,
    estado: PresupuestoEstado,
    extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string; reactivar?: boolean }
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
      setReloadKey((k) => k + 1);
    } catch {
      // swallow: el interval de IntervencionView reintenta.
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col overflow-auto p-4 lg:p-6 gap-6">
        <LeadsActuarHoySection leads={initialLeads} />
        <section className="space-y-3">
          <SectionHeader title="Presupuestos — Intervención IA" />
          <IntervencionView
            key={reloadKey}
            user={user}
            onOpenDrawer={(p) => setItem(p)}
          />
        </section>
      </div>

      {item && (
        <IntervencionSidePanel
          item={item}
          onClose={() => setItem(null)}
          onChangeEstado={(id, estado) => {
            handleChangeEstado(id, estado);
            setItem(null);
          }}
          onRefresh={() => setItem(null)}
        />
      )}
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-extrabold text-slate-900">{title}</h2>
      {typeof count === "number" && (
        <span className="text-[10px] font-bold bg-slate-900 text-white rounded-full px-2 py-0.5">
          {count}
        </span>
      )}
    </div>
  );
}

function LeadsActuarHoySection({ leads }: { leads: Lead[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const citadosHoy = leads.filter(
    (l) =>
      (l.estado === "Citado" || l.estado === "Citados Hoy") &&
      l.fechaCita === today
  );
  const nuevos = leads.filter((l) => l.estado === "Nuevo");
  const contactado = leads.filter((l) => l.estado === "Contactado");

  return (
    <section className="space-y-3">
      <SectionHeader title="Leads — hoy" count={leads.length} />
      {leads.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          Sin leads accionables hoy. Buen trabajo ✓
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <LeadsBucket
            label="Citados hoy"
            accent="bg-rose-50 border-rose-200 text-rose-700"
            leads={citadosHoy}
          />
          <LeadsBucket
            label="Sin contactar"
            accent="bg-slate-50 border-slate-200 text-slate-700"
            leads={nuevos}
          />
          <LeadsBucket
            label="Seguimiento (>48h)"
            accent="bg-amber-50 border-amber-200 text-amber-700"
            leads={contactado}
          />
        </div>
      )}
    </section>
  );
}

function LeadsBucket({
  label,
  accent,
  leads,
}: {
  label: string;
  accent: string;
  leads: Lead[];
}) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 flex flex-col min-h-0">
      <div className={`flex items-center justify-between px-3 py-2 border-b ${accent} rounded-t-2xl`}>
        <span className="text-[11px] font-extrabold uppercase tracking-wide">{label}</span>
        <span className="text-[10px] font-bold bg-white/60 rounded-full px-2 py-0.5">
          {leads.length}
        </span>
      </div>
      <div className="p-2 space-y-2 max-h-72 overflow-y-auto">
        {leads.length === 0 ? (
          <p className="text-[11px] text-slate-300 italic px-1 py-2">Nada por hacer</p>
        ) : (
          leads.map((l) => <LeadActuarCard key={l.id} lead={l} />)
        )}
      </div>
    </div>
  );
}

function LeadActuarCard({ lead }: { lead: Lead }) {
  return (
    <article className="rounded-xl border border-slate-200 p-2.5 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-slate-900 truncate">{lead.nombre}</p>
        <Link
          href={`/leads?lead=${lead.id}`}
          className="text-[10px] text-sky-700 font-semibold hover:underline shrink-0"
        >
          Abrir →
        </Link>
      </div>
      <p className="text-[10px] text-slate-500 truncate">
        {lead.clinicaNombre ?? "Sin clínica"}
        {lead.tratamiento ? ` · ${lead.tratamiento}` : ""}
      </p>
      {lead.telefono && (
        <div className="flex gap-1 pt-1">
          <a
            href={`tel:${lead.telefono}`}
            className="flex-1 text-center rounded-lg bg-slate-50 text-slate-700 text-[10px] font-semibold py-1 hover:bg-slate-100"
          >
            Llamar
          </a>
          <a
            href={`https://wa.me/${lead.telefono.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-center rounded-lg bg-emerald-50 text-emerald-700 text-[10px] font-semibold py-1 hover:bg-emerald-100"
          >
            WhatsApp
          </a>
        </div>
      )}
    </article>
  );
}
